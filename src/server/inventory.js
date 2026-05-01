// Physical-pump inventory: one row per pump slot, persisted to JSON.
// The admin screen edits this; mockPour() decrements remainingOz on completion.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const INVENTORY_PATH = resolve(STATE_DIR, "inventory.json");

const SLOT_COUNT = 16;
const DEFAULT_CAPACITY_OZ = 25; // ~750ml bottle

// Seed used on first boot when no inventory.json exists. The 16 defaults
// cover every ingredient referenced by the stock recipe set, so a fresh
// install can pour any drink in drinks.js out of the box.
const SEED_SLOTS = [
  "gin",
  "vodka",
  "whiskey",
  "rum",
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
      capacityOz: DEFAULT_CAPACITY_OZ,
      remainingOz: SEED_SLOTS[i] ? DEFAULT_CAPACITY_OZ : 0,
    });
  }
  return { slots, updatedAt: new Date().toISOString() };
}

let cache = null;

// If SLOT_COUNT changes between versions, pad existing files with empty slots
// (or truncate extras) so the rest of the code can always assume the canonical
// row count. Any newly-added rows start empty; no auto-assignment.
function normalizeToSlotCount(raw) {
  const src = Array.isArray(raw.slots) ? raw.slots : [];
  if (src.length === SLOT_COUNT) return raw;
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const existing = src[i];
    if (existing) {
      slots.push({ ...existing, slot: i + 1 });
    } else {
      slots.push({
        slot: i + 1,
        ingredientId: null,
        capacityOz: DEFAULT_CAPACITY_OZ,
        remainingOz: 0,
      });
    }
  }
  return { slots, updatedAt: new Date().toISOString() };
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
// file. Shape matches emptyInventory(); unknown keys are dropped.
function sanitize(payload) {
  if (!payload || !Array.isArray(payload.slots)) return null;
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const src = payload.slots[i] || {};
    const ingredientId =
      typeof src.ingredientId === "string" && src.ingredientId
        ? src.ingredientId
        : null;
    const capacityOz = Number.isFinite(src.capacityOz)
      ? Math.max(0, Number(src.capacityOz))
      : DEFAULT_CAPACITY_OZ;
    const remainingOz = Number.isFinite(src.remainingOz)
      ? Math.max(0, Math.min(capacityOz, Number(src.remainingOz)))
      : 0;
    slots.push({
      slot: i + 1,
      ingredientId,
      capacityOz: Number(capacityOz.toFixed(2)),
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
  return cache;
}

// Deduct `ingredients` from the first matching slot for each ID. Slots with
// insufficient volume are clamped to zero rather than erroring — the mock
// pour has already "happened" by the time this is called.
export async function consume(ingredients) {
  const inv = await loadInventory();
  for (const ing of ingredients) {
    const slot = inv.slots.find(
      (s) => s.ingredientId === ing.name && s.remainingOz > 0
    );
    if (!slot) continue;
    const next = Math.max(0, slot.remainingOz - ing.volumeOz);
    slot.remainingOz = Number(next.toFixed(2));
  }
  inv.updatedAt = new Date().toISOString();
  await persist(inv);
  return inv;
}
