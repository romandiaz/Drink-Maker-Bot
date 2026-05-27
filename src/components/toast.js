// Global toast banner. One element appended to <body> at boot, shared across
// screens. Calling showToast() replaces any visible toast — we don't queue,
// because layered errors are confusing and the latest is usually most relevant.
//
// Variants: 'error' (default) for failures, 'success' for completed
// operations, 'info' for neutral status.
// Duration defaults to 4000ms; pass duration: 0 to require a tap dismiss.

let rootEl = null;
let labelEl = null;
let scrimEl = null;
let hideTimer = null;

function ensureMounted() {
  if (rootEl) return;
  scrimEl = document.createElement("div");
  scrimEl.className = "toast-scrim";
  document.body.appendChild(scrimEl);

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
  const { variant = "error", duration = 4000, log = true } = opts;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  labelEl.textContent = message;
  rootEl.dataset.variant = variant;
  // Force reflow so re-showing the same toast re-triggers the enter transition.
  rootEl.classList.remove("is-visible");
  scrimEl.classList.remove("is-visible");
  void rootEl.offsetHeight;
  rootEl.classList.add("is-visible");
  scrimEl.classList.add("is-visible");

  if (duration > 0) {
    hideTimer = setTimeout(hideToast, duration);
  }

  // Persist to the backend Notifications log so the admin can replay
  // anything that flashed by — most pour errors are gone in 4s. Fire-and-
  // forget; a failed POST shouldn't block the visible toast or cascade into
  // a second toast about the logging failure.
  if (log) {
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: String(message), variant }),
    }).catch(() => {});
  }
}

// Fire a queue-lifecycle toast. Queue events are transient confirmations,
// not errors worth replaying, so log: false is hard-coded. Callers pass a
// spec from queueToasts in queue-store.js so the variant + wording for each
// event lives in one place.
export function showQueueToast(spec, opts = {}) {
  showToast(spec.message, { variant: spec.variant, log: false, ...opts });
}

export function hideToast() {
  if (!rootEl) return;
  rootEl.classList.remove("is-visible");
  scrimEl.classList.remove("is-visible");
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}
