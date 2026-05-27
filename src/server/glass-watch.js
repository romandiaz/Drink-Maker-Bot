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
//   absent → present   when delta > PRESENT_THRESHOLD_G   (emptyRef unchanged)
//   present → absent   when delta < ABSENT_THRESHOLD_G    (emptyRef <- current)
//
// Asymmetric thresholds give us hysteresis without a separate
// stickiness timer: a glass has to clear +50g to count as placed, but
// has to fall back below +25g to count as removed.
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
import { isSerialReady } from "./serial.js";

const POLL_INTERVAL_MS = 1000;
// Asymmetric thresholds with hysteresis. The lightest realistic glass
// (coupe ≈ 120g) clears +50g comfortably; +25g for the return trip means
// even a wobbly placement doesn't oscillate between present/absent.
const PRESENT_THRESHOLD_G = 50;
const ABSENT_THRESHOLD_G  = 25;
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
let lastDriftUpdateAt = 0;
let timer = null;
let pollInFlight = false;

export function getGlassPresent() {
  return glassPresent;
}

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

      if (!glassPresent && delta > PRESENT_THRESHOLD_G) {
        // Something heavy enough to be a glass appeared. emptyRef stays
        // put — it's still the right "platform empty" reference for the
        // eventual removal transition.
        glassPresent = true;
        broadcastGlassPresent(true);
      } else if (glassPresent && delta < ABSENT_THRESHOLD_G) {
        // Weight dropped back to near-zero relative to our reference:
        // glass removed. Re-anchor emptyRef to the current reading so
        // any drift accumulated while the glass was sitting on the
        // platform is absorbed in one go.
        glassPresent = false;
        emptyRef = current;
        lastDriftUpdateAt = Date.now();
        broadcastGlassPresent(false);
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
    }
  } catch (err) {
    // Transient (serial wedge, dropped STABLE during a TOCTOU pour start).
    // Next tick handles it.
  } finally {
    pollInFlight = false;
    schedule();
  }
}

export function startGlassWatcher() {
  // emptyRef stays null until the first successful STABLE read seeds it.
  // No boot TARE here — the firmware's setup() tare gives us a usable
  // raw-zero anchor, and the in-tick self-anchor branch recovers from
  // the "boot with a glass on the platform" case on the user's first
  // lift. Either way we never write to the firmware's tare offset from
  // this module.
  emptyRef = null;
  lastDriftUpdateAt = Date.now();
  glassPresent = false;
  schedule();
}
