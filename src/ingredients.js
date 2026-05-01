// Single source of truth for known ingredient IDs. Derived from drinks[] and
// shotIngredients so a newly-added drink's ingredient is automatically pickable
// in the admin screen without duplicating a list here.

import { drinks, shotIngredients } from "./drinks.js";
import { assignedIngredientIds } from "./inventory-store.js";

// Friendly display names. IDs not in this map fall back to a title-cased
// conversion of the ID itself (e.g. "simple-syrup" → "Simple Syrup").
const PRETTY_NAMES = {
  gin: "Gin",
  vodka: "Vodka",
  whiskey: "Whiskey",
  rum: "Rum",
  tequila: "Tequila",
  campari: "Campari",
  vermouth: "Dry Vermouth",
  "sweet-vermouth": "Sweet Vermouth",
  "triple-sec": "Triple Sec",
  "simple-syrup": "Simple Syrup",
  bitters: "Bitters",
  soda: "Soda / Tonic",
  "lemon-juice": "Lemon Juice",
  "lime-juice": "Lime Juice",
  "orange-juice": "Orange Juice",
  "cranberry-juice": "Cranberry Juice",
  "pineapple-juice": "Pineapple Juice",
  "coconut-cream": "Coconut Cream",
  orgeat: "Orgeat",
  grenadine: "Grenadine",
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
  return [...set].sort();
}
