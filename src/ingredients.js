// Single source of truth for known ingredient IDs. Derived from drinks[] and
// shotIngredients so a newly-added drink's ingredient is automatically pickable
// in the admin screen without duplicating a list here.

import { drinks, shotIngredients } from "./drinks.js";
import { assignedIngredientIds } from "./inventory-store.js";
import { recordedIngredientIds } from "./ingredient-store.js";
import { INGREDIENT_COLORS } from "./ingredient-defaults.js";

// The palette itself lives in ingredient-defaults.js so the backend's LED
// driver can share it — this module imports the browser-only stores above and
// so can't be imported from Node.
export function ingredientColor(id) {
  return INGREDIENT_COLORS[id] ?? "#888888";
}

// Friendly display names. IDs not in this map fall back to a title-cased
// conversion of the ID itself (e.g. "simple-syrup" → "Simple Syrup").
const PRETTY_NAMES = {
  gin: "Gin",
  vodka: "Vodka",
  "vanilla-vodka": "Vanilla Vodka",
  whiskey: "Whiskey",
  "light-rum": "Light Rum",
  "dark-rum": "Dark Rum",
  "coconut-rum": "Coconut Rum",
  tequila: "Tequila",
  campari: "Campari",
  vermouth: "Dry Vermouth",
  "sweet-vermouth": "Sweet Vermouth",
  "triple-sec": "Triple Sec",
  "blue-curacao": "Blue Curaçao",
  cointreau: "Cointreau",
  "st-germain": "St-Germain",
  kahlua: "Kahlúa",
  midori: "Midori",
  hpnotiq: "Hpnotiq",
  "peach-schnapps": "Peach Schnapps",
  "simple-syrup": "Simple Syrup",
  bitters: "Bitters",
  soda: "Soda / Tonic",
  "lemon-lime-soda": "Lemon-Lime Soda",
  "lemon-juice": "Lemon Juice",
  "lime-juice": "Lime Juice",
  "orange-juice": "Orange Juice",
  "cranberry-juice": "Cranberry Juice",
  "pineapple-juice": "Pineapple Juice",
  "grapefruit-juice": "Grapefruit Juice",
  "coconut-cream": "Coconut Cream",
  orgeat: "Orgeat",
  grenadine: "Grenadine",
  "ginger-beer": "Ginger Beer",
  "ginger-ale": "Ginger Ale",
  cola: "Cola",
  "mexican-beer": "Mexican Beer",
};

export function ingredientName(id) {
  if (!id) return "Empty";
  if (PRETTY_NAMES[id]) return PRETTY_NAMES[id];
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function allIngredientIds() {
  const set = new Set();
  for (const d of drinks) for (const i of d.ingredients) set.add(i.name);
  for (const s of shotIngredients) set.add(s.id);
  // Ingredients loaded via the inventory picker may not yet appear in any
  // drink — include them so they stay pickable in the recipe editor.
  for (const id of assignedIngredientIds()) set.add(id);
  // Ingredients added through the catalog have a persistent attribute record
  // but may not be in any drink or slot yet — keep them in the list too.
  for (const id of recordedIngredientIds()) set.add(id);
  // Seed-defined ingredients surface even on a fresh install with no slots,
  // records, or recipes referencing them — keeps the seed authoritative.
  for (const id of Object.keys(PRETTY_NAMES)) set.add(id);
  return [...set].sort();
}

// ABV is now a persistent, admin-editable per-ingredient attribute. The detail
// screen's estimated-ABV readout reads it through ingredient-store.js; this
// re-export keeps `ingredients.js` the single import surface for callers.
export { ingredientAbv } from "./ingredient-store.js";
