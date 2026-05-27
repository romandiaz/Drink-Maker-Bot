// Per-slot flow-rate calibration. Each pump moves a slightly different amount
// of liquid per second depending on tubing length, viscosity, and how the
// pump head wore in. Storing oz/sec per slot lets the UI report accurate
// "Ready in ~Ns" estimates and lets pour timing scale correctly when an
// admin swaps a fast pump in or a thicker syrup is loaded.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const CALIBRATION_PATH = resolve(STATE_DIR, "calibration.json");

// 0.25 oz/sec ≈ 4.0 s/oz, matching the constant the codebase used before
// per-slot calibration existed. New installs land here so the first pour
// estimate is reasonable before anyone calibrates.
export const DEFAULT_FLOW_OZ_PER_SEC = 0.25;

const MIN_FLOW_OZ_PER_SEC = 0.02; // ~50 s/oz — anything slower is a bad measurement
const MAX_FLOW_OZ_PER_SEC = 5.0;  // ~0.2 s/oz — anything faster is a bad measurement

function clampFlow(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_FLOW_OZ_PER_SEC;
  return Math.max(MIN_FLOW_OZ_PER_SEC, Math.min(MAX_FLOW_OZ_PER_SEC, v));
}

function emptyCalibration() {
  return {
    defaultFlowOzPerSec: DEFAULT_FLOW_OZ_PER_SEC,
    // slot number (1-based) → oz/sec. Slots without a measurement fall back
    // to defaultFlowOzPerSec.
    flowRateBySlot: {},
    updatedAt: new Date().toISOString(),
  };
}

let cache = null;
const listeners = new Set();

// Notify subscribers (index.js wires this to a WS broadcast) so every
// connected tablet's calibration-store cache stays in sync without polling.
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit() {
  for (const l of listeners) {
    try { l(cache); } catch (e) { console.error("calibration listener error:", e); }
  }
}

export async function loadCalibration() {
  if (cache) return cache;
  if (!existsSync(CALIBRATION_PATH)) {
    cache = emptyCalibration();
    await persist(cache);
    return cache;
  }
  try {
    const raw = await readFile(CALIBRATION_PATH, "utf8");
    cache = sanitize(JSON.parse(raw));
    return cache;
  } catch {
    cache = emptyCalibration();
    await persist(cache);
    return cache;
  }
}

async function persist(data) {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(CALIBRATION_PATH, JSON.stringify(data, null, 2), "utf8");
}

function sanitize(payload) {
  const def = clampFlow(payload?.defaultFlowOzPerSec ?? DEFAULT_FLOW_OZ_PER_SEC);
  const flowRateBySlot = {};
  const src = payload?.flowRateBySlot;
  if (src && typeof src === "object") {
    for (const [k, v] of Object.entries(src)) {
      const slot = Number(k);
      if (!Number.isInteger(slot) || slot < 1) continue;
      flowRateBySlot[slot] = Number(clampFlow(v).toFixed(4));
    }
  }
  return {
    defaultFlowOzPerSec: Number(def.toFixed(4)),
    flowRateBySlot,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveCalibration(payload) {
  cache = sanitize(payload);
  await persist(cache);
  emit();
  return cache;
}

// Re-read from disk after a backup restore, then notify subscribers so every
// tablet's calibration cache refreshes.
export async function reloadFromDisk() {
  cache = null;
  await loadCalibration();
  emit();
}

// Update one slot's rate. Used by the calibration flow once an admin enters
// the actual measured volume.
export async function setSlotRate(slot, ozPerSec) {
  const cal = await loadCalibration();
  const next = { ...cal, flowRateBySlot: { ...cal.flowRateBySlot } };
  next.flowRateBySlot[slot] = Number(clampFlow(ozPerSec).toFixed(4));
  next.updatedAt = new Date().toISOString();
  cache = next;
  await persist(cache);
  emit();
  return cache;
}

export async function clearSlotRate(slot) {
  const cal = await loadCalibration();
  if (!(slot in cal.flowRateBySlot)) return cal;
  const next = { ...cal, flowRateBySlot: { ...cal.flowRateBySlot } };
  delete next.flowRateBySlot[slot];
  next.updatedAt = new Date().toISOString();
  cache = next;
  await persist(cache);
  emit();
  return cache;
}

export function flowRateForSlot(cal, slot) {
  if (!cal) return DEFAULT_FLOW_OZ_PER_SEC;
  const rate = cal.flowRateBySlot?.[slot];
  return Number.isFinite(rate) ? rate : cal.defaultFlowOzPerSec;
}
