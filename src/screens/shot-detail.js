import { navigate } from "../app.js";
import {
  buildShotDrink,
  estimatePourSeconds,
  getShotIngredientById,
  shotIngredients,
} from "../drinks.js";
import { header } from "../components/header.js";
import { setPendingOrder } from "../state.js";
import { ingredientName } from "../ingredients.js";

const MIN_OZ = 0.25;
const MAX_OZ = 3.0;
const STEP_OZ = 0.25;

const PRESETS = [
  { label: "Taste",  oz: 0.5 },
  { label: "Pony",   oz: 1.0 },
  { label: "Shot",   oz: 1.5 },
  { label: "Double", oz: 3.0 },
];

// Tick marks drawn on the right side of the fill glass — labeled reference points
// so users can aim for a specific volume without having to read the readout.
const TICKS = [0.5, 1.0, 1.5, 2.0, 3.0];

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function snap(n) {
  return Math.round(n / STEP_OZ) * STEP_OZ;
}

function formatOz(n) {
  // Two-digit display — "1.50" rather than "1.5" — keeps the big readout
  // from jumping width between ticks.
  return n.toFixed(2);
}

export function shotDetail(props = {}) {
  const ingredientId = props.ingredientId || shotIngredients[0].id;
  const ing = getShotIngredientById(ingredientId);
  if (!ing) throw new Error(`Unknown shot ingredient: ${ingredientId}`);

  const displayName = ingredientName(ing.id);
  let volumeOz = ing.defaultOz;
  let userHasTouched = false;

  const element = document.createElement("section");
  element.className = "screen";
  element.dataset.screen = "shotDetail";

  element.appendChild(
    header({
      onBack: () => navigate("shotPicker", {}, "pop"),
      eyebrow: "Pour a shot",
      eyebrowAccent: "var(--accent-shots)",
      title: displayName,
      search: true,
      onSearch: () => navigate("search"),
      right: "ready",
    })
  );

  const main = document.createElement("div");
  main.className = "shot-detail-main";
  element.appendChild(main);

  // ---------- Left: drag-to-fill glass ----------

  const fillCol = document.createElement("div");
  fillCol.className = "shot-fill";

  const stage = document.createElement("div");
  stage.className = "shot-fill__stage";

  const glassBody = document.createElement("div");
  glassBody.className = "shot-fill__glass";

  const liquid = document.createElement("div");
  liquid.className = "shot-fill__liquid";
  liquid.style.background = ing.color;

  const meniscus = document.createElement("div");
  meniscus.className = "shot-fill__meniscus";

  const hint = document.createElement("div");
  hint.className = "shot-fill__hint";
  hint.textContent = "Drag to fill";

  glassBody.appendChild(liquid);
  glassBody.appendChild(meniscus);
  glassBody.appendChild(hint);
  stage.appendChild(glassBody);

  // Tick marks sit outside the glass, aligned with the liquid height axis.
  const ticks = document.createElement("div");
  ticks.className = "shot-fill__ticks";
  for (const oz of TICKS) {
    const tick = document.createElement("div");
    tick.className = "shot-fill__tick";
    tick.style.bottom = `${(oz / MAX_OZ) * 100}%`;
    const label = document.createElement("span");
    label.className = "shot-fill__tick-label";
    label.textContent = `${oz.toFixed(1)} oz`;
    tick.appendChild(label);
    ticks.appendChild(tick);
  }
  stage.appendChild(ticks);

  fillCol.appendChild(stage);
  main.appendChild(fillCol);

  // ---------- Right: readout + presets + fine controls ----------

  const controls = document.createElement("div");
  controls.className = "shot-controls";

  const readout = document.createElement("div");
  readout.className = "shot-readout";
  const readoutValue = document.createElement("div");
  readoutValue.className = "shot-readout__value";
  const readoutUnit = document.createElement("div");
  readoutUnit.className = "shot-readout__unit";
  readoutUnit.textContent = "oz";
  readout.append(readoutValue, readoutUnit);
  controls.appendChild(readout);

  const presets = document.createElement("div");
  presets.className = "shot-presets";
  const presetButtons = PRESETS.map((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shot-preset tappable";
    const lbl = document.createElement("span");
    lbl.className = "shot-preset__label";
    lbl.textContent = p.label;
    const oz = document.createElement("span");
    oz.className = "shot-preset__oz";
    oz.textContent = `${p.oz.toFixed(1)} oz`;
    btn.append(lbl, oz);
    btn.addEventListener("click", () => setVolume(p.oz, { fromUser: true }));
    return { btn, oz: p.oz };
  });
  for (const p of presetButtons) presets.appendChild(p.btn);
  controls.appendChild(presets);

  const fine = document.createElement("div");
  fine.className = "shot-fine";
  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "shot-step tappable";
  minus.textContent = "−";
  minus.addEventListener("click", () =>
    setVolume(volumeOz - STEP_OZ, { fromUser: true })
  );
  const fineLabel = document.createElement("div");
  fineLabel.className = "shot-fine__label";
  fineLabel.textContent = "Fine adjust · 0.25 oz";
  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "shot-step tappable";
  plus.textContent = "+";
  plus.addEventListener("click", () =>
    setVolume(volumeOz + STEP_OZ, { fromUser: true })
  );
  fine.append(minus, fineLabel, plus);
  controls.appendChild(fine);

  const pourBtn = document.createElement("button");
  pourBtn.type = "button";
  pourBtn.className = "pour-btn tappable";
  pourBtn.style.setProperty("--accent", "var(--accent-shots)");
  pourBtn.addEventListener("click", onPour);
  controls.appendChild(pourBtn);

  main.appendChild(controls);

  // ---------- Interaction ----------

  function onPour() {
    pourBtn.disabled = true;
    const customDrink = buildShotDrink(ing.id, volumeOz, displayName);
    setPendingOrder({
      drinkId: customDrink.id,
      strength: "regular",
      amount: 1.0,
      customDrink,
    });
    navigate("pouring", { drinkId: customDrink.id });
  }

  function setVolume(next, { fromUser = false } = {}) {
    const v = snap(clamp(next, MIN_OZ, MAX_OZ));
    volumeOz = Number(v.toFixed(2));
    if (fromUser) userHasTouched = true;
    renderVolume();
  }

  function renderVolume() {
    const pct = (volumeOz / MAX_OZ) * 100;
    liquid.style.height = `${pct}%`;
    meniscus.style.bottom = `${pct}%`;

    readoutValue.textContent = formatOz(volumeOz);

    for (const p of presetButtons) {
      p.btn.classList.toggle("is-active", Math.abs(p.oz - volumeOz) < 1e-6);
    }
    minus.disabled = volumeOz <= MIN_OZ + 1e-6;
    plus.disabled = volumeOz >= MAX_OZ - 1e-6;

    hint.classList.toggle("is-hidden", userHasTouched);

    const preview = buildShotDrink(ing.id, volumeOz, displayName);
    const seconds = estimatePourSeconds(preview, "regular", 1.0);
    pourBtn.textContent = `Pour · Ready in ~${seconds}s`;
  }

  // Drag-to-fill: any pointer gesture inside the stage sets the liquid level
  // to wherever the finger is. A continuous stream of updates while dragging
  // gives direct-manipulation feel — no widget between the user and the glass.
  let dragging = false;

  function volumeFromEvent(e) {
    const rect = stage.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pct = 1 - clamp(y / rect.height, 0, 1);
    return pct * MAX_OZ;
  }

  function onPointerDown(e) {
    dragging = true;
    stage.setPointerCapture?.(e.pointerId);
    setVolume(volumeFromEvent(e), { fromUser: true });
  }
  function onPointerMove(e) {
    if (!dragging) return;
    setVolume(volumeFromEvent(e), { fromUser: true });
  }
  function onPointerUp(e) {
    dragging = false;
    stage.releasePointerCapture?.(e.pointerId);
  }
  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerUp);

  renderVolume();
  return { element, mount() {}, unmount() {} };
}
