// What the tubing currently contains, and when the machine was last cleaned.
//
// Persisted rather than kept in memory because `linesState: "soap"` has to
// survive a crash or a power cut. If the server dies halfway through a deep
// clean, the lines really are still full of soap when it comes back up, and
// clean-cycle.js re-locks the machine on boot on the strength of this file.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const CLEANING_PATH = resolve(STATE_DIR, "cleaning.json");

// 'drink' — normal service, lines hold whatever is in the bottles.
// 'air'   — drained or dried, lines are empty.
// 'soap'  — UNSAFE TO POUR. Only a rinse (or an explicit admin override)
//           clears this.
// 'water' — rinsed but not yet dried; safe, just watery on the next pour.
const LINE_STATES = ["drink", "air", "soap", "water"];

function emptyState() {
  return { linesState: "drink", lastCleanedAt: null, updatedAt: new Date().toISOString() };
}

function sanitize(payload) {
  const linesState = LINE_STATES.includes(payload?.linesState)
    ? payload.linesState
    : "drink";
  const stamp = payload?.lastCleanedAt;
  const lastCleanedAt =
    typeof stamp === "string" && !Number.isNaN(Date.parse(stamp)) ? stamp : null;
  return { linesState, lastCleanedAt, updatedAt: new Date().toISOString() };
}

let cache = null;
const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const l of listeners) {
    try {
      l(cache);
    } catch (e) {
      console.error("cleaning listener error:", e);
    }
  }
}

export async function loadCleaning() {
  if (cache) return cache;
  if (!existsSync(CLEANING_PATH)) {
    cache = emptyState();
    await persist(cache);
    return cache;
  }
  try {
    cache = sanitize(JSON.parse(await readFile(CLEANING_PATH, "utf8")));
  } catch {
    cache = emptyState();
    await persist(cache);
  }
  return cache;
}

async function persist(data) {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(CLEANING_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function setLinesState(linesState) {
  const current = await loadCleaning();
  if (current.linesState === linesState) return current;
  cache = sanitize({ ...current, linesState });
  await persist(cache);
  emit();
  return cache;
}

export async function markCleaned() {
  const current = await loadCleaning();
  cache = sanitize({ ...current, lastCleanedAt: new Date().toISOString() });
  await persist(cache);
  emit();
  return cache;
}

// Re-read after a backup restore, same contract as the other stores.
export async function reloadFromDisk() {
  cache = null;
  await loadCleaning();
  emit();
}
