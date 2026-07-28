// Static per-ingredient data with no DOM or fetch dependency, so both the Node
// backend (server/ingredients-store.js, server/leds.js) and the browser
// (ingredient-store.js, ingredients.js) can import it.
//
// Two kinds of data live here: seed / fallback values for the persistent
// attribute store (ABV, bottle size), and the fixed liquid-color palette, which
// is presentation constant rather than an editable attribute.

// Approximate alcohol-by-volume as a 0–1 fraction — the starting point for an
// ingredient's editable ABV attribute. Covers spirits, liqueurs, and the one
// alcoholic top-up (Mexican beer). Anything not listed — juices, syrups, soda,
// tonic — seeds at 0 and stays non-alcoholic until an admin sets it on the
// Ingredients screen. Values are typical for the category; exact products vary.
export const INGREDIENT_ABV = {
  gin: 0.4,
  vodka: 0.4,
  "vanilla-vodka": 0.35,
  whiskey: 0.4,
  "light-rum": 0.4,
  "dark-rum": 0.4,
  "coconut-rum": 0.21,
  tequila: 0.4,
  campari: 0.24,
  vermouth: 0.17,
  "sweet-vermouth": 0.16,
  "triple-sec": 0.3,
  "blue-curacao": 0.25,
  cointreau: 0.4,
  "st-germain": 0.2,
  kahlua: 0.2,
  midori: 0.2,
  hpnotiq: 0.17,
  "peach-schnapps": 0.18,
  bitters: 0.44,
  "mexican-beer": 0.045,
};

// Fallback bottle capacity (oz) for an ingredient with no recorded size —
// ~750 ml, the most common spirit bottle.
export const DEFAULT_BOTTLE_OZ = 25;

// Approximate liquid colors used by the layered-glass visualizer and by the
// LED strip's dispenser zone. Picked to read at a glance on the kiosk's dark
// surface — saturated enough that small bands stay visible, but tuned toward
// "what the bottle looks like" rather than candy-bright. Spirit colors mirror
// shotIngredients[].color where they overlap. Unknown IDs fall back to a
// neutral grey via ingredientColor() in ingredients.js.
export const INGREDIENT_COLORS = {
  gin: "#D6E8EC",
  vodka: "#E8EEF2",
  "vanilla-vodka": "#F0E8C0",
  whiskey: "#C98A3F",
  "light-rum": "#E8D8B0",
  "dark-rum": "#8C5A2A",
  "coconut-rum": "#EDE6CC",
  tequila: "#E8E0A8",
  campari: "#D13B2F",
  vermouth: "#EDE0B0",
  "sweet-vermouth": "#A8482F",
  "triple-sec": "#F0D88A",
  "blue-curacao": "#1A8FE0",
  cointreau: "#F0E8D8",
  "st-germain": "#EFE5C0",
  kahlua: "#3A2418",
  midori: "#6BC44A",
  hpnotiq: "#7FD3D9",
  "peach-schnapps": "#F4B88A",
  "simple-syrup": "#F2E8C9",
  bitters: "#5A1F18",
  soda: "#DCEEF6",
  "lemon-lime-soda": "#E8EFC8",
  "lemon-juice": "#F4E690",
  "lime-juice": "#C8DC75",
  "orange-juice": "#F39C2A",
  "cranberry-juice": "#B8203A",
  "pineapple-juice": "#F6CB52",
  "grapefruit-juice": "#F2A8A8",
  "coconut-cream": "#F0EAD6",
  orgeat: "#E8D9B0",
  grenadine: "#C2113C",
  "ginger-beer": "#E0C68A",
  "ginger-ale": "#F0E0B0",
  cola: "#5A341F",
  "mexican-beer": "#EBC872",
};
