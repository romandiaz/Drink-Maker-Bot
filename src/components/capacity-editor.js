import { ingredientName } from "../ingredients.js";

// Modal for editing an ingredient's persistent attributes — bottle capacity,
// bottle cost, and ABV. These belong to the ingredient itself (not the pump
// slot), so editing here affects every slot that ever holds it and survives
// the ingredient being unloaded. The default 25 oz fits a 750ml bottle, but
// bitters bottles are ~4 oz and handles are ~60 oz, so per-ingredient capacity
// is the only honest way to compute the low-warning threshold.
//
// Reached two ways: tapping a slot's level column on the Inventory tab (pass
// `slotNum` for the "Slot NN · Name" title) and from the Ingredients tab (omit
// `slotNum` — the title is just the ingredient name).

const PRESETS_OZ = [4, 8, 16, 25, 33, 60];
const MIN_OZ = 1;
const MAX_OZ = 60;
const STEP_OZ = 1;
const MAX_COST = 200;
const STEP_COST = 1;
const MAX_ABV_PCT = 95;
const STEP_ABV_PCT = 1;

function clamp(n) {
  return Math.max(MIN_OZ, Math.min(MAX_OZ, Math.round(Number(n) || 0)));
}

function clampCost(n) {
  return Math.max(0, Math.min(MAX_COST, Math.round(Number(n) || 0)));
}

function clampAbvPct(n) {
  return Math.max(0, Math.min(MAX_ABV_PCT, Math.round(Number(n) || 0)));
}

export function capacityEditor({
  slotNum,
  ingredientId,
  current,
  currentCost,
  currentAbv,
  onCancel,
  onDone,
}) {
  let value = clamp(current);
  let cost = clampCost(currentCost);
  // ABV is stored as a 0–1 fraction; the stepper works in whole percent.
  let abvPct = clampAbvPct((Number(currentAbv) || 0) * 100);

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
  title.textContent =
    slotNum != null
      ? `Slot ${String(slotNum).padStart(2, "0")} · ${ingredientName(ingredientId)}`
      : ingredientName(ingredientId);
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

  // Bottle cost — optional; 0 reads as "Not set" and counts as unknown in the
  // bar-value total. Stepped in whole dollars.
  const costSub = document.createElement("div");
  costSub.className = "capacity-editor__sub";
  costSub.textContent = "Bottle cost";
  panel.appendChild(costSub);

  const costStepper = document.createElement("div");
  costStepper.className = "capacity-editor__stepper";
  const costMinus = document.createElement("button");
  costMinus.type = "button";
  costMinus.className = "shot-step tappable";
  costMinus.textContent = "−";
  costMinus.addEventListener("click", () => setCost(cost - STEP_COST));
  const costReadout = document.createElement("div");
  costReadout.className = "capacity-editor__readout";
  const costPlus = document.createElement("button");
  costPlus.type = "button";
  costPlus.className = "shot-step tappable";
  costPlus.textContent = "+";
  costPlus.addEventListener("click", () => setCost(cost + STEP_COST));
  costStepper.append(costMinus, costReadout, costPlus);
  panel.appendChild(costStepper);

  // ABV — drives the detail screen's estimated-strength readout. 0% reads as
  // "Non-alcoholic"; stepped in whole percent.
  const abvSub = document.createElement("div");
  abvSub.className = "capacity-editor__sub";
  abvSub.textContent = "Alcohol by volume";
  panel.appendChild(abvSub);

  const abvStepper = document.createElement("div");
  abvStepper.className = "capacity-editor__stepper";
  const abvMinus = document.createElement("button");
  abvMinus.type = "button";
  abvMinus.className = "shot-step tappable";
  abvMinus.textContent = "−";
  abvMinus.addEventListener("click", () => setAbv(abvPct - STEP_ABV_PCT));
  const abvReadout = document.createElement("div");
  abvReadout.className = "capacity-editor__readout";
  const abvPlus = document.createElement("button");
  abvPlus.type = "button";
  abvPlus.className = "shot-step tappable";
  abvPlus.textContent = "+";
  abvPlus.addEventListener("click", () => setAbv(abvPct + STEP_ABV_PCT));
  abvStepper.append(abvMinus, abvReadout, abvPlus);
  panel.appendChild(abvStepper);

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
  save.addEventListener("click", () =>
    onDone({ bottleSizeOz: value, costPerBottle: cost, abv: abvPct / 100 })
  );

  actions.append(cancel, save);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  paint();
  return overlay;

  function set(n) {
    value = clamp(n);
    paint();
  }
  function setCost(n) {
    cost = clampCost(n);
    paint();
  }
  function setAbv(n) {
    abvPct = clampAbvPct(n);
    paint();
  }
  function paint() {
    readout.textContent = `${value} oz`;
    minus.disabled = value <= MIN_OZ;
    plus.disabled = value >= MAX_OZ;
    for (const p of presetButtons) p.btn.classList.toggle("is-active", p.oz === value);
    costReadout.textContent = cost > 0 ? `$${cost}` : "Not set";
    costMinus.disabled = cost <= 0;
    costPlus.disabled = cost >= MAX_COST;
    abvReadout.textContent = abvPct > 0 ? `${abvPct}%` : "Non-alcoholic";
    abvMinus.disabled = abvPct <= 0;
    abvPlus.disabled = abvPct >= MAX_ABV_PCT;
  }
}
