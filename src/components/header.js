// Header component: station header used across every screen except idle-only moments.
// Composes three slots — left (back button + titles), center (search pill), right (ready/count/custom).

import { CHEVRON_LEFT_SVG, SEARCH_SVG, CLOSE_SVG, COG_SVG } from "../icons.js";
import { getMachineStatus, onMachineStatus } from "../machine-status.js";
import { goBack } from "../app.js";
import { requestAdminAccess } from "../admin-auth.js";

export function backButton(onBack) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "back-btn tappable";
  btn.setAttribute("aria-label", "Go back");
  btn.innerHTML = CHEVRON_LEFT_SVG;
  // Default behaviour is "walk one entry back on the history stack". Screens
  // that need a different action (e.g. dismiss a modal) can pass their own.
  btn.addEventListener("click", onBack || (() => goBack()));
  return btn;
}

// Reflects the live server-side machine state — every tablet sees the same
// status, even ones that didn't initiate a pour. Indicators across all
// mounted screens update together; orphaned ones are dropped from the
// registry on the next tick after they leave the DOM.
const indicatorRegistry = new Set();

function applyStatus(el, status) {
  const dot = el.querySelector(".ready-dot");
  const label = el.querySelector(".ready-label");
  if (!dot || !label) return;
  el.classList.remove("ready-indicator--idle", "ready-indicator--busy");
  if (status.status === "idle") {
    el.classList.add("ready-indicator--idle");
    label.textContent = "Ready";
  } else {
    el.classList.add("ready-indicator--busy");
    label.textContent = status.status === "pouring" ? "Pouring" : "Maintenance";
  }
}

onMachineStatus((status) => {
  for (const el of indicatorRegistry) {
    if (!el.isConnected) {
      indicatorRegistry.delete(el);
      continue;
    }
    applyStatus(el, status);
  }
});

export function readyIndicator() {
  const el = document.createElement("div");
  el.className = "ready-indicator";
  el.innerHTML = `<span class="ready-dot" aria-hidden="true"></span><span class="ready-label">Ready</span>`;
  applyStatus(el, getMachineStatus());
  indicatorRegistry.add(el);
  return el;
}

// Reusable cog button that opens the PIN-gated admin flow. Same visual on
// every screen that surfaces it (idle, category) so the entry point reads
// the same wherever the user finds it.
export function adminButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "admin-btn tappable";
  btn.setAttribute("aria-label", "Admin");
  btn.innerHTML = COG_SVG;
  btn.addEventListener("click", (e) => {
    // Idle has a tap-anywhere → category handler on the screen root; stop
    // propagation so the gear tap doesn't also navigate behind the modal.
    e.stopPropagation();
    requestAdminAccess();
  });
  return btn;
}

export function searchPill({ onTap, placeholder = "Search drinks..." } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "search-pill tappable";
  btn.setAttribute("aria-label", "Search drinks");
  btn.innerHTML = `
    <span class="search-pill__icon">${SEARCH_SVG}</span>
    <span class="search-pill__text">${placeholder}</span>
  `;
  if (onTap) btn.addEventListener("click", onTap);
  return btn;
}

// Active editable-looking search field. Text is updated externally via the value option;
// onClear is called when the × button is tapped (only rendered when value is non-empty).
export function searchField({ value = "", onClear, placeholder = "Type to search..." } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "search-field";

  const text = document.createElement("span");
  text.className = "search-field__text";
  if (value) {
    text.textContent = value;
  } else {
    text.classList.add("is-placeholder");
    text.textContent = placeholder;
  }
  wrap.appendChild(text);

  if (value) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "search-field__clear tappable";
    clear.setAttribute("aria-label", "Clear search");
    clear.innerHTML = CLOSE_SVG;
    if (onClear) clear.addEventListener("click", onClear);
    wrap.appendChild(clear);
  } else {
    const icon = document.createElement("span");
    icon.className = "search-field__icon";
    icon.innerHTML = SEARCH_SVG;
    wrap.insertBefore(icon, text);
  }

  return wrap;
}

function countLabel(text) {
  const el = document.createElement("div");
  el.className = "count-label";
  el.textContent = text;
  return el;
}

function leftTitles({ eyebrow, eyebrowAccent, title }) {
  const wrap = document.createElement("div");
  wrap.className = "header-titles";
  if (eyebrow) {
    const e = document.createElement("div");
    e.className = "header-eyebrow";
    e.textContent = eyebrow;
    if (eyebrowAccent) e.style.color = eyebrowAccent;
    wrap.appendChild(e);
  }
  if (title) {
    const t = document.createElement("div");
    t.className = "header-title";
    t.textContent = title;
    wrap.appendChild(t);
  }
  return wrap;
}

/**
 * Build the station header. Slots:
 *   back       — show a 36×36 back button (default true)
 *   onBack     — click handler for back button (defaults to goBack — i.e. pop the history stack)
 *   eyebrow    — small uppercase label above title (e.g. "STATION 01", "CATEGORY 01")
 *   eyebrowAccent — color for the eyebrow (e.g. category accent var)
 *   title      — screen title (e.g. "Choose a category", "The Classics")
 *   search     — show center search pill
 *   onSearch   — click handler for search pill
 *   centerEl   — custom HTMLElement for the center slot (overrides search pill)
 *   right      — 'ready' (default) | 'none' | { count: 'N DRINKS' } | HTMLElement
 */
export function header(opts = {}) {
  const {
    back = true,
    onBack,
    eyebrow,
    eyebrowAccent,
    title,
    search = false,
    onSearch,
    centerEl,
    right = "ready",
  } = opts;

  const el = document.createElement("header");
  el.className = "app-header";

  const left = document.createElement("div");
  left.className = "app-header__left";
  if (back) left.appendChild(backButton(onBack));
  if (eyebrow || title) left.appendChild(leftTitles({ eyebrow, eyebrowAccent, title }));
  el.appendChild(left);

  const center = document.createElement("div");
  center.className = "app-header__center";
  if (centerEl) center.appendChild(centerEl);
  else if (search) center.appendChild(searchPill({ onTap: onSearch }));
  el.appendChild(center);

  const rightSlot = document.createElement("div");
  rightSlot.className = "app-header__right";
  if (right === "ready") rightSlot.appendChild(readyIndicator());
  else if (right && typeof right === "object" && "count" in right) rightSlot.appendChild(countLabel(right.count));
  else if (right instanceof HTMLElement) rightSlot.appendChild(right);
  el.appendChild(rightSlot);

  return el;
}
