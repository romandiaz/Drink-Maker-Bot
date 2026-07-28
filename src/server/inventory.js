// Physical-pump inventory: one row per pump slot, persisted to JSON. A slot
// records only what's physical to it — which ingredient is loaded and how much
// volume is left. Bottle size, cost, and ABV are attributes of the ingredient
// itself and live in ingredients-store.js, so they persist when an ingredient
// is unloaded. The admin screen edits this; mockPour() decrements remainingOz.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BOTTLE_OZ } from "../ingredient-defaults.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const INVENTORY_PATH = resolve(STATE_DIR, "inventory.json");

const SLOT_COUNT = 16;

// Seed used on first boot when no inventory.json exists. The 16 defaults
// cover every ingredient referenced by the stock recipe set, so a fresh
// install can pour any drink in drinks.js out of the box.
const SEED_SLOTS = [
  "gin",
  "vodka",
  "whiskey",
  "light-rum",
  "tequila",
  "campari",
  "sweet-vermouth",
  "vermouth",
  "triple-sec",
  "simple-syrup",
  "bitters",
  "lime-juice",
  "lemon-juice",
  "orange-juice",
  "cranberry-juice",
  "soda",
];

function emptyInventory() {
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slots.push({
      slot: i + 1,
      ingredientId: SEED_SLOTS[i] ?? null,
      // A freshly-seeded slot starts full at the default bottle size.
      remainingOz: SEED_SLOTS[i] ? DEFAULT_BOTTLE_OZ : 0,
    });
  }
  return { slots, updatedAt: new Date().toISOString() };
}

let cache = null;
const listeners = new Set();

// Notify subscribers (index.js wires this to a WS broadcast) so every
// connected tablet's inventory-store cache stays in sync without polling.
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit() {
  for (const l of listeners) {
    try { l(cache); } catch (e) { console.error("inventory listener error:", e); }
  }
}

// Bring a loaded file up to the current shape: pad/truncate to SLOT_COUNT rows
// and drop the legacy per-slot capacityOz / costPerBottle fields (those moved
// to ingredients-store.js). Returns `raw` unchanged when nothing needed fixing
// so the caller can skip a redundant re-write; otherwise a fresh object.
function normalizeToSlotCount(raw) {
  const src = Array.isArray(raw.slots) ? raw.slots : [];
  let changed = src.length !== SLOT_COUNT;
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const existing = src[i];
    if (existing) {
      if ("capacityOz" in existing || "costPerBottle" in existing) changed = true;
      slots.push({
        slot: i + 1,
        ingredientId:
          typeof existing.ingredientId === "string" && existing.ingredientId
            ? existing.ingredientId
            : null,
        remainingOz: Number.isFinite(existing.remainingOz)
          ? Math.max(0, Number(existing.remainingOz))
          : 0,
      });
    } else {
      slots.push({ slot: i + 1, ingredientId: null, remainingOz: 0 });
    }
  }
  return changed ? { slots, updatedAt: new Date().toISOString() } : raw;
}

export async function loadInventory() {
  if (cache) return cache;
  if (!existsSync(INVENTORY_PATH)) {
    cache = emptyInventory();
    await persist(cache);
    return cache;
  }
  try {
    const raw = await readFile(INVENTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeToSlotCount(parsed);
    cache = normalized;
    // Persist the upgraded shape so the file matches the current SLOT_COUNT.
    if (normalized !== parsed) await persist(cache);
    return cache;
  } catch {
    // Corrupt file — rebuild rather than crash the backend.
    cache = emptyInventory();
    await persist(cache);
    return cache;
  }
}

async function persist(inventory) {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(INVENTORY_PATH, JSON.stringify(inventory, null, 2), "utf8");
}

// Normalize a client-supplied payload so garbage fields don't leak into the
// file. Shape matches emptyInventory(); unknown keys (including legacy
// capacityOz / costPerBottle) are dropped. remainingOz is no longer clamped to
// a capacity here — bottle size lives on the ingredient now — so the display
// caps the fill bar at 100% instead.
function sanitize(payload) {
  if (!payload || !Array.isArray(payload.slots)) return null;
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const src = payload.slots[i] || {};
    const ingredientId =
      typeof src.ingredientId === "string" && src.ingredientId
        ? src.ingredientId
        : null;
    const remainingOz = Number.isFinite(src.remainingOz)
      ? Math.max(0, Number(src.remainingOz))
      : 0;
    slots.push({
      slot: i + 1,
      ingredientId,
      remainingOz: Number(remainingOz.toFixed(2)),
    });
  }
  return { slots, updatedAt: new Date().toISOString() };
}

export async function saveInventory(payload) {
  const clean = sanitize(payload);
  if (!clean) throw new Error("invalid inventory payload");
  cache = clean;
  await persist(cache);
  emit();
  return cache;
}

// Re-read from disk after a backup restore, then notify subscribers so every
// tablet's inventory cache refreshes.
export async function reloadFromDisk() {
  cache = null;
  await loadInventory();
  emit();
}

// A measured value this far above what the recipe asked for is treated as a
// bad scale reading rather than a real overpour, and the recipe volume is used
// instead. The firmware stops the pump at (target - overshoot guard), so a
// healthy pour always lands just about at target — this only ever fires when
// something leaned on the platform mid-pour. Bounds the damage a single bad
// reading can do to a bottle level without discarding honest small variance.
const MAX_MEASURED_RATIO = 2;

// Volume to actually deduct for one ingredient. `actualOz` is what the load
// cell measured; it's absent on the mock path and on any pour the scale
// couldn't measure, in which case we fall back to the recipe volume.
function deductionOz(ing) {
  const measured = Number(ing.actualOz);
  if (!Number.isFinite(measured) || measured < 0) return ing.volumeOz;
  if (measured > ing.volumeOz * MAX_MEASURED_RATIO) return ing.volumeOz;
  return measured;
}

// Deduct `ingredients` from the first matching slot for each ID. Slots with
// insufficient volume are clamped to zero rather than erroring — the pour has
// already physically happened by the time this is called.
//
// Each entry may carry an `actualOz` measured by the load cell (serialPour
// sets it from the firmware's "DONE <grams>"). Deducting what was really
// poured rather than what the recipe asked for makes bottle levels
// self-correcting: per-pour error stops accumulating, so a level that starts
// accurate stays accurate across a whole bottle instead of drifting.
export async function consume(ingredients) {
  const inv = await loadInventory();
  for (const ing of ingredients) {
    const slot = inv.slots.find(
      (s) => s.ingredientId === ing.name && s.remainingOz > 0
    );
    if (!slot) continue;
    const next = Math.max(0, slot.remainingOz - deductionOz(ing));
    slot.remainingOz = Number(next.toFixed(2));
  }
  inv.updatedAt = new Date().toISOString();
  await persist(inv);
  emit();
  return inv;
}

// Zero a slot's remaining volume. Called when the firmware reports no-flow —
// the pump ran but the weight never moved, so whatever the bookkeeping said,
// this bottle can't deliver. Writing 0 is what takes the slot out of service:
// the UI shows it empty and drinks needing it are blocked, instead of every
// guest in turn rediscovering the same dead bottle.
export async function markSlotEmpty(slot) {
  const inv = await loadInventory();
  const row = inv.slots.find((s) => s.slot === slot);
  if (!row || row.remainingOz === 0) return inv;
  row.remainingOz = 0;
  inv.updatedAt = new Date().toISOString();
  await persist(inv);
  emit();
  return inv;
}
