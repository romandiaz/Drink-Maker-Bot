// Small DOM primitives shared across the maintenance view and its modals.
// Kept here so the slot-calibration modal, the backup section, and the core
// maintenance screen don't each carry their own copy.

export function formatRate(ozPerSec) {
  if (!Number.isFinite(ozPerSec) || ozPerSec <= 0) return "—";
  // Display as seconds-per-ounce — easier to reason about for a person
  // watching a stream than a fractional oz/sec figure.
  return `${(1 / ozPerSec).toFixed(1)} s/oz`;
}

export function sectionHead(title, subtitle) {
  const head = document.createElement("div");
  head.className = "maint-section-head";
  const t = document.createElement("div");
  t.className = "maint-section-head__title";
  t.textContent = title;
  head.appendChild(t);
  if (subtitle) {
    const s = document.createElement("div");
    s.className = "maint-section-head__sub";
    s.textContent = subtitle;
    head.appendChild(s);
  }
  return head;
}

export function actionBtn(label, opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `maint-btn tappable${opts.tone ? ` maint-btn--${opts.tone}` : ""}`;
  btn.textContent = label;
  if (opts.disabled) btn.disabled = true;
  return btn;
}
