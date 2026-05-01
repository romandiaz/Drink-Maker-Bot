// Central app state. Screens read `appState` directly; mutate only via actions below.
// No framework — when a screen needs to re-render after a state change, it re-renders itself.

export const appState = {
  currentCategory: null, // category id, e.g. 'classics'
  selectedDrink: null, // drink id
  searchQuery: "",
  pendingOrder: null, // { drinkId, strength, amount, ice, garnish }
  pourProgress: null, // { step, pct, status } — updated by WebSocket handler
  lastDrink: null, // drink id of the most recently poured drink
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
