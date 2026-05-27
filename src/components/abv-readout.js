// Shared "Estimated ≈ X% ABV · Y.Y standard drinks" readout. Used by the
// kiosk drink-detail screen and the mobile order sheet so the numbers and
// the wording stay in sync across surfaces. Pass the ingredients list as it
// will be served (adjusted for strength + amount, including any by-hand
// top-up like soda or juice) so the figure reflects the full drink.

import { totalVolumeOz } from "../drinks.js";
import { ingredientAbv } from "../ingredients.js";

// One standard drink ≈ 0.6 fl oz of pure ethanol (US convention).
const STANDARD_DRINK_OZ = 0.6;

function computeAbv(ingredients) {
  const totalOz = totalVolumeOz(ingredients);
  const pureOz = ingredients.reduce(
    (s, i) => s + i.volumeOz * ingredientAbv(i.name),
    0
  );
  const abvPct = totalOz > 0 ? (pureOz / totalOz) * 100 : 0;
  const stdDrinks = pureOz / STANDARD_DRINK_OZ;
  return { abvPct, stdDrinks };
}

export function abvReadout(ingredients) {
  const { abvPct, stdDrinks } = computeAbv(ingredients);

  const wrap = document.createElement("div");
  wrap.className = "abv-readout";

  const label = document.createElement("span");
  label.className = "abv-readout__label";
  label.textContent = "Estimated";

  const value = document.createElement("span");
  value.className = "abv-readout__value";
  value.textContent = `≈ ${Math.round(abvPct)}% ABV`;

  const std = document.createElement("span");
  std.className = "abv-readout__std";
  std.textContent = `${stdDrinks.toFixed(1)} standard drinks`;

  wrap.append(label, value, std);
  return wrap;
}
