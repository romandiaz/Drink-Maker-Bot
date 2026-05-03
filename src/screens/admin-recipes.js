import { drinks, categories, replaceDrinks } from "../drinks.js";
import { drinkEditor } from "../components/drink-editor.js";
import { glass } from "../components/glass.js";
import { reloadDrinks } from "../app.js";
import { postJSON, putJSON, delJSON } from "../api.js";
import { showToast } from "../components/toast.js";

// Recipes view for the admin tab shell. Lists drinks grouped by category and
// lets admins add / edit / delete. CRUD hits /api/drinks and calls
// reloadDrinks() so the rest of the UI picks up changes next time it reads
// the drinks array.

const drinkUrl = (id) => `/api/drinks/${encodeURIComponent(id)}`;

function recipeCard(drink, { onEdit }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recipe-card tappable";
  btn.addEventListener("click", () => onEdit(drink));

  const glassWrap = document.createElement("div");
  glassWrap.className = "recipe-card__glass";
  glassWrap.appendChild(glass(drink, { width: 32 }));
  btn.appendChild(glassWrap);

  const info = document.createElement("div");
  info.className = "recipe-card__info";
  const name = document.createElement("div");
  name.className = "recipe-card__name";
  name.textContent = drink.name;
  const meta = document.createElement("div");
  meta.className = "recipe-card__meta";
  meta.textContent = drink.ingredients.map((i) => i.name).join(" · ");
  info.append(name, meta);
  btn.appendChild(info);

  return btn;
}

export function adminRecipesView({ host, setMeta }) {
  const element = document.createElement("div");
  element.className = "admin-body admin-body--recipes";

  let editorEl = null;

  function updateMeta() {
    const count = drinks.length;
    setMeta(`${count} recipe${count === 1 ? "" : "s"}`);
  }

  function render() {
    element.innerHTML = "";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "recipe-add tappable";
    addBtn.textContent = "+ New drink";
    addBtn.addEventListener("click", () => openEditor(null));
    element.appendChild(addBtn);

    for (const cat of categories) {
      if (cat.id === "shots") continue;
      const bucket = drinks.filter((d) => d.category === cat.id);
      if (bucket.length === 0) continue;

      const sectionHead = document.createElement("div");
      sectionHead.className = "recipe-section-head";
      sectionHead.style.setProperty("--accent", cat.accent);
      sectionHead.textContent = cat.name;
      element.appendChild(sectionHead);

      const grid = document.createElement("div");
      grid.className = "recipe-grid";
      for (const d of bucket) grid.appendChild(recipeCard(d, { onEdit: openEditor }));
      element.appendChild(grid);
    }

    updateMeta();
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
    // Pick up any drinks changes made in other sessions before rendering.
    reloadDrinks().finally(render);
  }

  function unmount() {
    closeEditor();
  }

  return { element, mount, unmount };
}
