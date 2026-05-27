import { ingredientName } from "../ingredients.js";
import { CLOSE_SVG } from "../icons.js";

// Small render helpers for the drink editor — factored out to keep
// drink-editor.js focused on state and wiring.

export function segmented({ options, value, onChange, labelOf = (v) => v }) {
  const wrap = document.createElement("div");
  wrap.className = "segmented editor-segmented";
  wrap.setAttribute("role", "group");
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segmented__option tappable";
    btn.textContent = labelOf(opt);
    const active = opt === value;
    if (active) btn.classList.add("is-active");
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.addEventListener("click", () => onChange(opt));
    wrap.appendChild(btn);
  }
  return wrap;
}

export function fieldRow(label, contentEl) {
  const row = document.createElement("div");
  row.className = "editor-row";
  const lbl = document.createElement("div");
  lbl.className = "editor-row__label";
  lbl.textContent = label;
  row.append(lbl, contentEl);
  return row;
}

export function textField(value, placeholder) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "editor-text-field tappable";
  if (value) {
    btn.textContent = value;
  } else {
    btn.textContent = placeholder;
    btn.classList.add("is-empty");
  }
  return btn;
}

export function colorPalette(palette, value, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "editor-palette";
  for (const c of palette) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "editor-swatch tappable";
    sw.style.background = c;
    if (c.toLowerCase() === String(value).toLowerCase()) sw.classList.add("is-active");
    sw.setAttribute("aria-label", `Color ${c}`);
    sw.addEventListener("click", () => onPick(c));
    wrap.appendChild(sw);
  }
  return wrap;
}

export function ingredientRow(ingredient, { onPick, onVolume, onRemove }) {
  const row = document.createElement("div");
  row.className = "editor-ing";

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "editor-ing__pick tappable";
  pick.textContent = ingredientName(ingredient.name);
  pick.addEventListener("click", onPick);
  row.appendChild(pick);

  const stepper = document.createElement("div");
  stepper.className = "editor-ing__stepper";
  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "editor-ing__step tappable";
  minus.textContent = "−";
  minus.addEventListener("click", () => onVolume(Math.max(0.1, ingredient.volumeOz - 0.25)));
  const vol = document.createElement("span");
  vol.className = "editor-ing__vol";
  vol.textContent = `${ingredient.volumeOz.toFixed(2)} oz`;
  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "editor-ing__step tappable";
  plus.textContent = "+";
  plus.addEventListener("click", () => onVolume(Math.min(12, ingredient.volumeOz + 0.25)));
  stepper.append(minus, vol, plus);
  row.appendChild(stepper);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "editor-ing__remove tappable";
  remove.setAttribute("aria-label", "Remove ingredient");
  remove.innerHTML = CLOSE_SVG;
  remove.addEventListener("click", onRemove);
  row.appendChild(remove);

  return row;
}

// Standalone +/- volume stepper (oz). Used for the post-pour top-up amount;
// ingredientRow keeps its own inline copy.
export function volumeStepper(value, onChange, { min = 0.5, max = 12, step = 0.5 } = {}) {
  const stepper = document.createElement("div");
  stepper.className = "editor-ing__stepper";
  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "editor-ing__step tappable";
  minus.textContent = "−";
  minus.addEventListener("click", () =>
    onChange(Math.max(min, Number((value - step).toFixed(2))))
  );
  const vol = document.createElement("span");
  vol.className = "editor-ing__vol";
  vol.textContent = `${value.toFixed(2)} oz`;
  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "editor-ing__step tappable";
  plus.textContent = "+";
  plus.addEventListener("click", () =>
    onChange(Math.min(max, Number((value + step).toFixed(2))))
  );
  stepper.append(minus, vol, plus);
  return stepper;
}
