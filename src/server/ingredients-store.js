// Persistent per-ingredient attributes: ABV, bottle size, and cost. Keyed by
// ingredient ID and persisted to JSON. Unlike inventory.js — which tracks the
// physical bottle currently in each pump slot — these attributes belong to the
// ingredient itself and survive being unloaded from every slot.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INGREDIENT_ABV, DEFAULT_BOTTLE_OZ } from "../ingredient-defaults.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const INGREDIENTS_PATH = resolve(STATE_DIR, "ingredients.json");
const INVENTORY_PATH = resolve(STATE_DIR, "inventory.json");

const MAX_BOTTLE_OZ = 200;
const MAX_COST = 1000;

let cache = null;
const listeners = new Set();

// Notify subscribers (index.js wires this to a WS broadcast) so every
// connected tablet's ingredient-store cache stays in sync without polling.
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit() {
  for (const l of listeners) {
    try { l(cache); } catch (e) { console.error("ingredients listener error:", e); }
  }
}

function clampAbv(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
function clampSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_BOTTLE_OZ;
  return Math.max(1, Math.min(MAX_BOTTLE_OZ, v));
}
function clampCost(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(MAX_COST, v);
}

// A complete, sanitized record. Missing fields fall back to the ABV seed map
// and the default bottle size so every record the store hands out is whole.
function normalizeRecord(raw, id) {
  return {
    abv: Number(clampAbv(raw?.abv ?? INGREDIENT_ABV[id] ?? 0).toFixed(4)),
    bottleSizeOz: Number(clampSize(raw?.bottleSizeOz ?? DEFAULT_BOTTLE_OZ).toFixed(2)),
    costPerBottle: Number(clampCost(raw?.costPerBottle ?? 0).toFixed(2)),
  };
}

// First-boot seed: harvest the per-slot capacityOz / costPerBottle that used to
// live in inventory.json into proper per-ingredient records, so upgrading an
// existing install doesn't lose that data. Reads inventory.json directly (not
// via inventory.js) so it runs correctly regardless of module load order —
// inventory.js strips those legacy fields the first time it loads the file.
async function seedFromInventory() {
  const ingredients = {};
  if (!existsSync(INVENTORY_PATH)) return ingredients;
  try {
    const inv = JSON.parse(await readFile(INVENTORY_PATH, "utf8"));
    for (const slot of Array.isArray(inv.slots) ? inv.slots : []) {
      if (!slot || typeof slot.ingredientId !== "string" || !slot.ingredientId) continue;
      ingredients[slot.ingredientId] = normalizeRecord(
        { bottleSizeOz: slot.capacityOz, costPerBottle: slot.costPerBottle },
        slot.ingredientId
      );
    }
  } catch {
    // Corrupt inventory — start with an empty catalog rather than crashing.
  }
  return ingredients;
}

async function persist() {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(INGREDIENTS_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function sanitize(raw) {
  const ingredients = {};
  const src = raw && typeof raw.ingredients === "object" && raw.ingredients
    ? raw.ingredients : {};
  for (const [id, rec] of Object.entries(src)) {
    if (typeof id !== "string" || !id) continue;
    ingredients[id] = normalizeRecord(rec, id);
  }
  return { ingredients, updatedAt: new Date().toISOString() };
}

export async function load() {
  if (cache) return cache;
  if (!existsSync(INGREDIENTS_PATH)) {
    cache = { ingredients: await seedFromInventory(), updatedAt: new Date().toISOString() };
    await persist();
    return cache;
  }
  try {
    cache = sanitize(JSON.parse(await readFile(INGREDIENTS_PATH, "utf8")));
    return cache;
  } catch {
    // Corrupt file — reseed rather than crash the backend.
    cache = { ingredients: await seedFromInventory(), updatedAt: new Date().toISOString() };
    await persist();
    return cache;
  }
}

// Re-read from disk after a backup restore, then notify subscribers so every
// tablet's ingredient cache refreshes.
export async function reloadFromDisk() {
  cache = null;
  await load();
  emit();
}

// Update (or create) one ingredient's record. `patch` may carry any subset of
// { abv, bottleSizeOz, costPerBottle }; omitted fields keep their current value
// (or the seed default when there's no record yet).
export async function updateAttributes(id, patch) {
  if (typeof id !== "string" || !id) throw new Error("ingredient id required");
  if (!patch || typeof patch !== "object") throw new Error("payload required");
  if (!cache) await load();
  const current = cache.ingredients[id] || normalizeRecord({}, id);
  const merged = {
    abv: patch.abv ?? current.abv,
    bottleSizeOz: patch.bottleSizeOz ?? current.bottleSizeOz,
    costPerBottle: patch.costPerBottle ?? current.costPerBottle,
  };
  cache.ingredients[id] = normalizeRecord(merged, id);
  cache.updatedAt = new Date().toISOString();
  await persist();
  emit();
  return cache.ingredients[id];
}

// Delete one ingredient's attribute record. The Ingredients tab only offers
// this for ingredients not referenced by any recipe or slot, so removing the
// record can't leave a drink pointing at a now-unknown ingredient.
export async function remove(id) {
  if (!cache) await load();
  if (!(id in cache.ingredients)) throw new Error("not found");
  delete cache.ingredients[id];
  cache.updatedAt = new Date().toISOString();
  await persist();
  emit();
  return { ok: true };
}
