import { navigate } from "../app.js";
import { header } from "../components/header.js";
import { layeredGlass } from "../components/glass.js";
import { appState, setPendingOrder } from "../state.js";
import { ingredientName } from "../ingredients.js";
import {
  loadInventory,
  remainingForIngredient,
  assignedIngredientIds,
} from "../inventory-store.js";
import { ingredientPicker } from "../components/ingredient-picker.js";
import { ingredientRow } from "../components/editor-fields.js";
import { textInputModal } from "../components/text-input-modal.js";
import { postJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { slugify } from "../slug.js";
import { estimatePourSeconds } from "../drinks.js";
import {
  defaultFlowOzPerSec,
  flowRateForIngredient,
} from "../calibration-store.js";
import { getMachineStatus, onMachineStatus } from "../machine-status.js";

// Smallest pour the screen will let an individual ingredient sit at — anything
// below this is treated as "skip this row" rather than dispensing a dribble.
const MIN_OZ = 0.25;

// Volume a freshly-added ingredient lands at — typical spirit pour. The
// stepper still lets the user dial it down to MIN_OZ or up to 12 oz.
const DEFAULT_INGREDIENT_OZ = 1.5;

function buildCustomDrink(draft) {
  const id = `custom-${slugify(draft.name) || "drink"}-${Date.now()}`;
  // Cull rows the user dropped below the pourable threshold so the pour
  // screen's progress dots and the backend's queue don't both have to skip
  // them at runtime. The form's "Pour" button is disabled if this leaves
  // nothing pourable — see canPour() below.
  const ingredients = draft.ingredients
    .filter((i) => i.name && i.volumeOz >= MIN_OZ)
    .map((i) => ({ name: i.name, volumeOz: Number(i.volumeOz.toFixed(2)) }));
  return {
    id,
    name: draft.name || "Custom drink",
    tagline: null,
    category: "submission",
    glassType: "rocks",
    ingredients,
    garnish: null,
    color: "#888888",
    isCustom: true,
  };
}

export function buildYourOwn() {
  const element = document.createElement("section");
  element.className = "screen screen--build";
  element.dataset.screen = "buildYourOwn";

  // Recompute on demand instead of caching — inventory may hydrate after the
  // screen mounts, and a stale list would leave the picker unable to surface
  // newly-loaded ingredients.
  function currentLoadedIds() {
    const ids = [...assignedIngredientIds()];
    ids.sort();
    return ids;
  }

  // Live draft lives on appState so it survives the round-trip through pouring
  // (cancel → goBack returns the user to exactly what they were editing) and
  // can be seeded by the complete-screen "Another" flow. The screen mutates
  // this object directly — render() reads from it on every paint.
  const draft = appState.buildDraft;

  // ---------- Header ----------

  element.appendChild(
    header({
      eyebrow: "Custom",
      eyebrowAccent: "var(--accent-build)",
      title: "Build your own",
      right: "ready",
    })
  );

  // ---------- Body ----------

  const main = document.createElement("div");
  main.className = "build-main";
  element.appendChild(main);

  // Left: name (prominent at top, like detail's drink name) → glass → total
  const left = document.createElement("div");
  left.className = "build-left";
  main.appendChild(left);

  const nameField = document.createElement("button");
  nameField.type = "button";
  nameField.className = "build-name tappable";
  nameField.addEventListener("click", openNameModal);
  left.appendChild(nameField);

  const glassWrap = document.createElement("div");
  glassWrap.className = "build-glass";
  left.appendChild(glassWrap);

  const totalEl = document.createElement("div");
  totalEl.className = "build-total";
  left.appendChild(totalEl);

  const stockNote = document.createElement("div");
  stockNote.className = "build-stocknote";
  stockNote.hidden = true;
  left.appendChild(stockNote);

  // Right: ingredient list + add + pour
  const right = document.createElement("div");
  right.className = "build-right";
  main.appendChild(right);

  const listLabel = document.createElement("div");
  listLabel.className = "build-list-label";
  listLabel.textContent = "Ingredients";
  right.appendChild(listLabel);

  const list = document.createElement("div");
  list.className = "build-list";
  right.appendChild(list);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "build-add tappable";
  addBtn.textContent = "+ Add ingredient";
  addBtn.addEventListener("click", () => openIngredientPicker(null));
  right.appendChild(addBtn);

  const pourBtn = document.createElement("button");
  pourBtn.type = "button";
  pourBtn.className = "pour-btn tappable build-pour";
  pourBtn.style.setProperty("--accent", "var(--accent-build)");
  pourBtn.addEventListener("click", onPour);
  right.appendChild(pourBtn);

  // ---------- Modals ----------

  function openNameModal() {
    const modal = textInputModal({
      label: "Name your drink",
      value: draft.name,
      maxLength: 40,
      onDone: (v) => {
        if (v !== null) draft.name = v;
        modal.remove();
        render();
      },
    });
    element.appendChild(modal);
  }

  // Picker doubles as add and edit. `idx === null` means "the user tapped
  // Add" — pick a new ingredient appends a row at DEFAULT_INGREDIENT_OZ.
  // Otherwise we're editing an existing row's ingredient assignment.
  function openIngredientPicker(idx) {
    // Only loaded ingredients — pouring something that isn't physically in a
    // pump just produces a backend error mid-pour. Better to filter at the
    // pick step. If nothing is loaded yet (inventory hasn't hydrated), fall
    // through to the full catalog so the screen isn't unusable on cold-boot.
    const ids = currentLoadedIds();
    const available = ids.length
      ? ids.filter((id) => remainingForIngredient(id) >= MIN_OZ)
      : null;
    // Disable ingredients already in the recipe so the same bottle can't be
    // double-added. When editing a row (idx !== null), keep that row's own
    // ingredient enabled — disabling it would block the user from re-picking
    // the same ingredient (a no-op from their perspective, but confusing).
    const taken = new Set(
      draft.ingredients
        .map((i, i_idx) => (i_idx === idx ? null : i.name))
        .filter(Boolean)
    );
    const picker = ingredientPicker({
      current: idx === null ? null : draft.ingredients[idx]?.name ?? null,
      ids: available,
      allowNew: false,
      allowEmpty: false,
      title: idx === null ? "Add an ingredient" : "Pick an ingredient",
      disabledIds: [...taken],
      onCancel: () => picker.remove(),
      onPick: (id) => {
        if (id) {
          if (idx === null) {
            draft.ingredients.push({ name: id, volumeOz: DEFAULT_INGREDIENT_OZ });
          } else {
            draft.ingredients[idx].name = id;
          }
        }
        picker.remove();
        render();
      },
    });
    element.appendChild(picker);
  }

  // ---------- Rendering ----------

  function totalOz() {
    return draft.ingredients
      .filter((i) => i.name && i.volumeOz >= MIN_OZ)
      .reduce((s, i) => s + i.volumeOz, 0);
  }

  function shortfalls() {
    // Per-row issues: not loaded at all, or loaded but below the requested
    // pour. Returned as a Map keyed by ingredient name so the row can flag
    // itself without scanning the list again.
    const out = new Map();
    for (const i of draft.ingredients) {
      if (!i.name) continue;
      const remaining = remainingForIngredient(i.name);
      if (!Number.isFinite(remaining)) continue;
      if (remaining <= 0) out.set(i.name, "empty");
      else if (remaining < i.volumeOz) out.set(i.name, "low");
    }
    return out;
  }

  function canPour() {
    if (draft.ingredients.length === 0) return false;
    const ok = draft.ingredients.some((i) => i.name && i.volumeOz >= MIN_OZ);
    if (!ok) return false;
    // Block if any pourable row has zero stock — pouring would just error
    // out the moment the backend tries that step.
    for (const i of draft.ingredients) {
      if (!i.name || i.volumeOz < MIN_OZ) continue;
      const remaining = remainingForIngredient(i.name);
      if (Number.isFinite(remaining) && remaining <= 0) return false;
    }
    return true;
  }

  function paintGlass() {
    glassWrap.innerHTML = "";
    // Bypass buildCustomDrink's MIN_OZ filter so the glass redraws as the user
    // dials a row down — we still want to see the band shrink, not pop out.
    const preview = {
      glassType: "rocks",
      ingredients: draft.ingredients.filter((i) => i.name && i.volumeOz > 0),
    };
    glassWrap.appendChild(layeredGlass(preview, { width: 140 }));
  }

  function render() {
    // Name (prominent heading, tappable to edit)
    if (draft.name) {
      nameField.textContent = draft.name;
      nameField.classList.remove("is-empty");
    } else {
      nameField.textContent = "Tap to name your drink";
      nameField.classList.add("is-empty");
    }
    const total = totalOz();
    totalEl.textContent = total > 0 ? `${total.toFixed(2)} oz total` : "—";

    // Ingredient rows
    list.innerHTML = "";
    if (draft.ingredients.length === 0) {
      // Empty state — single hint, no auto-inserted row. Visually anchored
      // to the Add button just below so the "tap below" instruction lands.
      const empty = document.createElement("div");
      empty.className = "build-empty";
      const emptyTitle = document.createElement("div");
      emptyTitle.className = "build-empty__title";
      emptyTitle.textContent = "No ingredients yet";
      const emptySub = document.createElement("div");
      emptySub.className = "build-empty__sub";
      emptySub.textContent = "Tap below to add one!";
      empty.append(emptyTitle, emptySub);
      list.appendChild(empty);
    } else {
      const issues = shortfalls();
      draft.ingredients.forEach((ing, idx) => {
        const row = ingredientRow(ing, {
          onPick: () => openIngredientPicker(idx),
          onVolume: (v) => {
            draft.ingredients[idx].volumeOz = Number(v.toFixed(2));
            render();
          },
          onRemove: () => {
            draft.ingredients.splice(idx, 1);
            render();
          },
        });
        const reason = issues.get(ing.name);
        if (reason) row.classList.add(`build-row--${reason}`);
        list.appendChild(row);
      });
    }

    // Stock note — collapse one or two issues into a friendly summary so the
    // user knows why pour is disabled / which row to fix.
    const issues = shortfalls();
    if (issues.size === 0) {
      stockNote.hidden = true;
      stockNote.textContent = "";
    } else {
      const empties = [...issues].filter(([, r]) => r === "empty").map(([id]) => ingredientName(id));
      const lows = [...issues].filter(([, r]) => r === "low").map(([id]) => ingredientName(id));
      const parts = [];
      if (empties.length) parts.push(`${empties.join(", ")} empty`);
      if (lows.length) parts.push(`low on ${lows.join(", ")}`);
      stockNote.textContent = parts.join(" · ");
      stockNote.hidden = false;
    }

    // Pour button — machine status takes priority over recipe state so the
    // user gets a single clear reason the button is disabled (busy beats
    // missing-ingredients).
    const machineStatus = getMachineStatus();
    const machineBusy = machineStatus.status !== "idle";
    const ok = canPour();
    pourBtn.disabled = machineBusy || !ok;
    if (machineBusy) {
      pourBtn.textContent =
        machineStatus.status === "pouring"
          ? "Machine pouring · please wait"
          : "Machine in maintenance · please wait";
    } else if (!ok) {
      pourBtn.textContent = draft.ingredients.length === 0
        ? "Add an ingredient to start"
        : "Pick at least one ingredient";
    } else {
      const preview = buildCustomDrink(draft);
      const seconds = estimatePourSeconds(preview, "regular", 1.0, {
        flowRateForIngredient,
        defaultFlowOzPerSec: defaultFlowOzPerSec(),
      });
      pourBtn.textContent = `Pour · ~${seconds}s`;
    }

    paintGlass();
  }

  // ---------- Pour ----------

  async function onPour() {
    if (!canPour()) return;
    if (getMachineStatus().status !== "idle") return;
    pourBtn.disabled = true;
    const customDrink = buildCustomDrink(draft);
    // Save first so the submission is durable even if the pour fails / is
    // cancelled — admins can still review it. Failure to save is logged but
    // doesn't block the pour; the guest still gets their drink.
    try {
      await postJSON("/api/submissions", {
        name: customDrink.name,
        ingredients: customDrink.ingredients,
      });
    } catch (e) {
      console.error("submission save failed", e);
    }
    setPendingOrder({
      drinkId: customDrink.id,
      strength: "regular",
      amount: 1.0,
      customDrink,
    });
    navigate("pouring", { drinkId: customDrink.id });
  }

  // ---------- Lifecycle ----------

  render();
  let unsubMachine = null;
  let lastStatus = getMachineStatus().status;
  return {
    element,
    mount() {
      // Inventory may have changed since the last visit — refresh so stock
      // notes and the pour button reflect what's actually in the bottles.
      loadInventory().then(render);
      // Re-render when the machine flips between idle/busy (another tablet
      // started a pour, maintenance finished, etc.) so the pour button label
      // and disabled state stay in sync. Skip mid-pour progress updates —
      // status string is stable while a pour runs.
      unsubMachine = onMachineStatus((s) => {
        if (s.status !== lastStatus) {
          lastStatus = s.status;
          render();
        }
      });
    },
    unmount() {
      if (unsubMachine) {
        unsubMachine();
        unsubMachine = null;
      }
    },
  };
}
