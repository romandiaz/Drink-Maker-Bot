import { keyboard } from "./keyboard.js";

// Full-screen text entry modal with the on-screen keyboard. Returns
// an element you append somewhere — `onDone(value | null)` fires once
// when the user taps Save (value) or Cancel (null).

export function textInputModal({
  label,
  value = "",
  maxLength = 40,
  onDone,
}) {
  let current = String(value);

  const overlay = document.createElement("div");
  overlay.className = "text-input-modal";

  const panel = document.createElement("div");
  panel.className = "text-input-modal__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "text-input-modal-label");

  const labelEl = document.createElement("div");
  labelEl.className = "text-input-modal__label";
  labelEl.id = "text-input-modal-label";
  labelEl.textContent = label;
  panel.appendChild(labelEl);

  const display = document.createElement("div");
  display.className = "text-input-modal__display";
  panel.appendChild(display);

  function paintDisplay() {
    display.textContent = current || " ";
    display.classList.toggle("is-empty", !current);
  }
  paintDisplay();

  const kb = keyboard({
    extended: true,
    onLetter: (l) => {
      if (current.length >= maxLength) return;
      current += l;
      paintDisplay();
    },
    onBackspace: () => {
      current = current.slice(0, -1);
      paintDisplay();
    },
    onEnter: () => onDone(current.trim()),
    onPaste: (text) => {
      current = (current + text).slice(0, maxLength);
      paintDisplay();
    },
    getValue: () => current,
  });
  panel.appendChild(kb);

  const actions = document.createElement("div");
  actions.className = "text-input-modal__actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "text-input-modal__btn text-input-modal__btn--ghost tappable";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => onDone(null));

  const save = document.createElement("button");
  save.type = "button";
  save.className = "text-input-modal__btn text-input-modal__btn--primary tappable";
  save.textContent = "Done";
  save.addEventListener("click", () => onDone(current.trim()));

  actions.append(cancel, save);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  return overlay;
}
