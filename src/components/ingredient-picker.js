import { allIngredientIds, ingredientName } from "../ingredients.js";
import { textInputModal } from "./text-input-modal.js";
import { slugify } from "../slug.js";

// Full-screen overlay that picks one ingredient ID (or null to empty a slot).
// Tap outside the panel, or select an option, to dismiss. `current` is the
// currently-assigned ID and gets a highlighted border. The "+ New ingredient"
// tile opens a text-input modal so users can introduce ingredient IDs that
// aren't referenced by any existing drink or slot.

export function ingredientPicker({ current, onPick, onCancel }) {
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

  const title = document.createElement("div");
  title.className = "admin-picker__title";
  title.id = "admin-picker-title";
  title.textContent = "Assign ingredient";
  panel.appendChild(title);

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

  const addNew = document.createElement("button");
  addNew.type = "button";
  addNew.className = "admin-picker__opt admin-picker__opt--new tappable";
  addNew.textContent = "+ New ingredient";
  addNew.addEventListener("click", openNewIngredient);
  grid.appendChild(addNew);

  const options = [null, ...allIngredientIds()];
  for (const id of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-picker__opt tappable";
    btn.textContent = ingredientName(id);
    if (id === null) btn.classList.add("is-empty-opt");
    if (id === current) btn.classList.add("is-selected");
    btn.addEventListener("click", () => onPick(id));
    grid.appendChild(btn);
  }
  panel.appendChild(grid);
  overlay.appendChild(panel);
  return overlay;
}
