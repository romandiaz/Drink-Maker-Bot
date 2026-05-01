// On-screen QWERTY keyboard. Letters only — no numbers or punctuation per the spec.
// Shift is sticky and visual-only (capitalization doesn't affect search).

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["__shift__", "z", "x", "c", "v", "b", "n", "m", "__back__"],
];

const SHIFT_SVG = `
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M8 3L3 9H6V13H10V9H13L8 3Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>
  </svg>
`;

const BACK_SVG = `
  <svg viewBox="0 0 18 16" aria-hidden="true" focusable="false">
    <path d="M5.5 3L1.5 8L5.5 13H16V3H5.5Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>
    <path d="M9 6L13 10 M13 6L9 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>
`;

export function keyboard({ onLetter, onBackspace, extended = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "keyboard";

  let shifted = false;
  const letterButtons = [];
  let shiftBtn = null;

  function applyShift() {
    for (const btn of letterButtons) {
      btn.textContent = shifted ? btn.dataset.letter.toUpperCase() : btn.dataset.letter;
    }
    if (shiftBtn) {
      shiftBtn.classList.toggle("is-active", shifted);
      shiftBtn.setAttribute("aria-pressed", shifted ? "true" : "false");
    }
  }

  ROWS.forEach((row, idx) => {
    const r = document.createElement("div");
    r.className = `keyboard-row keyboard-row--r${idx + 1}`;
    for (const key of row) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "keyboard-key tappable";

      if (key === "__shift__") {
        btn.classList.add("keyboard-key--modifier");
        btn.setAttribute("aria-label", "Shift");
        btn.setAttribute("aria-pressed", "false");
        btn.innerHTML = SHIFT_SVG;
        btn.addEventListener("click", () => {
          shifted = !shifted;
          applyShift();
        });
        shiftBtn = btn;
      } else if (key === "__back__") {
        btn.classList.add("keyboard-key--modifier");
        btn.setAttribute("aria-label", "Backspace");
        btn.innerHTML = BACK_SVG;
        btn.addEventListener("click", () => onBackspace?.());
      } else {
        btn.dataset.letter = key;
        btn.textContent = key;
        btn.addEventListener("click", () => onLetter?.(key));
        letterButtons.push(btn);
      }
      r.appendChild(btn);
    }
    wrap.appendChild(r);
  });

  // Extended mode adds a space-bar row with period and apostrophe for editing
  // drink names and taglines. Search doesn't need this — plain letters only.
  if (extended) {
    const r = document.createElement("div");
    r.className = "keyboard-row keyboard-row--r4";
    for (const [key, label, cls] of [
      [".", ".", "keyboard-key--punct"],
      [" ", "space", "keyboard-key--space"],
      ["'", "'", "keyboard-key--punct"],
    ]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `keyboard-key tappable ${cls}`;
      btn.textContent = label;
      btn.addEventListener("click", () => onLetter?.(key));
      r.appendChild(btn);
    }
    wrap.appendChild(r);
  }

  return wrap;
}
