// Canned maintenance sequences for the admin Maintenance tab.
//
// Three operations:
//   - prime: short pump run to push liquid through air-filled tubing after a
//     bottle swap. Default 6 s.
//   - clean: longer pump run, intended for use with a water bottle in the
//     slot to flush the tubing. Default 15 s.
//   - calibrate: dispense a known volume using the *current* flow-rate guess
//     for the slot. The admin then enters the actual measured volume and the
//     server updates the slot's rate so future pour-time estimates and
//     gram-based POURs match reality.
//
// In mock mode the runner just sleeps for the requested duration so the dev
// loop on a laptop without an Arduino still exercises the UI flow. In serial
// mode every routine (prime/flush/calibrate) is dispatched as the existing
// `POUR <slot> <grams>` firmware command — duration is converted to a grams
// target via the slot's current flow rate. That keeps maintenance compatible
// with the firmware we already have rather than introducing a PUMP command.

import {
  loadCalibration,
  flowRateForSlot,
  setSlotRate,
} from "./calibration.js";
import { loadInventory, saveInventory } from "./inventory.js";
import { isSerialReady, sendCommand } from "./serial.js";

const ML_PER_OZ = 29.5735;
const DEFAULT_DENSITY_G_PER_ML = 1.0;

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

  const cal = await loadCalibration();
  const rate = flowRateForSlot(cal, slot);
  const ozDispensed = (durationMs / 1000) * rate;

  if (isSerialReady()) {
    // Convert duration → grams via the slot's calibrated rate so we can use
    // the firmware's existing POUR command (it only understands volumes).
    // Generous timeout — the firmware streams PROGRESS during the pour, so
    // the actual ceiling is the per-progress idle window in serial.js, but
    // we still cap the overall command in case the firmware never starts.
    const grams = ozDispensed * ML_PER_OZ * DEFAULT_DENSITY_G_PER_ML;
    const timeoutMs = Math.max(5000, Math.round(durationMs * 1.5) + 2000);
    const response = await sendCommand(`POUR ${slot} ${grams.toFixed(2)}`, {
      timeoutMs,
    });
    if (response.startsWith("ERR")) {
      throw new Error(`firmware: ${response}`);
    }
  } else {
    await sleep(durationMs);
  }

  if (decrementInventory) {
    await decrementSlot(slot, ozDispensed);
  }
}

// --- Calibration pour ---

// Dispense `targetOz` from `slot` using the *current* rate so the admin can
// measure how much actually came out. Inventory deduction happens inside
// the firmware loop in serial mode (consume() is the right call there too,
// but keeping consume tied to recipe pours avoids accounting drift); for
// mock mode we deduct here.
export async function runCalibrationPour(slot, targetOz) {
  if (!Number.isInteger(slot) || slot < 1) throw new Error("invalid slot");
  if (!Number.isFinite(targetOz) || targetOz <= 0) {
    throw new Error("invalid volume");
  }

  if (isSerialReady()) {
    const grams = targetOz * ML_PER_OZ * DEFAULT_DENSITY_G_PER_ML;
    const response = await sendCommand(`POUR ${slot} ${grams.toFixed(2)}`, {
      timeoutMs: 60_000,
    });
    if (response.startsWith("ERR")) {
      throw new Error(`firmware: ${response}`);
    }
  } else {
    // Mock: pretend the pump runs at the slot's calibrated rate.
    const cal = await loadCalibration();
    const rate = flowRateForSlot(cal, slot);
    const ms = (targetOz / rate) * 1000;
    await sleep(ms);
  }
  // Speculatively decrement the bottle by the *target* volume. The admin
  // will likely measure something close to it; we'll let the user reconcile
  // by editing the bottle level manually if a calibration is way off.
  await decrementSlot(slot, targetOz);
}

// Convert "I asked for X oz, the cup actually held Y oz" into a new flow
// rate. The current rate produced X oz in T seconds (per the firmware/timer);
// the bottle actually moved Y oz in those same T seconds. New rate is
// oldRate * (Y / X).
export async function recordCalibrationResult(slot, targetOz, actualOz) {
  if (!Number.isFinite(targetOz) || targetOz <= 0) throw new Error("invalid target");
  if (!Number.isFinite(actualOz) || actualOz <= 0) throw new Error("invalid actual");
  const cal = await loadCalibration();
  const oldRate = flowRateForSlot(cal, slot);
  const newRate = oldRate * (actualOz / targetOz);
  return setSlotRate(slot, newRate);
}
