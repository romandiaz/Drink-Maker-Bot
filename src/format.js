// Display-format helpers shared across screens. The two garnish variants read
// as list ("1 olive") vs. prose ("an olive") depending on the surrounding copy.
// `topUp` is a separate concept from `garnish`: it's an ingredient the user
// pours themselves after the machine finishes (ginger beer, cola, beer float),
// since the machine has no slot for it.

export function formatIngredient(name) {
  return name.replace(/-/g, " ");
}

// Garnishes that don't take a "1 " count prefix in list form (e.g. rims).
const GARNISH_LIST_OVERRIDES = {
  "salt-rim-lime": "salt rim, lime wedge",
  "chili-rim": "chili rim",
};

export function formatGarnishList(g) {
  if (GARNISH_LIST_OVERRIDES[g]) return GARNISH_LIST_OVERRIDES[g];
  return `1 ${formatIngredient(g)}`;
}

export function formatGarnishProse(g) {
  if (g === "salt-rim-lime") return "salt rim and a lime wedge";
  const noun = g.replace(/-/g, " ");
  const article = /^[aeiou]/.test(noun) ? "an" : "a";
  return `${article} ${noun}`;
}

// Known post-pour top-up ingredients — the shortlist the recipe editor offers.
// An admin can still set a top-up to any ingredient; this just feeds the
// editor's dropdown via topUpIds().
const TOP_UP_IDS = ["ginger-beer", "cola", "lemon-lime-soda", "mexican-beer", "tonic"];

// Top-up as a finish instruction with its actual volume. The machine doesn't
// pour it, so the reminder names the amount — "4.0 oz ginger beer" — instead of
// the old "a splash of…", which undersold multi-ounce top-ups. `amount` scales
// it the same way the pour scales (a 2× drink tops up with 2× mixer).
export function formatTopUpProse(topUp, amount = 1) {
  const oz = (topUp.volumeOz || 0) * amount;
  return `${oz.toFixed(1)} oz ${formatIngredient(topUp.name)}`;
}

export function topUpIds() {
  return TOP_UP_IDS;
}

// Render a duration in seconds as "45s" / "2m" / "2m 15s". Pour estimates can
// run past a minute, and a bare "135s" reads worse than "2m 15s".
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

// Oxford-comma list join. "A" → "A"; "A,B" → "A and B"; "A,B,C" → "A, B, and C".
export function joinList(parts) {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

// Format an ingredient that the user pours by hand because the machine doesn't
// have it loaded. Bitters is special-cased to dashes — bartenders measure it
// that way, and "0.1 oz of bitters" reads worse than "2 dashes of bitters".
export function formatByHand(ing) {
  if (ing.name === "bitters") {
    const dashes = Math.max(1, Math.round(ing.volumeOz / 0.04));
    return `${dashes} ${dashes === 1 ? "dash" : "dashes"} of bitters`;
  }
  return `${ing.volumeOz} oz ${formatIngredient(ing.name)}`;
}
