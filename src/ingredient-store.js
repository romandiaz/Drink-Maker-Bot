// Client-side cache of persistent per-ingredient attributes: ABV, bottle size,
// and cost. Mirrors inventory-store.js / calibration-store.js — populated at
// boot from /api/ingredients, kept fresh by the INGREDIENTS_UPDATED WS
// broadcast, and read synchronously by the screens. These attributes belong to
// the ingredient itself, so they persist whether or not it's loaded in a slot.

import { INGREDIENT_ABV, DEFAULT_BOTTLE_OZ } from "./ingredient-defaults.js";
import { on as onWS } from "./ws.js";

// ingredient ID → { abv, bottleSizeOz, costPerBottle }
const records = new Map();

export async function loadIngredients() {
  try {
    const res = await fetch("/api/ingredients");
    if (!res.ok) return;
    const data = await res.json();
    records.clear();
    for (const [id, rec] of Object.entries(data.ingredients || {})) {
      if (rec && typeof rec === "object") records.set(id, rec);
    }
  } catch {
    // Offline / static dev server — leave the cache as-is; the resolvers below
    // fall back to the seed defaults so screens still render sane numbers.
  }
}

// Resolve an ingredient's attributes, filling any gap from the seed defaults so
// callers always get a complete record — even for an ingredient that's never
// been loaded or edited and therefore has no stored record at all.
export function ingredientAttributes(id) {
  const rec = records.get(id) || {};
  return {
    abv: Number.isFinite(rec.abv) ? rec.abv : (INGREDIENT_ABV[id] ?? 0),
    bottleSizeOz: Number.isFinite(rec.bottleSizeOz) ? rec.bottleSizeOz : DEFAULT_BOTTLE_OZ,
    costPerBottle: Number.isFinite(rec.costPerBottle) ? rec.costPerBottle : 0,
  };
}

export function ingredientAbv(id) {
  return ingredientAttributes(id).abv;
}

export function bottleSizeOz(id) {
  return ingredientAttributes(id).bottleSizeOz;
}

export function costPerBottle(id) {
  return ingredientAttributes(id).costPerBottle;
}

// Every ingredient ID with a stored attribute record. Lets allIngredientIds()
// surface an ingredient added through the catalog before it's referenced by
// any recipe or pump slot.
export function recordedIngredientIds() {
  return records.keys();
}

// Refresh whenever the server says an ingredient's attributes changed (any
// tablet's edit). Errors are swallowed inside loadIngredients.
onWS("INGREDIENTS_UPDATED", () => { loadIngredients(); });
