// 4-digit numeric PIN entry modal. Verifies via /api/admin/verify-pin and
// calls onDone(true) on success, onDone(false) on cancel. The modal mounts
// itself onto a host (caller appends the returned element); it does not
// navigate — the caller decides what success means.

const PIN_LENGTH = 4;

export function pinModal({ onDone, label = "Enter admin PIN" } = {}) {
  let entered = "";
  let busy = false;

  const overlay = document.createElement("div");
  overlay.className = "pin-modal";

  const panel = document.createElement("div");
  panel.className = "pin-modal__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "pin-modal-label");

  const labelEl = document.createElement("div");
  labelEl.className = "pin-modal__label";
  labelEl.id = "pin-modal-label";
  labelEl.textContent = label;
  panel.appendChild(labelEl);

  const dotsEl = document.createElement("div");
  dotsEl.className = "pin-modal__dots";
  panel.appendChild(dotsEl);

  const errorEl = document.createElement("div");
  errorEl.className = "pin-modal__error";
  errorEl.setAttribute("aria-live", "polite");
  panel.appendChild(errorEl);

  function paintDots() {
    dotsEl.innerHTML = "";
    for (let i = 0; i < PIN_LENGTH; i++) {
      const d = document.createElement("span");
      d.className = "pin-modal__dot";
      if (i < entered.length) d.classList.add("is-filled");
      dotsEl.appendChild(d);
    }
  }
  paintDots();

  function setError(msg) {
    errorEl.textContent = msg || "";
    errorEl.classList.toggle("is-visible", Boolean(msg));
  }

  const keypad = document.createElement("div");
  keypad.className = "pin-modal__keypad";

  // Standard phone-style 3×4 grid; the bottom-left cell is empty so 0 sits
  // under 8 (rather than 7-8-9 / 0 in a different shape).
  const layout = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  for (const k of layout) {
    if (!k) {
      const spacer = document.createElement("span");
      spacer.className = "pin-modal__key pin-modal__key--spacer";
      keypad.appendChild(spacer);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pin-modal__key tappable";
    if (k === "back") {
      btn.classList.add("pin-modal__key--back");
      btn.setAttribute("aria-label", "Backspace");
      btn.innerHTML = `
        <svg viewBox="0 0 20 16" aria-hidden="true" focusable="false">
          <path d="M6 1H17C18.1 1 19 1.9 19 3V13C19 14.1 18.1 15 17 15H6L1 8L6 1Z"
            fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M9 5L14 11 M14 5L9 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      `;
    } else {
      btn.textContent = k;
    }
    btn.addEventListener("click", () => {
      if (busy) return;
      setError("");
      if (k === "back") {
        entered = entered.slice(0, -1);
      } else {
        if (entered.length >= PIN_LENGTH) return;
        entered += k;
      }
      paintDots();
      if (entered.length === PIN_LENGTH) submit();
    });
    keypad.appendChild(btn);
  }
  panel.appendChild(keypad);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pin-modal__cancel tappable";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    if (busy) return;
    onDone(false);
  });
  panel.appendChild(cancelBtn);

  async function submit() {
    busy = true;
    panel.classList.add("is-checking");
    try {
      const res = await fetch("/api/admin/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: entered }),
      });
      if (res.ok) {
        onDone(true);
        return;
      }
      entered = "";
      paintDots();
      setError(res.status === 401 ? "Incorrect PIN" : "Verification failed");
      panel.classList.add("is-shake");
      setTimeout(() => panel.classList.remove("is-shake"), 400);
    } catch {
      entered = "";
      paintDots();
      setError("Network error — try again");
    } finally {
      panel.classList.remove("is-checking");
      busy = false;
    }
  }

  overlay.appendChild(panel);
  return overlay;
}
