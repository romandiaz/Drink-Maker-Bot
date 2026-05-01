// Persisted drinks catalog. Seeded from drinks.js on first boot; mutations
// from /api/drinks go through here, which also re-populates the backend's
// drinks.js module so pour.js sees the edits without its own refetch.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SEED_DRINKS,
  replaceDrinks,
  EDITABLE_CATEGORY_IDS,
  GLASS_TYPES as GLASS_TYPE_LIST,
} from "../drinks.js";
import { slugify } from "../slug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const DRINKS_PATH = resolve(STATE_DIR, "drinks.json");

const EDITABLE_CATEGORIES = new Set(EDITABLE_CATEGORY_IDS);
const GLASS_TYPES = new Set(GLASS_TYPE_LIST);

let cache = null;

async function persist() {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    DRINKS_PATH,
    JSON.stringify({ drinks: cache, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  replaceDrinks(cache);
}

export async function load() {
  if (cache) return { drinks: cache };
  if (!existsSync(DRINKS_PATH)) {
    cache = SEED_DRINKS.map((d) => ({ ...d, ingredients: d.ingredients.map((i) => ({ ...i })) }));
    await persist();
    return { drinks: cache };
  }
  try {
    const raw = await readFile(DRINKS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed.drinks) ? parsed.drinks : [];
    replaceDrinks(cache);
    return { drinks: cache };
  } catch {
    // Corrupt file — reseed rather than crash.
    cache = SEED_DRINKS.map((d) => ({ ...d, ingredients: d.ingredients.map((i) => ({ ...i })) }));
    await persist();
    return { drinks: cache };
  }
}

function uniqueId(base) {
  if (!cache.some((d) => d.id === base)) return base;
  let n = 2;
  while (cache.some((d) => d.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// Shape-check and normalize a client payload. Unknown keys dropped; invalid
// values coerced or rejected. Returns the cleaned drink or throws.
function normalize(input, { existingId } = {}) {
  if (!input || typeof input !== "object") throw new Error("payload required");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("name required");

  const category = EDITABLE_CATEGORIES.has(input.category) ? input.category : null;
  if (!category) throw new Error("invalid category");

  const glassType = GLASS_TYPES.has(input.glassType) ? input.glassType : "rocks";
  const tagline = typeof input.tagline === "string" ? input.tagline.trim() : "";
  const color = typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)
    ? input.color
    : "#888888";
  const garnish = typeof input.garnish === "string" && input.garnish ? input.garnish : null;
  const topUp = typeof input.topUp === "string" && input.topUp ? input.topUp : null;
  const needsIce = Boolean(input.needsIce);

  const rawIngredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  const ingredients = rawIngredients
    .filter((i) => i && typeof i.name === "string" && i.name)
    .map((i) => ({
      name: i.name,
      volumeOz: Number.isFinite(Number(i.volumeOz)) ? Math.max(0.1, Number(i.volumeOz)) : 0.5,
    }));
  if (ingredients.length === 0) throw new Error("at least one ingredient required");

  const id = existingId || uniqueId(slugify(name) || "drink");
  return { id, name, tagline, category, glassType, ingredients, garnish, topUp, needsIce, color };
}

export async function create(payload) {
  if (!cache) await load();
  const drink = normalize(payload);
  cache.push(drink);
  await persist();
  return drink;
}

export async function update(id, payload) {
  if (!cache) await load();
  const idx = cache.findIndex((d) => d.id === id);
  if (idx < 0) throw new Error("not found");
  const drink = normalize(payload, { existingId: id });
  cache[idx] = drink;
  await persist();
  return drink;
}

export async function remove(id) {
  if (!cache) await load();
  const idx = cache.findIndex((d) => d.id === id);
  if (idx < 0) throw new Error("not found");
  cache.splice(idx, 1);
  await persist();
  return { ok: true };
}
