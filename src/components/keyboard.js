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

export function keyboard({
  onLetter,
  onBackspace,
  onEnter,
  onPaste,
  getValue,
  extended = false,
  numbers = false,
} = {}) {
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

  // Optional digits row above the letters — admin uses this for WiFi SSIDs
  // and passwords. Search deliberately omits it: drink names don't contain
  // digits and the extra row eats vertical space the result list needs.
  if (numbers) {
    const r = document.createElement("div");
    r.className = "keyboard-row keyboard-row--numbers";
    for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "keyboard-key tappable";
      btn.textContent = d;
      btn.addEventListener("click", () => onLetter?.(d));
      r.appendChild(btn);
    }
    wrap.appendChild(r);
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

  // Mirror physical-keyboard input through the same callbacks the on-screen
  // buttons use, so a real USB/Bluetooth keyboard works at the dev desk and on
  // a kiosk with a hardware keyboard attached. Letters/digits/space/punctuation
  // route through onLetter; Enter, copy and paste are handled below. All three
  // listeners self-remove once the keyboard leaves the DOM.
  let everConnected = false;
  function detached() {
    if (wrap.isConnected) {
      everConnected = true;
      return false;
    }
    if (everConnected) {
      document.removeEventListener("keydown", handlePhysicalKey);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("copy", handleCopy);
    }
    return true;
  }

  // True when a real editable element holds focus — leave clipboard/keys to it.
  function editableTarget(t) {
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  function handlePhysicalKey(e) {
    if (detached()) return;
    if (editableTarget(e.target)) return;

    const key = e.key;
    if (key === "Enter") {
      // Enter confirms — same as tapping the screen's primary action button.
      if (onEnter) {
        e.preventDefault();
        onEnter();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // copy/paste handled separately
    if (key === "Backspace") {
      e.preventDefault();
      onBackspace?.();
      return;
    }
    if (/^[a-zA-Z]$/.test(key)) {
      e.preventDefault();
      // Sticky on-screen shift overrides the physical case; otherwise the
      // browser already encoded physical-shift state into `key`.
      onLetter?.(shifted ? key.toUpperCase() : key);
      return;
    }
    if (numbers && /^[0-9]$/.test(key)) {
      e.preventDefault();
      onLetter?.(key);
      return;
    }
    if (extended && (key === " " || key === "." || key === "'")) {
      e.preventDefault();
      onLetter?.(key);
    }
  }

  // Ctrl/Cmd+V — Chromium fires `paste` on the document even with no field
  // focused. These are single-line fields, so keep only the first pasted line
  // and drop control characters.
  function handlePaste(e) {
    if (detached()) return;
    if (!onPaste || editableTarget(e.target)) return;
    const raw = e.clipboardData?.getData("text") || "";
    const text = raw.split(/[\r\n]/)[0].replace(/[\u0000-\u001F]/g, "").trim();
    if (!text) return;
    e.preventDefault();
    onPaste(text);
  }

  // Ctrl/Cmd+C — there's no cursor/selection model, so copy the whole field.
  function handleCopy(e) {
    if (detached()) return;
    if (!getValue || editableTarget(e.target)) return;
    const value = getValue();
    if (value == null || value === "") return;
    e.clipboardData?.setData("text/plain", String(value));
    e.preventDefault();
  }

  document.addEventListener("keydown", handlePhysicalKey);
  document.addEventListener("paste", handlePaste);
  document.addEventListener("copy", handleCopy);

  return wrap;
}
