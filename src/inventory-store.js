// Client-side cache of which ingredients are physically loaded and have
// volume left. Populated at boot from /api/inventory; refreshed after admin
// edits and after POUR_COMPLETE. Screens read via the helpers below instead
// of re-fetching — keeps the inventory check cheap on every render.

// Bottle is "low" once it dips to this fraction of capacity (15%). Single
// constant so the inventory tab's yellow fill-bar and the dashboard card's
// donut/text agree on what counts as low — without it they'd drift.
export const LOW_BOTTLE_THRESHOLD = 0.15;

// Classify one slot for UX grouping (donut segments, list rows, fill-bar
// color). Empty is kept distinct from low — an empty bottle needs a refill,
// not the same yellow "running low" treatment as a partially-full one.
export function bottleStatus(slot) {
  if (!slot?.ingredientId) return "unloaded";
  const remaining = Number(slot.remainingOz) || 0;
  if (remaining <= 0) return "empty";
  const capacity = Number(slot.capacityOz) || 0;
  if (capacity <= 0) return "empty";
  return remaining / capacity <= LOW_BOTTLE_THRESHOLD ? "low" : "healthy";
}

const state = {
  loadedIngredients: new Set(),
  // Every ingredient ID currently referenced by an inventory slot, whether
  // the bottle has volume left or not. Used by the ingredient picker so a
  // just-added-but-now-empty bottle doesn't disappear from the catalog.
  assignedIngredients: new Set(),
  // ingredient ID → total remaining oz across all slots holding it. Lets
  // recipe-aware checks ask "do we have enough for this pour?" rather than
  // just "is the slot non-empty?", so a near-empty bottle gets caught before
  // the machine tries to dispense more than it has.
  remainingByIngredient: new Map(),
  // ingredient ID → first slot holding it. Used by calibration lookups so
  // pour-time estimates can pick a per-slot flow rate.
  slotByIngredient: new Map(),
  slotCount: 0,
  loaded: false,
};

export async function loadInventory() {
  try {
    const res = await fetch("/api/inventory");
    if (!res.ok) return;
    const data = await res.json();
    const slots = data.slots || [];
    state.loadedIngredients = new Set(
      slots.filter((s) => s.ingredientId && s.remainingOz > 0).map((s) => s.ingredientId)
    );
    state.assignedIngredients = new Set(
      slots.filter((s) => s.ingredientId).map((s) => s.ingredientId)
    );
    const remaining = new Map();
    const slotByIngredient = new Map();
    for (const s of slots) {
      if (!s.ingredientId) continue;
      remaining.set(
        s.ingredientId,
        (remaining.get(s.ingredientId) ?? 0) + (Number(s.remainingOz) || 0)
      );
      if (!slotByIngredient.has(s.ingredientId)) {
        slotByIngredient.set(s.ingredientId, s.slot);
      }
    }
    state.remainingByIngredient = remaining;
    state.slotByIngredient = slotByIngredient;
    state.slotCount = slots.length;
    state.loaded = true;
  } catch {
    // Offline / static dev — leave state untouched so pourable checks return
    // true (nothing known to be missing), which is the safer default.
  }
}

export function assignedIngredientIds() {
  return state.assignedIngredients;
}

export function isIngredientLoaded(id) {
  // Before first successful load we don't know what's loaded — treat as
  // available so the UI doesn't flash every drink as disabled on boot.
  if (!state.loaded) return true;
  return state.loadedIngredients.has(id);
}

// Total oz left for an ingredient across all slots holding it. Returns
// Infinity before the first inventory load so callers that cap pour volumes
// to remaining stock stay permissive on cold-boot, then tighten once data
// lands and a re-render happens.
export function remainingForIngredient(id) {
  if (!state.loaded) return Infinity;
  return state.remainingByIngredient.get(id) ?? 0;
}

// Per-ingredient gap between what the recipe needs and what the machine can
// actually dispense. Returns one entry per shortfall, with the reason so
// callers can distinguish "no slot" from "slot empty" from "slot too low":
//   'missing' → no slot is assigned to this ingredient
//   'empty'   → slot is assigned but at 0 oz remaining
//   'low'     → some remaining, but below the recipe's required volume
// Pass strength/amount-adjusted ingredients when the call is for a specific
// pour so the comparison reflects the actual volume about to leave the pump.
export function recipeShortfalls(requiredIngredients) {
  if (!state.loaded) return [];
  const out = [];
  for (const ing of requiredIngredients) {
    const remaining = state.remainingByIngredient.get(ing.name) ?? 0;
    if (remaining >= ing.volumeOz) continue;
    let reason;
    if (!state.assignedIngredients.has(ing.name)) reason = "missing";
    else if (remaining <= 0) reason = "empty";
    else reason = "low";
    out.push({
      name: ing.name,
      requiredOz: ing.volumeOz,
      remainingOz: remaining,
      reason,
    });
  }
  return out;
}

export function missingIngredients(drink) {
  return recipeShortfalls(drink.ingredients).map((s) => s.name);
}

export function isDrinkPourable(drink) {
  return recipeShortfalls(drink.ingredients).length === 0;
}

// True when the primary spirit (ingredients[0]) is available in the volume
// the base recipe needs — the drink is then either fully pourable, or
// completable with the user pouring missing/low modifiers by hand after the
// machine finishes. False means the recipe is structurally blocked: pouring
// it without enough primary would make a different drink.
export function isPrimaryLoaded(drink) {
  if (!state.loaded) return true;
  const primary = drink.ingredients?.[0];
  if (!primary) return true;
  const remaining = state.remainingByIngredient.get(primary.name) ?? 0;
  return remaining >= primary.volumeOz;
}

export function loadedIngredientCount() {
  return state.loadedIngredients.size;
}

export function slotCount() {
  return state.slotCount;
}

// First slot (1-based) currently holding the given ingredient, or undefined.
export function slotForIngredient(ingredientId) {
  return state.slotByIngredient.get(ingredientId);
}
