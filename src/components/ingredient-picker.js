import { allIngredientIds, ingredientName } from "../ingredients.js";
import { textInputModal } from "./text-input-modal.js";
import { slugify } from "../slug.js";

// Full-screen overlay that picks one ingredient ID. Tap outside the panel, or
// select an option, to dismiss. `current` is the currently-assigned ID and
// gets a highlighted border.
//
// Defaults match the admin flow (full ingredient catalog, "+ New" tile, null
// option to clear a slot). Pass `ids` / `allowNew` / `allowEmpty` / `title`
// to tailor it for non-admin uses — e.g. the guest "Build your own" screen
// only wants loaded ingredients and no way to invent new ones on the fly.

export function ingredientPicker({
  current,
  onPick,
  onCancel,
  ids,
  allowNew = true,
  allowEmpty = true,
  title = "Assign ingredient",
  disabledIds,
} = {}) {
  // Set of ingredient IDs that should render but be unselectable — used by
  // the build-your-own flow to grey out ingredients already in the recipe so
  // the user can't accidentally double-add the same bottle.
  const disabled = new Set(disabledIds || []);
  const overlay = document.createElement("div");
  overlay.className = "admin-picker";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) onCancel();
  });

  const panel = document.createElement("div");
  panel.className = "admin-picker__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "admin-picker-title");

  const titleEl = document.createElement("div");
  titleEl.className = "admin-picker__title";
  titleEl.id = "admin-picker-title";
  titleEl.textContent = title;
  panel.appendChild(titleEl);

  const grid = document.createElement("div");
  grid.className = "admin-picker__grid";

  function openNewIngredient() {
    const modal = textInputModal({
      label: "New ingredient name",
      value: "",
      maxLength: 40,
      onDone: (v) => {
        modal.remove();
        if (!v) return;
        const id = slugify(v);
        if (!id) return;
        onPick(id);
      },
    });
    overlay.appendChild(modal);
  }

  if (allowNew) {
    const addNew = document.createElement("button");
    addNew.type = "button";
    addNew.className = "admin-picker__opt admin-picker__opt--new tappable";
    addNew.textContent = "+ New ingredient";
    addNew.addEventListener("click", openNewIngredient);
    grid.appendChild(addNew);
  }

  const baseIds = ids ?? allIngredientIds();
  const options = allowEmpty ? [null, ...baseIds] : [...baseIds];
  for (const id of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-picker__opt tappable";
    btn.textContent = ingredientName(id);
    if (id === null) btn.classList.add("is-empty-opt");
    if (id === current) btn.classList.add("is-selected");
    if (id !== null && disabled.has(id)) {
      btn.classList.add("is-disabled");
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => onPick(id));
    }
    grid.appendChild(btn);
  }
  panel.appendChild(grid);
  overlay.appendChild(panel);
  return overlay;
}
