import { ingredientPicker } from "../components/ingredient-picker.js";
import { capacityEditor } from "../components/capacity-editor.js";
import { ingredientName } from "../ingredients.js";
import { ingredientAttributes, loadIngredients } from "../ingredient-store.js";
import { bottleStatus, LOW_BOTTLE_THRESHOLD, barValue } from "../inventory-store.js";
import { drinks, isDrinkEnabled } from "../drinks.js";
import { isCategoryEnabled } from "../category-store.js";
import { CLOSE_SVG } from "../icons.js";
import { putJSON, getJSON } from "../api.js";
import { showToast } from "../components/toast.js";

// Inventory view for the admin tab shell. Owns the pump-slot grid and the
// ingredient-picker modal. `host` is the DOM node modals should attach to.

function formatOz(n) {
  return Number(n).toFixed(1);
}

// Consolidated "what to buy" panel for the top of the inventory tab: bottles
// that are empty or running low, plus ingredients a recipe calls for that
// aren't loaded in any slot. Recomputed on every render so it stays live.
function shoppingList(inventory) {
  const slots = inventory.slots;
  const empty = slots.filter((s) => bottleStatus(s) === "empty");
  const low = slots.filter((s) => bottleStatus(s) === "low");

  const assigned = new Set(
    slots.filter((s) => s.ingredientId).map((s) => s.ingredientId)
  );
  // Ingredients a visible recipe needs but no slot holds — most-wanted first.
  const demand = new Map();
  for (const d of drinks) {
    if (!isDrinkEnabled(d) || !isCategoryEnabled(d.category)) continue;
    for (const i of d.ingredients) {
      if (!assigned.has(i.name)) {
        demand.set(i.name, (demand.get(i.name) || 0) + 1);
      }
    }
  }
  const notLoaded = [...demand.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const panel = document.createElement("div");
  panel.className = "shopping-list";

  const head = document.createElement("div");
  head.className = "shopping-list__head";
  head.textContent = "Shopping list";
  panel.appendChild(head);

  const groups = [
    { key: "out", label: "Out of stock", ids: empty.map((s) => s.ingredientId) },
    { key: "low", label: "Running low", ids: low.map((s) => s.ingredientId) },
    { key: "missing", label: "Not loaded", ids: notLoaded },
  ].filter((g) => g.ids.length > 0);

  if (groups.length === 0) {
    const ok = document.createElement("div");
    ok.className = "shopping-list__empty";
    ok.textContent = "Everything's stocked — nothing to buy.";
    panel.appendChild(ok);
    return panel;
  }

  for (const g of groups) {
    const group = document.createElement("div");
    group.className = `shopping-list__group shopping-list__group--${g.key}`;
    const lbl = document.createElement("div");
    lbl.className = "shopping-list__group-label";
    lbl.textContent = `${g.label} · ${g.ids.length}`;
    const items = document.createElement("div");
    items.className = "shopping-list__items";
    items.textContent = g.ids.map(ingredientName).join(", ");
    group.append(lbl, items);
    panel.appendChild(group);
  }
  return panel;
}

function slotRow(slot, { onPick, onRefill, onClear, onCapacity }) {
  const row = document.createElement("div");
  row.className = "admin-slot";

  const num = document.createElement("span");
  num.className = "admin-slot__num";
  num.textContent = String(slot.slot).padStart(2, "0");
  row.appendChild(num);

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "admin-slot__pick tappable";
  pick.textContent = ingredientName(slot.ingredientId);
  if (!slot.ingredientId) pick.classList.add("is-empty");
  pick.addEventListener("click", () => onPick(slot));
  row.appendChild(pick);

  // The whole level column is the capacity tap target when an ingredient is
  // assigned. Empty slots stay non-interactive — capacity has no meaning until
  // a bottle is loaded.
  const level = document.createElement(slot.ingredientId ? "button" : "div");
  level.className = "admin-slot__level";
  if (slot.ingredientId) {
    level.type = "button";
    level.classList.add("admin-slot__level--editable", "tappable");
    level.addEventListener("click", () => onCapacity(slot));
  }
  // Bottle size and cost are ingredient attributes, not slot fields — read
  // them from the ingredient's persistent record.
  const attrs = slot.ingredientId ? ingredientAttributes(slot.ingredientId) : null;
  const bar = document.createElement("div");
  bar.className = "admin-slot__bar";
  const fill = document.createElement("div");
  fill.className = "admin-slot__bar-fill";
  const pct = attrs && attrs.bottleSizeOz > 0 ? slot.remainingOz / attrs.bottleSizeOz : 0;
  fill.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
  if (pct <= LOW_BOTTLE_THRESHOLD) fill.classList.add("is-low");
  bar.appendChild(fill);
  const label = document.createElement("span");
  label.className = "admin-slot__level-label";
  // Append the bottle cost when one is recorded — the level column is also the
  // tap target for the attributes editor, so it reads as "tap to edit".
  label.textContent = attrs
    ? `${formatOz(slot.remainingOz)} / ${formatOz(attrs.bottleSizeOz)} oz` +
      (attrs.costPerBottle > 0 ? ` · $${attrs.costPerBottle}` : "")
    : "—";
  level.append(bar, label);
  row.appendChild(level);

  const refill = document.createElement("button");
  refill.type = "button";
  refill.className = "admin-slot__refill tappable";
  refill.textContent = "Refill";
  refill.disabled = !slot.ingredientId;
  refill.addEventListener("click", () => onRefill(slot));
  row.appendChild(refill);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "admin-slot__clear tappable";
  clear.setAttribute("aria-label", "Empty slot");
  clear.innerHTML = CLOSE_SVG;
  clear.disabled = !slot.ingredientId;
  clear.addEventListener("click", () => onClear(slot));
  row.appendChild(clear);

  return row;
}

export function adminInventoryView({ host, setMeta }) {
  const element = document.createElement("div");
  element.className = "admin-body";

  let inventory = null;
  let pickerEl = null;

  function updateMeta() {
    if (!inventory) return;
    const loaded = inventory.slots.filter((s) => s.ingredientId).length;
    const low = inventory.slots.filter((s) => bottleStatus(s) === "low").length;
    const value = barValue(inventory.slots);
    const parts = [`${loaded} / ${inventory.slots.length} loaded`];
    if (low) parts.push(`${low} low`);
    if (value > 0) parts.push(`$${value} value`);
    setMeta(parts.join(" · "));
  }

  function render() {
    element.innerHTML = "";
    if (!inventory) return;
    element.appendChild(shoppingList(inventory));
    element.appendChild(toolbar());
    for (const slot of inventory.slots) {
      element.appendChild(
        slotRow(slot, {
          onPick: openPicker,
          onRefill: handleRefill,
          onClear: handleClear,
          onCapacity: openCapacity,
        })
      );
    }
    updateMeta();
  }

  function toolbar() {
    const bar = document.createElement("div");
    bar.className = "admin-inventory-toolbar";

    const refillAll = document.createElement("button");
    refillAll.type = "button";
    refillAll.className = "admin-inventory-toolbar__btn tappable";
    refillAll.textContent = "Refill all";
    const loaded = inventory.slots.filter((s) => s.ingredientId);
    refillAll.disabled = loaded.length === 0;
    refillAll.addEventListener("click", handleRefillAll);
    bar.appendChild(refillAll);

    return bar;
  }

  function handleRefillAll() {
    const loaded = inventory.slots.filter((s) => s.ingredientId);
    if (loaded.length === 0) return;
    for (const s of loaded) {
      s.remainingOz = ingredientAttributes(s.ingredientId).bottleSizeOz;
    }
    save();
  }

  async function save() {
    try {
      inventory = await putJSON("/api/inventory", inventory);
      // Other tablets' shared caches refresh via the INVENTORY_UPDATED
      // WS broadcast the server emits on save.
      render();
    } catch (e) {
      console.error(e);
      setMeta("Save failed — retry");
      showToast(`Save failed — ${e.message}`);
    }
  }

  function openPicker(slot) {
    if (pickerEl) pickerEl.remove();
    // Disable ingredients already assigned to a different slot — each pump
    // slot holds a distinct bottle, so the same ingredient in two slots would
    // be a config error. The current slot's own ingredient stays enabled (it
    // renders as is-selected) so the admin can keep it without re-picking.
    const assignedElsewhere = inventory.slots
      .filter((s) => s.slot !== slot.slot && s.ingredientId)
      .map((s) => s.ingredientId);
    pickerEl = ingredientPicker({
      current: slot.ingredientId,
      disabledIds: assignedElsewhere,
      onCancel: () => {
        pickerEl?.remove();
        pickerEl = null;
      },
      onPick: (id) => {
        const target = inventory.slots.find((s) => s.slot === slot.slot);
        if (!target) return;
        const assigning = id && target.ingredientId !== id;
        target.ingredientId = id;
        // Picking a new ingredient means a fresh bottle — fill it to that
        // ingredient's recorded bottle size. Clearing a slot zeroes the
        // remaining volume so it doesn't "haunt" later refills.
        if (assigning) {
          target.remainingOz = ingredientAttributes(id).bottleSizeOz;
        }
        if (!id) {
          target.remainingOz = 0;
        }
        pickerEl?.remove();
        pickerEl = null;
        save();
      },
    });
    host.appendChild(pickerEl);
  }

  function openCapacity(slot) {
    if (pickerEl) pickerEl.remove();
    const attrs = ingredientAttributes(slot.ingredientId);
    pickerEl = capacityEditor({
      slotNum: slot.slot,
      ingredientId: slot.ingredientId,
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
        // Capacity, cost and ABV are ingredient attributes — persist them on
        // the ingredient, not the slot. Reload the local cache before
        // re-rendering so the fill bar reflects the new bottle size at once;
        // other tablets refresh via the INGREDIENTS_UPDATED broadcast.
        try {
          await putJSON(`/api/ingredients/${slot.ingredientId}`, {
            bottleSizeOz,
            costPerBottle,
            abv,
          });
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

  function handleRefill(slot) {
    const target = inventory.slots.find((s) => s.slot === slot.slot);
    if (!target || !target.ingredientId) return;
    target.remainingOz = ingredientAttributes(target.ingredientId).bottleSizeOz;
    save();
  }

  function handleClear(slot) {
    const target = inventory.slots.find((s) => s.slot === slot.slot);
    if (!target) return;
    target.ingredientId = null;
    target.remainingOz = 0;
    save();
  }

  function mount() {
    setMeta("Loading…");
    getJSON("/api/inventory")
      .then((inv) => {
        inventory = inv;
        render();
      })
      .catch((e) => {
        console.error(e);
        setMeta("Failed to load inventory");
        showToast(`Couldn't load inventory — ${e.message}`);
      });
  }

  function unmount() {
    pickerEl?.remove();
    pickerEl = null;
  }

  return { element, mount, unmount };
}
