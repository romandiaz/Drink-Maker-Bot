import { allIngredientIds, ingredientName } from "../ingredients.js";
import { ingredientAttributes, loadIngredients } from "../ingredient-store.js";
import { drinks, shotIngredients } from "../drinks.js";
import { assignedIngredientIds } from "../inventory-store.js";
import { capacityEditor } from "../components/capacity-editor.js";
import { promptNewIngredient } from "../components/new-ingredient.js";
import { putJSON, delJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { CLOSE_SVG } from "../icons.js";

// Ingredients view for the admin tab shell — the persistent attribute catalog.
// Lists every known ingredient (loaded or not) and lets the admin edit ABV,
// bottle size, and cost, add a brand-new ingredient, or delete an unused one.
// These attributes live on the ingredient itself, so an edit here applies to
// every slot that ever holds it. `host` is the node the modals attach to.

// Catalog grouping. Base spirits come first, then anything else alcoholic,
// then the non-alcoholic mixers and juices. ABV is the only signal needed
// beyond the known base-spirit list, so an admin-added ingredient sorts into
// the right group the moment its ABV is set.
const BASE_SPIRIT_IDS = new Set(shotIngredients.map((s) => s.id));
const GROUPS = [
  { key: "spirits", label: "Spirits" },
  { key: "liqueurs", label: "Liqueurs & Aperitifs" },
  { key: "mixers", label: "Mixers & Juices" },
];

function groupKey(id) {
  if (BASE_SPIRIT_IDS.has(id)) return "spirits";
  return ingredientAttributes(id).abv > 0 ? "liqueurs" : "mixers";
}

// IDs used by something other than the attribute store — a recipe ingredient
// or top-up, a shot spirit, or a pump slot. An ingredient absent from this set
// exists only as a catalog record and is safe to delete without leaving a
// recipe or slot pointing at an unknown ingredient.
function referencedIds() {
  const set = new Set();
  for (const d of drinks) {
    for (const i of d.ingredients) set.add(i.name);
    if (d.topUp?.name) set.add(d.topUp.name);
  }
  for (const s of shotIngredients) set.add(s.id);
  for (const id of assignedIngredientIds()) set.add(id);
  return set;
}

// Two-tap delete: first tap arms (auto-disarms after 3s), second confirms —
// matching the recipe/history delete pattern so a stray tap can't drop an
// ingredient.
function deleteButton(id, onDelete) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ingredient-row__delete tappable";
  btn.setAttribute("aria-label", `Delete ${ingredientName(id)}`);
  btn.innerHTML = CLOSE_SVG;

  let armed = false;
  let timer = null;
  btn.addEventListener("click", () => {
    if (armed) {
      clearTimeout(timer);
      onDelete(id);
      return;
    }
    armed = true;
    btn.classList.add("is-armed");
    timer = setTimeout(() => {
      armed = false;
      btn.classList.remove("is-armed");
    }, 3000);
  });
  return btn;
}

function ingredientRow(id, { onEdit, onDelete }) {
  const attrs = ingredientAttributes(id);

  const row = document.createElement("div");
  row.className = "ingredient-row";

  const main = document.createElement("button");
  main.type = "button";
  main.className = "ingredient-row__main tappable";

  const name = document.createElement("span");
  name.className = "ingredient-row__name";
  name.textContent = ingredientName(id);

  const meta = document.createElement("span");
  meta.className = "ingredient-row__meta";
  const abv = attrs.abv > 0 ? `${Math.round(attrs.abv * 100)}% ABV` : "Non-alcoholic";
  const cost = attrs.costPerBottle > 0 ? `$${attrs.costPerBottle}` : "No cost";
  meta.textContent = `${abv} · ${attrs.bottleSizeOz} oz · ${cost}`;

  main.append(name, meta);
  main.addEventListener("click", () => onEdit(id));
  row.appendChild(main);

  // Delete is offered only for orphan ingredients (see render()) — in-use
  // ingredients get no onDelete and so no button.
  if (onDelete) row.appendChild(deleteButton(id, onDelete));
  return row;
}

function groupLabel(text) {
  const label = document.createElement("div");
  label.className = "ingredient-group-label";
  label.textContent = text;
  return label;
}

export function adminIngredientsView({ host, setMeta }) {
  const element = document.createElement("div");
  element.className = "admin-body";

  let pickerEl = null;

  function addButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ingredient-add-btn tappable";
    btn.textContent = "+ Add ingredient";
    btn.addEventListener("click", openAdd);
    return btn;
  }

  function render() {
    element.innerHTML = "";
    element.appendChild(addButton());

    const ids = allIngredientIds();
    const referenced = referencedIds();
    const byGroup = { spirits: [], liqueurs: [], mixers: [] };
    for (const id of ids) byGroup[groupKey(id)].push(id);

    for (const g of GROUPS) {
      const group = byGroup[g.key];
      if (group.length === 0) continue;
      group.sort((a, b) => ingredientName(a).localeCompare(ingredientName(b)));
      element.appendChild(groupLabel(g.label));
      for (const id of group) {
        element.appendChild(
          ingredientRow(id, {
            onEdit: openEditor,
            // Only ingredients no recipe or slot uses can be deleted.
            onDelete: referenced.has(id) ? null : handleDelete,
          })
        );
      }
    }
    setMeta(`${ids.length} ingredients`);
  }

  function openAdd() {
    if (pickerEl) pickerEl.remove();
    pickerEl = promptNewIngredient({
      host,
      onCreated: (id) => {
        pickerEl = null;
        // Land straight in the attribute editor so the admin can set ABV,
        // bottle size, and cost for the ingredient they just named.
        render();
        openEditor(id);
      },
    });
  }

  function openEditor(id) {
    if (pickerEl) pickerEl.remove();
    const attrs = ingredientAttributes(id);
    pickerEl = capacityEditor({
      // No slotNum — this catalog edits the ingredient directly, not a slot.
      ingredientId: id,
      current: attrs.bottleSizeOz,
      currentCost: attrs.costPerBottle,
      currentAbv: attrs.abv,
      onCancel: () => {
        pickerEl?.remove();
        pickerEl = null;
      },
      onDone: async ({ bottleSizeOz, costPerBottle, abv }) => {
        pickerEl?.remove();
        pickerEl = null;
        try {
          await putJSON(`/api/ingredients/${id}`, { bottleSizeOz, costPerBottle, abv });
          // Reload the local cache before re-rendering so the row shows the
          // new values at once; other tablets refresh via INGREDIENTS_UPDATED.
          await loadIngredients();
          render();
        } catch (e) {
          console.error(e);
          setMeta("Save failed — retry");
          showToast(`Save failed — ${e.message}`);
        }
      },
    });
    host.appendChild(pickerEl);
  }

  async function handleDelete(id) {
    try {
      await delJSON(`/api/ingredients/${id}`);
      await loadIngredients();
      render();
    } catch (e) {
      console.error(e);
      setMeta("Delete failed — retry");
      showToast(`Delete failed — ${e.message}`);
    }
  }

  function mount() {
    setMeta("Loading…");
    // loadIngredients swallows its own errors; on failure the cache stays
    // empty and rows fall back to seed defaults, which still renders fine.
    loadIngredients().then(render);
  }

  function unmount() {
    pickerEl?.remove();
    pickerEl = null;
  }

  return { element, mount, unmount };
}
