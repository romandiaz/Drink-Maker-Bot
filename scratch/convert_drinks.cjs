const fs = require('fs');

const mlToOz = {
  150: 4.5, // changed to 4.5
  130: 4.0, // used in gin-rickey (50/20/130 -> 1.5/0.75/4.0)
  120: 4.0, // garibaldi
  100: 3.0, // collins
  90: 3.0, // americano/madras
  60: 2.0, // classic base
  50: 1.5, // refresher base
  45: 1.5, // kamikaze/bronx base
  40: 1.5, // cosmo base (wait, let's use 1.5 for 40ml too to make it standard)
  30: 1.0, // negroni
  25: 0.75, // sours
  20: 0.5, // margarita/kamikaze (will be manually adjusted if needed)
  15: 0.5, // simple syrup
  10: 0.25, // vermouth/simple
  2: 0.1 // bitters
};

// specific overrides
// Bronx: 45->1.5, 15->0.5, 15->0.5, 30->1.0
// Gin Rickey: 50->1.5, 20->0.75, 130->4.0
// Margarita: 50->1.5, 25->0.75, 20->0.5
// White Lady: 50->1.5, 25->0.75, 20->0.5
// Kamikaze: 45->1.5, 20->0.75, 20->0.75

let drinksJs = fs.readFileSync('src/drinks.js', 'utf8');

// replace the ml values
drinksJs = drinksJs.replace(/volumeMl: (\d+)/g, (match, mlStr) => {
  const ml = parseInt(mlStr, 10);
  let oz = mlToOz[ml];
  
  if (oz === undefined) {
    console.log("UNMAPPED ML:", ml);
    oz = ml / 30; // fallback
  }
  
  return `volumeOz: ${oz}`;
});

// Update Kamikaze specifically for 20ml lime/triple to be 0.75
drinksJs = drinksJs.replace(
  /id: 'kamikaze',([\s\S]*?)volumeOz: 0.5\s*\},([\s\S]*?)volumeOz: 0.5\s*\}/g,
  "id: 'kamikaze',$1volumeOz: 0.75 },$2volumeOz: 0.75 }"
);

// Update Gin Rickey 20ml lime to be 0.75
drinksJs = drinksJs.replace(
  /id: 'gin-rickey',([\s\S]*?)volumeOz: 0.5\s*\}/g,
  "id: 'gin-rickey',$1volumeOz: 0.75 }"
);

// Update Manhattan 20ml sweet vermouth to be 0.75
drinksJs = drinksJs.replace(
  /id: 'manhattan',([\s\S]*?)volumeOz: 0.5\s*\}/g,
  "id: 'manhattan',$1volumeOz: 0.75 }"
);

// update the helper functions
const newHelpers = `// Strength shifts the *ratio* of primary spirit to modifiers while keeping the
// total volume constant. Stronger pulls volume from the modifiers into the
// primary; lighter pushes the other way. Total oz dispensed stays the same.
//
// Convention: ingredients[0] is the primary spirit (true for every drink in
// this file). Modifiers are the remaining ingredients combined.
//
// Clamps:
//   - Modifier total stays at ≥ 0.1 oz or 10% of original (whichever is larger),
//     so Martini-like drinks don't have their vermouth scaled to zero on "strong".
//   - Each individual modifier gets a 0.05 oz floor after rounding, so trace
//     ingredients (e.g. Old Fashioned bitters) don't disappear entirely.
//   - Any rounding drift is absorbed into the primary so the total is exact.
export function adjustedIngredients(drink, strength) {
  const ings = drink.ingredients;
  if (strength === 'regular' || ings.length < 2) {
    return ings.map((i) => ({ ...i }));
  }

  const factor = strength === 'light' ? 0.7 : 1.3;
  const total = ings.reduce((s, i) => s + i.volumeOz, 0);
  const restTotal = total - ings[0].volumeOz;
  const minRest = Math.min(restTotal, Math.max(0.1, restTotal * 0.1));
  const maxPrimary = Math.max(0.1, total - minRest);

  let newPrimary = ings[0].volumeOz * factor;
  newPrimary = Math.min(newPrimary, maxPrimary);
  newPrimary = Math.max(newPrimary, 0.1);

  const restFactor = restTotal > 0 ? (total - newPrimary) / restTotal : 1;

  const out = ings.map((ing, i) => {
    if (i === 0) return { ...ing, volumeOz: Number(newPrimary.toFixed(2)) };
    return {
      ...ing,
      volumeOz: Math.max(0.05, Number((ing.volumeOz * restFactor).toFixed(2))),
    };
  });

  // Absorb rounding drift into the primary so the total matches the original.
  const drift = total - out.reduce((s, i) => s + i.volumeOz, 0);
  out[0].volumeOz = Math.max(0.1, Number((out[0].volumeOz + drift).toFixed(2)));
  return out;
}

export const totalVolumeOz = (ingredients) =>
  ingredients.reduce((s, i) => s + i.volumeOz, 0);

// Pour-time estimate in seconds: setup overhead + per-oz pour rate.
export function estimatePourSeconds(drink, strength) {
  const adjusted = adjustedIngredients(drink, strength);
  return Math.round(15 + totalVolumeOz(adjusted) * 4.0);
}
`;

drinksJs = drinksJs.replace(/\/\/ Strength shifts[\s\S]*?\}[\s\n]*$/, newHelpers);

fs.writeFileSync('src/drinks.js', drinksJs);
console.log('done converting drinks.js');
