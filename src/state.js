// Central app state. Screens read `appState` directly; mutate only via actions below.
// No framework — when a screen needs to re-render after a state change, it re-renders itself.

function emptyBuildDraft() {
  return { name: "", ingredients: [] };
}

export const appState = {
  currentCategory: null, // category id, e.g. 'classics'
  selectedDrink: null, // drink id
  searchQuery: "",
  pendingOrder: null, // { drinkId, strength, amount, ice, garnish }
  pourProgress: null, // { step, pct, status } — updated by WebSocket handler
  lastDrink: null, // drink id of the most recently poured drink
  // Build-your-own working draft — lives here (not in the screen's closure)
  // so it survives navigations: cancelling a pour goes back to the same
  // recipe the user was editing, and "Another" from the complete screen
  // can re-seed it. Cleared on POUR_COMPLETE so a fresh visit starts empty.
  buildDraft: emptyBuildDraft(),
};

export function setCurrentCategory(id) {
  appState.currentCategory = id;
}

export function setSelectedDrink(id) {
  appState.selectedDrink = id;
}

export function setPendingOrder(order) {
  appState.pendingOrder = order;
}

export function setLastDrink(id) {
  appState.lastDrink = id;
}

// Replace the whole draft — used by complete-screen "Another" to seed from
// the just-poured custom drink. Ingredients are deep-cloned so later edits
// on the draft don't reach back into the source object.
export function setBuildDraft(draft) {
  appState.buildDraft = {
    name: typeof draft?.name === "string" ? draft.name : "",
    ingredients: Array.isArray(draft?.ingredients)
      ? draft.ingredients.map((i) => ({ name: i.name, volumeOz: Number(i.volumeOz) || 0 }))
      : [],
  };
}

export function clearBuildDraft() {
  appState.buildDraft = emptyBuildDraft();
}
