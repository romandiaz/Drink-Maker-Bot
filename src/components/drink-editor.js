import { categories, EDITABLE_CATEGORY_IDS, GLASS_TYPES } from "../drinks.js";
import { ingredientPicker } from "./ingredient-picker.js";
import { textInputModal } from "./text-input-modal.js";
import { topUpIds } from "../format.js";
import {
  segmented,
  fieldRow,
  textField,
  colorPalette,
  ingredientRow,
} from "./editor-fields.js";

// Full-screen editor for adding or editing one drink. Hosts its own modals
// for text entry and ingredient picking. Calls onSave(draft) / onCancel()
// / onDelete() — parent owns persistence and navigation.

const EDITABLE_CATEGORIES = EDITABLE_CATEGORY_IDS
  .map((id) => categories.find((c) => c.id === id))
  .filter(Boolean);
const GARNISHES = [
  "olive", "cherry", "lemon-wedge", "lime-wedge", "orange-peel",
  "salt-rim-lime", "chili-rim",
];
// Top-ups are post-pour ingredients the user adds themselves (the machine
// has no slot for them). Driven by format.js so the labels and option list
// stay in one place.
const TOP_UPS = topUpIds();
const COLOR_PALETTE = [
  "#F0E8C8", "#D4A574", "#F49E4C", "#C94E3A",
  "#E85D9B", "#B8483A", "#C6E8AD", "#5DCAA5",
  "#C8E6F0", "#E8EEF2", "#A0623A", "#888888",
];

function makeDraft(drink) {
  return {
    id: drink?.id ?? null,
    name: drink?.name ?? "",
    tagline: drink?.tagline ?? "",
    category: drink?.category ?? EDITABLE_CATEGORIES[0].id,
    glassType: drink?.glassType ?? "rocks",
    color: drink?.color ?? COLOR_PALETTE[0],
    garnish: drink?.garnish ?? null,
    topUp: drink?.topUp ?? null,
    needsIce: drink?.needsIce ?? false,
    ingredients: (drink?.ingredients ?? [{ name: "gin", volumeOz: 1.5 }]).map((i) => ({ ...i })),
  };
}

function head(title, onCancel, onSave) {
  const head = document.createElement("div");
  head.className = "drink-editor__head";
  const titleEl = document.createElement("div");
  titleEl.className = "drink-editor__title";
  titleEl.id = "drink-editor-title";
  titleEl.textContent = title;
  head.appendChild(titleEl);
  const actions = document.createElement("div");
  actions.className = "drink-editor__actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "drink-editor__btn drink-editor__btn--ghost tappable";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", onCancel);
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "drink-editor__btn drink-editor__btn--primary tappable";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", onSave);
  actions.append(cancelBtn, saveBtn);
  head.appendChild(actions);
  return head;
}

function deleteRow(onDelete) {
  const row = document.createElement("div");
  row.className = "drink-editor__delete-row";
  const del = document.createElement("button");
  del.type = "button";
  del.className = "drink-editor__delete tappable";
  del.setAttribute("aria-live", "assertive");
  del.textContent = "Delete drink";
  let confirming = false;
  // Two-tap confirmation: first tap arms, second commits. Armed state
  // resets after 3s so a stray tap doesn't linger as a live deletion trigger.
  del.addEventListener("click", () => {
    if (!confirming) {
      confirming = true;
      del.textContent = "Tap again to confirm";
      del.classList.add("is-confirming");
      setTimeout(() => {
        confirming = false;
        del.textContent = "Delete drink";
        del.classList.remove("is-confirming");
      }, 3000);
      return;
    }
    onDelete();
  });
  row.appendChild(del);
  return row;
}

export function drinkEditor({ drink, onSave, onCancel, onDelete }) {
  const draft = makeDraft(drink);

  const overlay = document.createElement("div");
  overlay.className = "drink-editor";

  const panel = document.createElement("div");
  panel.className = "drink-editor__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "drink-editor-title");
  panel.appendChild(
    head(drink ? "Edit drink" : "New drink", () => onCancel?.(), () => onSave?.(draft))
  );

  const body = document.createElement("div");
  body.className = "drink-editor__body";
  panel.appendChild(body);

  function openText(label, key, max) {
    const modal = textInputModal({
      label,
      value: draft[key],
      maxLength: max,
      onDone: (v) => {
        if (v !== null) draft[key] = v;
        modal.remove();
        render();
      },
    });
    overlay.appendChild(modal);
  }

  function openIngredientPicker(idx) {
    const picker = ingredientPicker({
      current: draft.ingredients[idx]?.name ?? null,
      onCancel: () => picker.remove(),
      onPick: (id) => {
        if (id) draft.ingredients[idx].name = id;
        picker.remove();
        render();
      },
    });
    overlay.appendChild(picker);
  }

  function ingredientsBlock() {
    const wrap = document.createElement("div");
    wrap.className = "editor-ings";
    draft.ingredients.forEach((ing, idx) => {
      wrap.appendChild(ingredientRow(ing, {
        onPick: () => openIngredientPicker(idx),
        onVolume: (v) => { draft.ingredients[idx].volumeOz = Number(v.toFixed(2)); render(); },
        onRemove: () => {
          if (draft.ingredients.length <= 1) return;
          draft.ingredients.splice(idx, 1);
          render();
        },
      }));
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "editor-ing-add tappable";
    add.textContent = "+ Add ingredient";
    add.addEventListener("click", () => {
      draft.ingredients.push({ name: "gin", volumeOz: 0.5 });
      render();
    });
    wrap.appendChild(add);
    return wrap;
  }

  function render() {
    body.innerHTML = "";

    const nameField = textField(draft.name, "Tap to name the drink");
    nameField.addEventListener("click", () => openText("Drink name", "name", 40));
    body.appendChild(fieldRow("Name", nameField));

    const taglineField = textField(draft.tagline, "Optional tagline");
    taglineField.addEventListener("click", () => openText("Tagline", "tagline", 60));
    body.appendChild(fieldRow("Tagline", taglineField));

    body.appendChild(fieldRow("Category", segmented({
      options: EDITABLE_CATEGORIES.map((c) => c.id),
      value: draft.category,
      labelOf: (id) => EDITABLE_CATEGORIES.find((c) => c.id === id).name,
      onChange: (v) => { draft.category = v; render(); },
    })));

    body.appendChild(fieldRow("Glass", segmented({
      options: GLASS_TYPES,
      value: draft.glassType,
      labelOf: (g) => g[0].toUpperCase() + g.slice(1),
      onChange: (v) => { draft.glassType = v; render(); },
    })));

    body.appendChild(fieldRow("Color", colorPalette(COLOR_PALETTE, draft.color, (c) => {
      draft.color = c;
      render();
    })));

    body.appendChild(fieldRow("Garnish", segmented({
      options: [null, ...GARNISHES],
      value: draft.garnish,
      labelOf: (g) => g === null ? "None" : g.replace(/-/g, " "),
      onChange: (v) => { draft.garnish = v; render(); },
    })));

    body.appendChild(fieldRow("Top-up", segmented({
      options: [null, ...TOP_UPS],
      value: draft.topUp,
      labelOf: (t) => t === null ? "None" : t.replace(/-/g, " "),
      onChange: (v) => { draft.topUp = v; render(); },
    })));

    body.appendChild(fieldRow("Ice needed", segmented({
      options: [false, true],
      value: draft.needsIce,
      labelOf: (v) => v ? "Yes" : "No",
      onChange: (v) => { draft.needsIce = v; render(); },
    })));

    body.appendChild(fieldRow("Ingredients", ingredientsBlock()));

    if (drink && onDelete) body.appendChild(deleteRow(onDelete));
  }

  render();
  overlay.appendChild(panel);
  return overlay;
}
