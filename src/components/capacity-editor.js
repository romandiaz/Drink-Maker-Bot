import { ingredientName } from "../ingredients.js";

// Modal for setting a slot's bottle capacity. The default 25 oz fits a 750ml
// bottle, but bitters bottles are ~4 oz and handles are ~60 oz, so per-slot
// capacity is the only honest way to compute the low-warning threshold.

const PRESETS_OZ = [4, 8, 16, 25, 33, 60];
const MIN_OZ = 1;
const MAX_OZ = 60;
const STEP_OZ = 1;

function clamp(n) {
  return Math.max(MIN_OZ, Math.min(MAX_OZ, Math.round(Number(n) || 0)));
}

export function capacityEditor({ slotNum, ingredientId, current, onCancel, onDone }) {
  let value = clamp(current);

  const overlay = document.createElement("div");
  overlay.className = "admin-picker";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) onCancel();
  });

  const panel = document.createElement("div");
  panel.className = "capacity-editor__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "capacity-editor-title");

  const title = document.createElement("div");
  title.className = "admin-picker__title";
  title.id = "capacity-editor-title";
  title.textContent = `Slot ${String(slotNum).padStart(2, "0")} · ${ingredientName(ingredientId)}`;
  panel.appendChild(title);

  const sub = document.createElement("div");
  sub.className = "capacity-editor__sub";
  sub.textContent = "Bottle capacity";
  panel.appendChild(sub);

  const stepper = document.createElement("div");
  stepper.className = "capacity-editor__stepper";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "shot-step tappable";
  minus.textContent = "−";
  minus.addEventListener("click", () => set(value - STEP_OZ));

  const readout = document.createElement("div");
  readout.className = "capacity-editor__readout";

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "shot-step tappable";
  plus.textContent = "+";
  plus.addEventListener("click", () => set(value + STEP_OZ));

  stepper.append(minus, readout, plus);
  panel.appendChild(stepper);

  const presetsLabel = document.createElement("div");
  presetsLabel.className = "capacity-editor__presets-label";
  presetsLabel.textContent = "Common sizes";
  panel.appendChild(presetsLabel);

  const presets = document.createElement("div");
  presets.className = "capacity-editor__presets";
  const presetButtons = PRESETS_OZ.map((oz) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "capacity-editor__preset tappable";
    btn.textContent = `${oz} oz`;
    btn.addEventListener("click", () => set(oz));
    return { btn, oz };
  });
  for (const p of presetButtons) presets.appendChild(p.btn);
  panel.appendChild(presets);

  const actions = document.createElement("div");
  actions.className = "capacity-editor__actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "capacity-editor__btn capacity-editor__btn--ghost tappable";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", onCancel);

  const save = document.createElement("button");
  save.type = "button";
  save.className = "capacity-editor__btn capacity-editor__btn--primary tappable";
  save.textContent = "Save";
  save.addEventListener("click", () => onDone(value));

  actions.append(cancel, save);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  paint();
  return overlay;

  function set(n) {
    value = clamp(n);
    paint();
  }
  function paint() {
    readout.textContent = `${value} oz`;
    minus.disabled = value <= MIN_OZ;
    plus.disabled = value >= MAX_OZ;
    for (const p of presetButtons) p.btn.classList.toggle("is-active", p.oz === value);
  }
}
