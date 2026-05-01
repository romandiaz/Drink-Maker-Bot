// Client-side cache of which ingredients are physically loaded and have
// volume left. Populated at boot from /api/inventory; refreshed after admin
// edits and after POUR_COMPLETE. Screens read via the helpers below instead
// of re-fetching — keeps the inventory check cheap on every render.

const state = {
  loadedIngredients: new Set(),
  // Every ingredient ID currently referenced by an inventory slot, whether
  // the bottle has volume left or not. Used by the ingredient picker so a
  // just-added-but-now-empty bottle doesn't disappear from the catalog.
  assignedIngredients: new Set(),
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

export function missingIngredients(drink) {
  if (!state.loaded) return [];
  const missing = [];
  for (const ing of drink.ingredients) {
    if (!state.loadedIngredients.has(ing.name)) missing.push(ing.name);
  }
  return missing;
}

export function isDrinkPourable(drink) {
  return missingIngredients(drink).length === 0;
}

// True when the primary spirit (ingredients[0]) is loaded — the drink is then
// either fully pourable, or completable with the user pouring missing modifiers
// by hand after the machine finishes. False means the recipe is structurally
// blocked: pouring it without the primary would make a different drink.
export function isPrimaryLoaded(drink) {
  if (!state.loaded) return true;
  const primary = drink.ingredients?.[0]?.name;
  if (!primary) return true;
  return state.loadedIngredients.has(primary);
}

export function loadedIngredientCount() {
  return state.loadedIngredients.size;
}

export function slotCount() {
  return state.slotCount;
}
