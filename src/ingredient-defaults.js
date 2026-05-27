// Seed / fallback values for the persistent per-ingredient attribute store.
// Kept in its own module with no DOM or fetch dependency so both the Node
// backend (server/ingredients-store.js) and the browser cache
// (ingredient-store.js) can import it.

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
