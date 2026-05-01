// Header component: station header used across every screen except idle-only moments.
// Composes three slots — left (back button + titles), center (search pill), right (ready/count/custom).

import { CHEVRON_LEFT_SVG, SEARCH_SVG, CLOSE_SVG } from "../icons.js";

export function backButton(onBack) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "back-btn tappable";
  btn.setAttribute("aria-label", "Go back");
  btn.innerHTML = CHEVRON_LEFT_SVG;
  if (onBack) btn.addEventListener("click", onBack);
  return btn;
}

export function readyIndicator() {
  const el = document.createElement("div");
  el.className = "ready-indicator";
  el.innerHTML = `<span class="ready-dot" aria-hidden="true"></span><span class="ready-label">Ready</span>`;
  return el;
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
 *   onBack     — click handler for back button
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
