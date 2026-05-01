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

// Top-up display labels. Most read as "splash of X"; beer is poetically a
// "float". Falls back to "splash of {id}" for unknown IDs so an admin can add
// a new top-up via the editor without touching this file.
const TOP_UP_LABELS = {
  "ginger-beer": { list: "splash of ginger beer", prose: "a splash of ginger beer" },
  "cola": { list: "splash of cola", prose: "a splash of cola" },
  "mexican-beer": { list: "Mexican beer float", prose: "a Mexican beer float" },
  "tonic": { list: "splash of tonic", prose: "a splash of tonic" },
};

export function formatTopUpList(id) {
  return TOP_UP_LABELS[id]?.list ?? `splash of ${formatIngredient(id)}`;
}

export function formatTopUpProse(id) {
  return TOP_UP_LABELS[id]?.prose ?? `a splash of ${formatIngredient(id)}`;
}

export function topUpIds() {
  return Object.keys(TOP_UP_LABELS);
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
