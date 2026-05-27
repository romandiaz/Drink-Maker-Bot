import { textInputModal } from "./text-input-modal.js";
import { showToast } from "./toast.js";
import { slugify } from "../slug.js";
import { putJSON } from "../api.js";
import { loadIngredients } from "../ingredient-store.js";

// Unified "add an ingredient" flow, shared by every place a user can introduce
// a new ingredient — the admin Ingredients tab's add button and the ingredient
// picker's "+ New" tile. Collects a name, slugifies it to an ID, and persists a
// default attribute record so the ingredient is a known, editable ingredient
// (it shows on the Ingredients tab) even before it's used in any recipe or slot.
//
// `host` is the node the name-entry modal mounts into; `onCreated(id)` fires
// with the new — or, on a slug collision, existing — ingredient ID. Returns the
// modal element so callers that manage their own teardown can track it.
export function promptNewIngredient({ host, onCreated }) {
  const modal = textInputModal({
    label: "New ingredient name",
    value: "",
    maxLength: 40,
    onDone: async (name) => {
      modal.remove();
      if (name == null) return; // cancelled
      const id = slugify(name);
      if (!id) return;
      try {
        // An empty patch creates a default record; idempotent, so a name that
        // slugs to an existing ID simply keeps that ingredient as-is.
        await putJSON(`/api/ingredients/${id}`, {});
        await loadIngredients();
      } catch (e) {
        console.error(e);
        showToast(`Couldn't add ingredient — ${e.message}`);
        return;
      }
      onCreated(id);
    },
  });
  host.appendChild(modal);
  return modal;
}
