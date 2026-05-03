// Global toast banner. One element appended to <body> at boot, shared across
// screens. Calling showToast() replaces any visible toast — we don't queue,
// because layered errors are confusing and the latest is usually most relevant.
//
// Variants: 'error' (default) for failures, 'info' for neutral status.
// Duration defaults to 4000ms; pass duration: 0 to require a tap dismiss.

let rootEl = null;
let labelEl = null;
let hideTimer = null;

function ensureMounted() {
  if (rootEl) return;
  rootEl = document.createElement("div");
  rootEl.className = "toast";
  rootEl.setAttribute("role", "status");
  rootEl.setAttribute("aria-live", "polite");

  labelEl = document.createElement("div");
  labelEl.className = "toast__label";
  rootEl.appendChild(labelEl);

  rootEl.addEventListener("pointerdown", hideToast);
  document.body.appendChild(rootEl);
}

export function showToast(message, opts = {}) {
  if (!message) return;
  ensureMounted();
  const { variant = "error", duration = 4000 } = opts;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  labelEl.textContent = message;
  rootEl.dataset.variant = variant;
  // Force reflow so re-showing the same toast re-triggers the enter transition.
  rootEl.classList.remove("is-visible");
  void rootEl.offsetHeight;
  rootEl.classList.add("is-visible");

  if (duration > 0) {
    hideTimer = setTimeout(hideToast, duration);
  }
}

export function hideToast() {
  if (!rootEl) return;
  rootEl.classList.remove("is-visible");
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}
