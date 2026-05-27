// Cost math for the stats pages. Per-ounce cost is an ingredient's bottle price
// divided by its bottle size — the same basis inventory-store.js's barValue
// uses. Ingredients with no price recorded cost nothing, so spend totals only
// reflect priced ingredients; computeSpend reports coverage so the UI can flag
// when most ingredients are unpriced and the totals undercount reality.

import { costPerBottle, bottleSizeOz } from "./ingredient-store.js";

export function costPerOz(name) {
  const cost = costPerBottle(name);
  const size = bottleSizeOz(name);
  return cost > 0 && size > 0 ? cost / size : 0;
}

export function isPriced(name) {
  return costPerOz(name) > 0;
}

// Cost of one pour: each ingredient's per-oz cost × volume poured.
export function entryCost(entry) {
  let c = 0;
  for (const ing of entry.ingredients || []) {
    c += costPerOz(ing.name) * (Number(ing.volumeOz) || 0);
  }
  return c;
}

// Total spend across the log plus pricing coverage. `pouredCount` is how many
// distinct ingredients appear in the log; `pricedCount` how many of those have
// a cost — the gap is what's missing from totalSpent.
export function computeSpend(entries) {
  let totalSpent = 0;
  const pouredNames = new Set();
  for (const e of entries || []) {
    totalSpent += entryCost(e);
    for (const ing of e.ingredients || []) pouredNames.add(ing.name);
  }
  const pricedCount = [...pouredNames].filter(isPriced).length;
  return { totalSpent, pricedCount, pouredCount: pouredNames.size };
}

// Total spend grouped by drink, keyed the same way the backend aggregates
// stats (drinkId, falling back to drinkName). Lets the drink leaderboard show
// an average cost per pour for each drink.
export function costByDrink(entries) {
  const map = new Map();
  for (const e of entries || []) {
    const key = e.drinkId || e.drinkName;
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + entryCost(e));
  }
  return map;
}

// "$123" for whole-dollar totals, "$0.80" for small per-item amounts — chosen
// by magnitude so a $40.50 total doesn't lose its cents but $123 stays clean.
export function money(n) {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}
