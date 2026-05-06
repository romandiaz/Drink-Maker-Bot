import { drinks, categories, isDrinkEnabled } from "../drinks.js";
import { drinkEditor } from "../components/drink-editor.js";
import { glass } from "../components/glass.js";
import { reloadDrinks, reloadCategoriesConfig, reloadInventory } from "../app.js";
import { postJSON, putJSON, delJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { isDrinkPourable, missingIngredients } from "../inventory-store.js";
import { ingredientName } from "../ingredients.js";
import {
  isCategoryEnabled,
  disabledCategoryIds,
  setDisabledCategories,
} from "../category-store.js";

// Recipes view for the admin tab shell. Lists drinks grouped by category and
// lets admins add / edit / delete. CRUD hits /api/drinks and calls
// reloadDrinks() so the rest of the UI picks up changes next time it reads
// the drinks array.

const drinkUrl = (id) => `/api/drinks/${encodeURIComponent(id)}`;

function recipeCard(drink, { onEdit, onToggle, categoryHidden }) {
  const card = document.createElement("div");
  card.className = "recipe-card tappable";
  if (!isDrinkEnabled(drink)) card.classList.add("is-hidden");
  // Cards in a hidden category get the same dimmed/dashed treatment so the
  // admin can see at a glance that those drinks won't surface either — but
  // the per-drink toggle still reflects the drink's own enabled state.
  if (categoryHidden) card.classList.add("is-cat-hidden");

  // The card body opens the editor; the visibility toggle lives in its own
  // child button so a tap on the toggle doesn't also fire the editor.
  const body = document.createElement("button");
  body.type = "button";
  body.className = "recipe-card__body";
  body.addEventListener("click", () => onEdit(drink));

  const glassWrap = document.createElement("div");
  glassWrap.className = "recipe-card__glass";
  glassWrap.appendChild(glass(drink, { width: 32 }));
  body.appendChild(glassWrap);

  const info = document.createElement("div");
  info.className = "recipe-card__info";
  const name = document.createElement("div");
  name.className = "recipe-card__name";
  name.textContent = drink.name;
  const meta = document.createElement("div");
  meta.className = "recipe-card__meta";
  const pourable = isDrinkPourable(drink);
  // Small colored dot prefixes the meta line — green when every ingredient is
  // loaded with enough volume, dim otherwise. The card's title carries the
  // missing-ingredient list so admins can hover-inspect on a desktop session.
  const statusDot = document.createElement("span");
  statusDot.className = "recipe-card__status";
  statusDot.classList.add(pourable ? "is-pourable" : "is-blocked");
  meta.appendChild(statusDot);
  const metaText = document.createElement("span");
  metaText.className = "recipe-card__meta-text";
  if (pourable) {
    metaText.textContent = drink.ingredients.map((i) => i.name).join(" · ");
  } else {
    const missing = missingIngredients(drink).map(ingredientName);
    metaText.textContent = `Needs ${missing.join(", ")}`;
    card.title = `Missing: ${missing.join(", ")}`;
  }
  meta.appendChild(metaText);
  info.append(name, meta);
  body.appendChild(info);
  card.appendChild(body);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "recipe-card__toggle tappable";
  toggle.textContent = isDrinkEnabled(drink) ? "Hide" : "Show";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggle(drink);
  });
  card.appendChild(toggle);

  return card;
}

function categoryToggleButton(cat, { onToggle }) {
  const enabled = isCategoryEnabled(cat.id);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recipe-section-head__toggle tappable";
  btn.textContent = enabled ? "Hide" : "Show";
  btn.addEventListener("click", () => onToggle(cat.id));
  return btn;
}

export function adminRecipesView({ host, setMeta }) {
  const element = document.createElement("div");
  element.className = "admin-body admin-body--recipes";

  let editorEl = null;

  function updateMeta() {
    const total = drinks.length;
    const visible = drinks.filter(isDrinkEnabled).length;
    const hidden = total - visible;
    setMeta(
      hidden
        ? `${total} recipe${total === 1 ? "" : "s"} · ${hidden} hidden`
        : `${total} recipe${total === 1 ? "" : "s"}`
    );
  }

  function render() {
    element.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "recipe-toolbar";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "recipe-add tappable";
    addBtn.textContent = "+ New drink";
    addBtn.addEventListener("click", () => openEditor(null));
    toolbar.appendChild(addBtn);
    element.appendChild(toolbar);

    for (const cat of categories) {
      // Shots is a utility flow, not a free-form recipe category — there are
      // no recipe cards under it and the admin doesn't need to hide it.
      if (cat.id === "shots") continue;
      const bucket = drinks.filter((d) => d.category === cat.id);
      if (bucket.length === 0) continue;

      const sectionHead = document.createElement("div");
      sectionHead.className = "recipe-section-head";
      sectionHead.style.setProperty("--accent", cat.accent);
      if (!isCategoryEnabled(cat.id)) sectionHead.classList.add("is-hidden");

      const title = document.createElement("span");
      title.className = "recipe-section-head__title";
      title.textContent = isCategoryEnabled(cat.id)
        ? cat.name
        : `${cat.name} · hidden`;
      sectionHead.appendChild(title);
      sectionHead.appendChild(
        categoryToggleButton(cat, { onToggle: handleToggleCategory })
      );
      element.appendChild(sectionHead);

      const grid = document.createElement("div");
      grid.className = "recipe-grid";
      const categoryHidden = !isCategoryEnabled(cat.id);
      for (const d of bucket)
        grid.appendChild(
          recipeCard(d, {
            onEdit: openEditor,
            onToggle: handleToggleDrink,
            categoryHidden,
          })
        );
      element.appendChild(grid);
    }

    updateMeta();
  }

  async function handleToggleDrink(drink) {
    const next = !isDrinkEnabled(drink);
    try {
      setMeta(next ? "Showing…" : "Hiding…");
      await putJSON(`${drinkUrl(drink.id)}/enabled`, { enabled: next });
      await reloadDrinks();
      render();
    } catch (e) {
      console.error(e);
      setMeta(`Update failed — ${e.message}`);
      showToast(`Update failed — ${e.message}`);
    }
  }

  async function handleToggleCategory(catId) {
    const current = new Set(disabledCategoryIds());
    if (current.has(catId)) current.delete(catId);
    else current.add(catId);
    try {
      setMeta("Saving…");
      await setDisabledCategories([...current]);
      // Refresh the shared store so other tabs see the change immediately.
      // setDisabledCategories already updated the local cache; reloadCategoriesConfig
      // doubles as a sanity refetch in case multiple tablets diverged.
      await reloadCategoriesConfig();
      render();
    } catch (e) {
      console.error(e);
      setMeta(`Update failed — ${e.message}`);
      showToast(`Update failed — ${e.message}`);
    }
  }

  function closeEditor() {
    editorEl?.remove();
    editorEl = null;
  }

  function openEditor(drink) {
    closeEditor();
    editorEl = drinkEditor({
      drink,
      onCancel: closeEditor,
      onSave: async (draft) => {
        try {
          setMeta("Saving…");
          if (draft.id) await putJSON(drinkUrl(draft.id), draft);
          else await postJSON("/api/drinks", draft);
          await reloadDrinks();
          closeEditor();
          render();
        } catch (e) {
          console.error(e);
          setMeta(`Save failed — ${e.message}`);
          showToast(`Save failed — ${e.message}`);
        }
      },
      onDelete: drink
        ? async () => {
            try {
              setMeta("Deleting…");
              await delJSON(drinkUrl(drink.id));
              await reloadDrinks();
              closeEditor();
              render();
            } catch (e) {
              console.error(e);
              setMeta(`Delete failed — ${e.message}`);
              showToast(`Delete failed — ${e.message}`);
            }
          }
        : null,
    });
    host.appendChild(editorEl);
  }

  function mount() {
    // Refresh both stores before rendering — drinks for any recipe changes
    // made in other sessions, inventory so the pourable status dots reflect
    // the latest stock (e.g. after switching back from the Inventory tab).
    Promise.allSettled([reloadDrinks(), reloadInventory()]).finally(render);
  }

  function unmount() {
    closeEditor();
  }

  return { element, mount, unmount };
}
