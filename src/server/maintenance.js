// Canned maintenance sequences for the admin Maintenance tab.
//
// Three operations:
//   - prime: short pump run to push liquid through air-filled tubing after a
//     bottle swap. Default 6 s.
//   - clean: longer pump run, intended for use with a water bottle in the
//     slot to flush the tubing. Default 15 s.
//   - calibrate: run the pump for a fixed time and let the on-board HX711
//     load cell weigh what came out. The measured grams divided by elapsed
//     seconds is the slot's flow rate (stored as oz/sec for parity with the
//     rest of the codebase, since recipes are authored in oz; we assume a
//     flat 1 g/mL across all liquids). The admin doesn't enter a number —
//     the cup just sits on the platform.
//
// In serial mode prime/clean/calibrate all use firmware primitives directly:
// `RUN <slot> <ms>` for time-based pumping, plus `TARE` and `READ` for the
// calibration measurement. In mock mode every routine sleeps for the
// requested duration so the dev loop on a laptop without an Arduino still
// exercises the UI flow.

import {
  loadCalibration,
  flowRateForSlot,
  setSlotRate,
} from "./calibration.js";
import { loadInventory, saveInventory } from "./inventory.js";
import { isSerialReady, sendCommand } from "./serial.js";

const ML_PER_OZ = 29.5735;
// Flat density covers spirits/juices to within ~5%. Per-ingredient density
// is a follow-up once syrups need accurate dosing.
const DEFAULT_DENSITY_G_PER_ML = 1.0;

// Below this we assume the bottle is dry, the pump is unprimed, or the cup
// fell off the platform — surface an error rather than persisting a wildly
// slow rate that would clamp to the calibration floor and read as nonsense.
const CALIBRATION_MIN_GRAMS = 1.0;

// A pump running for `ms` is roughly proportional to how much it dispenses,
// so even cancelled prime/clean runs should decrement remaining stock — but
// only when an ingredient is loaded. For mock mode we approximate the volume
// from the calibrated rate so dev inventory drains visibly during sweeps.
async function decrementSlot(slot, ozDispensed) {
  if (!ozDispensed || ozDispensed <= 0) return;
  const inv = await loadInventory();
  const row = inv.slots.find((s) => s.slot === slot);
  if (!row || !row.ingredientId) return;
  row.remainingOz = Number(Math.max(0, row.remainingOz - ozDispensed).toFixed(2));
  inv.updatedAt = new Date().toISOString();
  // saveInventory() runs the payload through its sanitiser, which also
  // refreshes the inventory cache — the recipe pour path's consume() helper
  // wants ingredient IDs, so we go through saveInventory instead.
  await saveInventory(inv);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// --- Time-based runs (prime / clean) ---

export async function runTimedPump(slot, durationMs, opts = {}) {
  const { decrementInventory = true } = opts;
  if (!Number.isInteger(slot) || slot < 1) throw new Error("invalid slot");
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("invalid duration");
  }

  if (isSerialReady()) {
    // Generous overall ceiling — the firmware drives the pump itself for the
    // requested duration, so we just need to outwait it. serial.js still
    // re-arms its idle timer on PROGRESS lines for the long pour path; RUN
    // is silent, so this hard cap is the only guard.
    const timeoutMs = Math.max(5000, Math.round(durationMs * 1.5) + 2000);
    const response = await sendCommand(
      `RUN ${slot} ${Math.round(durationMs)}`,
      { timeoutMs }
    );
    if (response.startsWith("ERR")) {
      throw new Error(`firmware: ${response}`);
    }
  } else {
    await sleep(durationMs);
  }

  if (decrementInventory) {
    // Best-effort decrement using the slot's current calibrated rate. The
    // bottle didn't necessarily dispense exactly this much (a freshly-primed
    // pump runs slow, an air gap dispenses nothing), but it's the best
    // estimate we have without weighing the result.
    const cal = await loadCalibration();
    const rate = flowRateForSlot(cal, slot);
    const ozDispensed = (durationMs / 1000) * rate;
    await decrementSlot(slot, ozDispensed);
  }
}

// --- Calibration measurement ---

// Run the pump for a fixed time and let the on-board scale weigh what came
// out. Returns { grams, durationSec, ozPerSec }; the admin confirms the
// result client-side before persisting via setSlotRate. Inventory is
// decremented here (the bottle did dispense this), so a re-run charges the
// bottle each time.
export async function runCalibrationMeasure(slot, durationSec) {
  if (!Number.isInteger(slot) || slot < 1) throw new Error("invalid slot");
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 30) {
    throw new Error("invalid duration");
  }

  const durationMs = Math.round(durationSec * 1000);
  let grams;

  if (isSerialReady()) {
    const tareResp = await sendCommand("TARE", { timeoutMs: 5000 });
    if (tareResp.startsWith("ERR")) throw new Error(`firmware: ${tareResp}`);

    const runTimeout = Math.max(5000, Math.round(durationMs * 1.5) + 2000);
    const runResp = await sendCommand(`RUN ${slot} ${durationMs}`, {
      timeoutMs: runTimeout,
    });
    if (runResp.startsWith("ERR")) throw new Error(`firmware: ${runResp}`);

    const readResp = await sendCommand("READ", { timeoutMs: 5000 });
    if (readResp.startsWith("ERR")) throw new Error(`firmware: ${readResp}`);
    // READ returns "WEIGHT <grams>". Parse defensively — anything else means
    // the firmware drifted from the documented protocol.
    const m = readResp.match(/^WEIGHT\s+(-?\d+(?:\.\d+)?)/);
    if (!m) throw new Error(`unexpected READ response: ${readResp}`);
    grams = parseFloat(m[1]);
  } else {
    // Mock: pretend the pump dispenses exactly at the current calibrated
    // rate. Calibrating in mock is therefore a no-op — useful for exercising
    // the UI flow without changing rates unintentionally.
    const cal = await loadCalibration();
    const rate = flowRateForSlot(cal, slot);
    await sleep(durationMs);
    grams = durationSec * rate * ML_PER_OZ * DEFAULT_DENSITY_G_PER_ML;
  }

  if (!Number.isFinite(grams) || grams < CALIBRATION_MIN_GRAMS) {
    throw new Error(
      `measured only ${Number.isFinite(grams) ? grams.toFixed(1) : "?"} g — check that the bottle isn't empty and the cup is on the platform`
    );
  }

  const ozMeasured = grams / (ML_PER_OZ * DEFAULT_DENSITY_G_PER_ML);
  const ozPerSec = ozMeasured / durationSec;

  await decrementSlot(slot, ozMeasured);

  return {
    grams: Number(grams.toFixed(2)),
    durationSec,
    ozPerSec: Number(ozPerSec.toFixed(4)),
  };
}

export async function saveCalibrationResult(slot, ozPerSec) {
  if (!Number.isInteger(slot) || slot < 1) throw new Error("invalid slot");
  if (!Number.isFinite(ozPerSec) || ozPerSec <= 0) {
    throw new Error("invalid rate");
  }
  return setSlotRate(slot, ozPerSec);
}
