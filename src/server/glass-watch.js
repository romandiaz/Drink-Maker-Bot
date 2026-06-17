// Ambient glass-presence detection. A background poller reads the scale
// whenever the machine is idle and maintains a single `glassPresent` bool
// that the rest of the system can consult — pre-pour wait skips itself
// when a glass is already there, and the frontend gets a free hook for
// "glass detected" UI via the existing machine-state broadcast.
//
// Design: presence is decided purely against a software-tracked
// `emptyRef` (in raw HX711 grams), NOT by ever calling the firmware's
// TARE command. The firmware's tare offset is a shared resource — the
// pour loop now samples its own baseline at pour-start, and the admin
// maintenance screen has an explicit "Tare scale" button — so anything
// in here that re-zeroed the firmware would race those callers and
// silently shift the asymmetric thresholds out from under them. The
// previous TARE-on-transition design had exactly this failure mode: if
// the firmware was ever tared with a glass on the platform, readings sat
// in the dead zone between the present and absent thresholds and
// glassPresent got stuck at false until someone restarted the firmware.
//
// Presence math (all relative to emptyRef):
//
//   delta = current_grams - emptyRef
//   step  = current_grams - previous_reading   (one poll, ~1s apart)
//   absent → present   when delta > PRESENT_THRESHOLD_G
//                       AND  step  > PRESENT_STEP_G        (emptyRef unchanged)
//   present → absent   when delta < ABSENT_THRESHOLD_G    (emptyRef <- current)
//
// Asymmetric thresholds give us hysteresis without a separate
// stickiness timer: a glass has to clear +50g to count as placed, but
// has to fall back below +25g to count as removed.
//
// The present transition ALSO requires a sharp single-poll step, not just
// the absolute level. A real placement is a jump of the glass's full mass
// between two consecutive (settled) readings; slow HX711 drift moves
// gradually and never produces a big step. Without this guard, drift that
// outruns the slow-drift nudge below could creep delta past +50g with
// nothing on the platform and latch a false present — the exact failure
// that fired pours into an empty platform. Gating on the step kills that
// at the source: drift can raise the absolute level but can't fake the
// jump. (STABLE debounces each read, so a settling placement returns
// `unstable` until it settles — we never sample mid-placement and split
// the step across polls.)
//
// Removal while present is detected two ways, whichever fires first:
//   * absolute: delta < ABSENT_THRESHOLD_G (the trip back toward emptyRef)
//   * relative: a downward STEP of REMOVAL_STEP_G below the heaviest
//     reading seen since placement.
// The relative check is the recovery path for a stale-low emptyRef: if the
// baseline drifted up (or desynced from a firmware re-tare) and latched
// glassPresent=true, the absolute check can never satisfy (an empty
// platform still reads well above +25 against a too-low ref). Lifting the
// glass off drops the reading by the glass's mass — a step far larger than
// REMOVAL_STEP_G — so we still register the removal and re-anchor emptyRef
// to the now-empty reading, unsticking the state machine. This is why
// "lift the glass and put it back" must clear a false-positive present.
//
// Drift handling while absent:
//   * |delta| < DRIFT_RETARE_BAND_G  + DRIFT_RETARE_INTERVAL_MS elapsed
//       → slow drift; nudge emptyRef toward current
//   * delta < -DRIFT_RETARE_BAND_G
//       → emptyRef was almost certainly captured with something on the
//         platform (boot-with-glass, or admin tared with weight on).
//         Anchor immediately so the next placement is detectable.
//
// The watcher does NOT acquire the machine-state lock. Acquiring would
// flip status to "maintenance" for ~500ms every poll, which would race
// every user-initiated pour. Instead it just checks status === "idle"
// before each STABLE call; the rare TOCTOU window (status flips between
// check and call) costs at most one timed-out STABLE, swallowed by the
// catch handler.

import { getState, setGlassPresent as broadcastGlassPresent } from "./machine-state.js";
import { readScaleStable } from "./maintenance.js";
import { isSerialReady, onArduinoReset } from "./serial.js";

const POLL_INTERVAL_MS = 1000;
// Asymmetric thresholds with hysteresis. The lightest realistic glass
// (coupe ≈ 120g) clears +50g comfortably; +25g for the return trip means
// even a wobbly placement doesn't oscillate between present/absent.
const PRESENT_THRESHOLD_G = 50;
const ABSENT_THRESHOLD_G  = 25;
// Downward step (vs the heaviest reading seen since placement) that counts
// as the glass being lifted, independent of the absolute emptyRef. Set
// below the lightest realistic glass (coupe ≈ 120g) with margin so any
// genuine lift trips it, but well above pour-settling/HX711 noise so a
// jiggle during a glass-on-platform idle doesn't read as a removal.
const REMOVAL_STEP_G = 30;
// Upward step between two consecutive settled readings required, on top of
// the absolute PRESENT_THRESHOLD_G, to count as a placement. A real glass
// lands as a jump of its full mass in one poll; slow drift never does.
// Same magnitude as REMOVAL_STEP_G — comfortably below the lightest glass,
// comfortably above settling/drift noise.
const PRESENT_STEP_G = 30;
// Drift handling while we believe the platform is empty. Slow drift
// (HX711 thermal/electrical) gets absorbed every few minutes; a sharp
// negative excursion means emptyRef is wrong and is re-anchored
// immediately.
const DRIFT_RETARE_INTERVAL_MS = 5 * 60 * 1000;
const DRIFT_RETARE_BAND_G = 10;

let glassPresent = false;
// Raw-grams reading taken to represent the empty platform. Null until
// the first successful STABLE read seeds it. Lives only in this module —
// never written into the firmware's HX711 tare offset.
let emptyRef = null;
// Heaviest reading seen since the current present transition. Drives the
// relative downward-step removal check. Meaningless while !glassPresent.
let peakWhilePresent = 0;
// Previous settled reading, for the single-poll step that gates placement.
// Null until the first read; updated only on successful (stable) reads so
// the step is always measured between two real, settled samples.
let lastReading = null;
let lastDriftUpdateAt = 0;
let timer = null;
let pollInFlight = false;

// Exposed so the serialPour pre-pour wait can use the same delta math
// instead of comparing raw grams against a fixed threshold (which, after
// any admin TARE, would mean something different to it than to us).
export function getEmptyRef() {
  return emptyRef;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, POLL_INTERVAL_MS);
}

async function tick() {
  timer = null;
  // pollInFlight guard: a tick that ran long (slow serial, settling STABLE)
  // shouldn't double-fire with the next scheduled one.
  if (pollInFlight) { schedule(); return; }
  if (!isSerialReady() || getState().status !== "idle") { schedule(); return; }

  pollInFlight = true;
  try {
    const r = await readScaleStable();
    if (!r.unstable && r.grams != null) {
      const current = r.grams;

      // First-time seed. We trust whatever's on the platform right now to
      // be "empty" — if it isn't (glass left on at boot), the
      // negative-delta self-anchor branch below picks it up on the first
      // lift.
      if (emptyRef == null) {
        emptyRef = current;
        lastDriftUpdateAt = Date.now();
      }

      const delta = current - emptyRef;
      // Single-poll step. Null on the first read of a fresh baseline, where
      // there's no prior sample to compare against — a 0 step there blocks
      // the present transition, which is correct: with no history we can't
      // distinguish a glass from a heavy empty reading anyway.
      const step = lastReading == null ? 0 : current - lastReading;

      if (!glassPresent && delta > PRESENT_THRESHOLD_G && step > PRESENT_STEP_G) {
        // A glass-sized weight both raised the absolute level past +50g AND
        // arrived as a sharp single-poll jump. The step requirement is what
        // stops slow drift from latching a false present. emptyRef stays
        // put — it's still the right "platform empty" reference for the
        // eventual removal transition. Seed the peak tracker so the
        // relative removal check has a baseline.
        glassPresent = true;
        peakWhilePresent = current;
        broadcastGlassPresent(true);
      } else if (
        glassPresent &&
        (delta < ABSENT_THRESHOLD_G || current < peakWhilePresent - REMOVAL_STEP_G)
      ) {
        // Glass removed — detected either by the weight returning toward
        // emptyRef (absolute) or by a sharp downward step from the peak
        // seen while present (relative). The relative path is what
        // recovers a stale-low emptyRef that latched a false present: an
        // empty platform never satisfies the absolute check there, but
        // lifting the glass off is a large enough drop to trip the step.
        // Either way, re-anchor emptyRef to the current (now-empty)
        // reading so accumulated drift is absorbed and subsequent
        // placements register correctly.
        glassPresent = false;
        emptyRef = current;
        lastDriftUpdateAt = Date.now();
        broadcastGlassPresent(false);
      } else if (glassPresent && current > peakWhilePresent) {
        // Track the heaviest reading while present so the relative removal
        // step is measured against the actual glass-on level, not the
        // transition-edge reading (which a top-up or settle could exceed).
        peakWhilePresent = current;
      } else if (!glassPresent && delta < -DRIFT_RETARE_BAND_G) {
        // Sharper-than-drift negative excursion while we believed we
        // were already empty. Either emptyRef was captured with weight
        // on the platform (boot-with-glass, or an admin TARE landed
        // here while a glass was present), or someone re-zeroed the
        // firmware externally. Either way, anchor now so subsequent
        // placements register correctly.
        emptyRef = current;
        lastDriftUpdateAt = Date.now();
      } else if (
        !glassPresent &&
        Math.abs(delta) < DRIFT_RETARE_BAND_G &&
        Date.now() - lastDriftUpdateAt > DRIFT_RETARE_INTERVAL_MS
      ) {
        // Slow HX711 drift while idle: slide emptyRef toward the actual
        // empty reading so the +50g threshold stays meaningful over
        // hours of uptime. Bounded by DRIFT_RETARE_BAND_G, so a quietly
        // placed glass can't be mistaken for drift here — it would
        // exceed PRESENT_THRESHOLD_G first.
        emptyRef = current;
        lastDriftUpdateAt = Date.now();
      }

      // Record this settled reading for the next poll's step calculation.
      // Only updated on stable reads, so the step always spans two real
      // samples — an unstable/skipped poll leaves the prior reading intact.
      lastReading = current;
    }
  } catch (err) {
    // Transient (serial wedge, dropped STABLE during a TOCTOU pour start).
    // Next tick handles it.
  } finally {
    pollInFlight = false;
    schedule();
  }
}

// Drop the software baseline and presence state. Called when the Arduino
// resets mid-session: setup() re-tares the HX711, so emptyRef (measured
// against the old zero) is now meaningless and would otherwise latch a
// false present. Re-seeds from scratch on the next successful STABLE read.
export function resetGlassBaseline() {
  emptyRef = null;
  peakWhilePresent = 0;
  lastReading = null;
  lastDriftUpdateAt = Date.now();
  if (glassPresent) {
    glassPresent = false;
    broadcastGlassPresent(false);
  }
}

export function startGlassWatcher() {
  onArduinoReset(resetGlassBaseline);
  // emptyRef stays null until the first successful STABLE read seeds it.
  // No boot TARE here — the firmware's setup() tare gives us a usable
  // raw-zero anchor, and the in-tick self-anchor branch recovers from
  // the "boot with a glass on the platform" case on the user's first
  // lift. Either way we never write to the firmware's tare offset from
  // this module.
  emptyRef = null;
  peakWhilePresent = 0;
  lastReading = null;
  lastDriftUpdateAt = Date.now();
  glassPresent = false;
  schedule();
}
