// Client-side cache of per-slot pump flow rates. Mirrors inventory-store.js
// — populated at boot, refreshed after admin maintenance edits, read
// synchronously by pour-time estimate code paths.

import { DEFAULT_FLOW_OZ_PER_SEC } from "./drinks.js";
import { slotForIngredient } from "./inventory-store.js";

const state = {
  defaultFlowOzPerSec: DEFAULT_FLOW_OZ_PER_SEC,
  flowRateBySlot: new Map(),
  loaded: false,
};

export async function loadCalibration() {
  try {
    const res = await fetch("/api/calibration");
    if (!res.ok) return;
    const data = await res.json();
    state.defaultFlowOzPerSec = Number.isFinite(data.defaultFlowOzPerSec)
      ? data.defaultFlowOzPerSec
      : DEFAULT_FLOW_OZ_PER_SEC;
    const map = new Map();
    if (data.flowRateBySlot && typeof data.flowRateBySlot === "object") {
      for (const [k, v] of Object.entries(data.flowRateBySlot)) {
        const slot = Number(k);
        const rate = Number(v);
        if (Number.isInteger(slot) && Number.isFinite(rate)) {
          map.set(slot, rate);
        }
      }
    }
    state.flowRateBySlot = map;
    state.loaded = true;
  } catch {
    // Static dev server / offline — leave defaults in place.
  }
}

export function defaultFlowOzPerSec() {
  return state.defaultFlowOzPerSec;
}

export function flowRateForSlot(slot) {
  if (!Number.isFinite(slot)) return state.defaultFlowOzPerSec;
  const rate = state.flowRateBySlot.get(slot);
  return Number.isFinite(rate) ? rate : state.defaultFlowOzPerSec;
}

export function isSlotCalibrated(slot) {
  return state.flowRateBySlot.has(slot);
}

// Pluggable for estimatePourSeconds. Resolves the slot holding the given
// ingredient ID and returns its rate; null when nothing is loaded so the
// drinks.js helper falls back to the default rate.
export function flowRateForIngredient(ingredientId) {
  const slot = slotForIngredient(ingredientId);
  if (!slot) return null;
  return flowRateForSlot(slot);
}

export function isCalibrationLoaded() {
  return state.loaded;
}
