// Client-side cache of which categories the admin has hidden. Loaded from
// /api/categories at boot and refreshed after admin edits. The `categories`
// array in drinks.js stays the canonical source of truth — this layer just
// answers "should category X surface in the main UI?".

import { getJSON, putJSON } from "./api.js";

let disabled = new Set();
let loaded = false;

export async function loadCategoriesConfig() {
  try {
    const data = await getJSON("/api/categories");
    disabled = new Set(data.disabledIds || []);
    loaded = true;
  } catch {
    // Offline / static dev — leave the set empty so nothing is hidden.
  }
}

export function isCategoryEnabled(id) {
  if (!loaded) return true;
  return !disabled.has(id);
}

export function disabledCategoryIds() {
  return [...disabled];
}

export async function setDisabledCategories(ids) {
  const data = await putJSON("/api/categories", { disabledIds: ids });
  disabled = new Set(data.disabledIds || []);
}
