import { ingredientPicker } from "../components/ingredient-picker.js";
import { capacityEditor } from "../components/capacity-editor.js";
import { ingredientName } from "../ingredients.js";
import { reloadInventory } from "../app.js";
import { CLOSE_SVG } from "../icons.js";
import { putJSON, getJSON } from "../api.js";
import { showToast } from "../components/toast.js";

// Inventory view for the admin tab shell. Owns the pump-slot grid and the
// ingredient-picker modal. `host` is the DOM node modals should attach to.

function formatOz(n) {
  return Number(n).toFixed(1);
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
  const bar = document.createElement("div");
  bar.className = "admin-slot__bar";
  const fill = document.createElement("div");
  fill.className = "admin-slot__bar-fill";
  const pct = slot.capacityOz > 0 ? slot.remainingOz / slot.capacityOz : 0;
  fill.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
  if (pct <= 0.15) fill.classList.add("is-low");
  bar.appendChild(fill);
  const label = document.createElement("span");
  label.className = "admin-slot__level-label";
  label.textContent = slot.ingredientId
    ? `${formatOz(slot.remainingOz)} / ${formatOz(slot.capacityOz)} oz`
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
    const low = inventory.slots.filter(
      (s) => s.ingredientId && s.remainingOz / s.capacityOz <= 0.15
    ).length;
    setMeta(low
      ? `${loaded} / ${inventory.slots.length} loaded · ${low} low`
      : `${loaded} / ${inventory.slots.length} loaded`);
  }

  function render() {
    element.innerHTML = "";
    if (!inventory) return;
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

  async function save() {
    try {
      inventory = await putJSON("/api/inventory", inventory);
      // Refresh the shared cache so other screens' pourable checks update.
      reloadInventory();
      render();
    } catch (e) {
      console.error(e);
      setMeta("Save failed — retry");
      showToast(`Save failed — ${e.message}`);
    }
  }

  function openPicker(slot) {
    if (pickerEl) pickerEl.remove();
    pickerEl = ingredientPicker({
      current: slot.ingredientId,
      onCancel: () => {
        pickerEl?.remove();
        pickerEl = null;
      },
      onPick: (id) => {
        const target = inventory.slots.find((s) => s.slot === slot.slot);
        if (!target) return;
        const assigning = id && target.ingredientId !== id;
        target.ingredientId = id;
        // Picking a new ingredient means a fresh bottle — fill it. Clearing a
        // slot zeroes the remaining volume so it doesn't "haunt" later refills.
        if (assigning) target.remainingOz = target.capacityOz;
        if (!id) target.remainingOz = 0;
        pickerEl?.remove();
        pickerEl = null;
        save();
      },
    });
    host.appendChild(pickerEl);
  }

  function openCapacity(slot) {
    if (pickerEl) pickerEl.remove();
    pickerEl = capacityEditor({
      slotNum: slot.slot,
      ingredientId: slot.ingredientId,
      current: slot.capacityOz,
      onCancel: () => {
        pickerEl?.remove();
        pickerEl = null;
      },
      onDone: (oz) => {
        const target = inventory.slots.find((s) => s.slot === slot.slot);
        pickerEl?.remove();
        pickerEl = null;
        if (!target) return;
        target.capacityOz = oz;
        // Shrinking the bottle shouldn't leave more liquid than fits in it.
        if (target.remainingOz > oz) target.remainingOz = oz;
        save();
      },
    });
    host.appendChild(pickerEl);
  }

  function handleRefill(slot) {
    const target = inventory.slots.find((s) => s.slot === slot.slot);
    if (!target || !target.ingredientId) return;
    target.remainingOz = target.capacityOz;
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
