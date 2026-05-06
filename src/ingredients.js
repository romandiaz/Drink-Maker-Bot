// Single source of truth for known ingredient IDs. Derived from drinks[] and
// shotIngredients so a newly-added drink's ingredient is automatically pickable
// in the admin screen without duplicating a list here.

import { drinks, shotIngredients } from "./drinks.js";
import { assignedIngredientIds } from "./inventory-store.js";

// Approximate liquid colors used by the layered-glass visualizer. Picked to
// read at a glance on the kiosk's dark surface — saturated enough that small
// bands stay visible, but tuned toward "what the bottle looks like" rather
// than candy-bright. Spirit colors mirror shotIngredients[].color where they
// overlap. Unknown IDs fall back to a neutral grey via ingredientColor().
const INGREDIENT_COLORS = {
  gin: "#D6E8EC",
  vodka: "#E8EEF2",
  whiskey: "#C98A3F",
  rum: "#D4B07A",
  tequila: "#E8E0A8",
  campari: "#D13B2F",
  vermouth: "#EDE0B0",
  "sweet-vermouth": "#A8482F",
  "triple-sec": "#F0D88A",
  "simple-syrup": "#F2E8C9",
  bitters: "#5A1F18",
  soda: "#DCEEF6",
  "lemon-juice": "#F4E690",
  "lime-juice": "#C8DC75",
  "orange-juice": "#F39C2A",
  "cranberry-juice": "#B8203A",
  "pineapple-juice": "#F6CB52",
  "coconut-cream": "#F0EAD6",
  orgeat: "#E8D9B0",
  grenadine: "#C2113C",
};

export function ingredientColor(id) {
  return INGREDIENT_COLORS[id] ?? "#888888";
}

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
