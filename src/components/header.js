// Header component: station header used across every screen except idle-only moments.
// Composes three slots — left (back button + titles), center (search pill), right (ready/count/custom).

import { CHEVRON_LEFT_SVG, SEARCH_SVG, CLOSE_SVG, COG_SVG, BELL_SVG, HISTORY_SVG, HOME_SVG, POWER_SVG } from "../icons.js";
import { goBack, navigate, resetStack } from "../app.js";
import { requestAdminAccess } from "../admin-auth.js";
import { on as onWS } from "../ws.js";
import { postJSON } from "../api.js";
import { showToast } from "./toast.js";
import { createStatusPill } from "./status-pill.js";

const notificationBtns = new Set();
onWS("NOTIFICATION_ADDED", () => {
  for (const btn of notificationBtns) {
    if (!btn.isConnected) {
      notificationBtns.delete(btn);
    } else {
      btn.classList.add("has-unseen");
    }
  }
});

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

// The machine-status + queue pill. A button on every screen (bar the queue
// screen itself) — tapping it opens the queue, so the queue is reachable from
// anywhere without hunting for it. The pill itself (glass icon, pie wedge,
// label, accents, pulse) lives in components/status-pill.js so the mobile
// order page can reuse the exact same component.
export function readyIndicator() {
  return createStatusPill({
    onTap: () => navigate("queue"),
    ariaLabel: "Machine status — open the drink queue",
  });
}

// Bell button — navigates to the standalone Notifications screen. Lives in
// the admin header's right slot since the log is admin-tier info; not
// exposed to guests via the global header.
export function notificationsButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "notifications-btn tappable";
  btn.setAttribute("aria-label", "Notifications");
  btn.innerHTML = BELL_SVG;

  const dot = document.createElement("span");
  dot.className = "notifications-indicator";
  btn.appendChild(dot);

  // Check for unseen notifications
  fetch("/api/notifications")
    .then((res) => res.json())
    .then((data) => {
      const entries = data.entries || [];
      if (entries.length > 0) {
        const latestTs = entries[0].ts;
        const lastSeen = localStorage.getItem("lastSeenNotification");
        if (!lastSeen || new Date(latestTs) > new Date(lastSeen)) {
          btn.classList.add("has-unseen");
        }
      }
    })
    .catch(() => {});

  btn.addEventListener("click", () => navigate("notifications"));
  notificationBtns.add(btn);
  return btn;
}

// Home button — bails out of admin straight back to idle, bypassing the tab
// history stack the back button walks. Lives just before the back button in
// the admin header's left slot.
export function homeButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "home-btn tappable";
  btn.setAttribute("aria-label", "Home");
  btn.innerHTML = HOME_SVG;
  btn.addEventListener("click", () => resetStack("idle"));
  return btn;
}

// Restart button — exits the backend process so systemd (or our own respawn
// helper) brings it back, then reloads every connected browser via the
// SERVER_RESTART broadcast. Lets the operator pick up freshly-pulled code
// without SSHing in. Two-tap to commit: the first tap swaps the icon for a
// "Tap again to restart" label and arms a 4-second confirm window.
export function restartButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "restart-btn tappable";
  btn.setAttribute("aria-label", "Restart app");

  const icon = document.createElement("span");
  icon.className = "restart-btn__icon";
  icon.innerHTML = POWER_SVG;
  btn.appendChild(icon);

  const label = document.createElement("span");
  label.className = "restart-btn__label";
  label.textContent = "Tap again to restart";
  btn.appendChild(label);

  let confirmTimer = null;
  function disarm() {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    btn.classList.remove("is-confirming");
  }

  btn.addEventListener("click", async () => {
    if (confirmTimer) {
      disarm();
      try {
        await postJSON("/api/system/restart", {});
        // The SERVER_RESTART broadcast (handled in ws.js) reloads this page.
      } catch (e) {
        showToast(`Restart failed — ${e.message}`);
      }
      return;
    }
    btn.classList.add("is-confirming");
    confirmTimer = setTimeout(disarm, 4000);
  });

  return btn;
}

// History button — navigates to the standalone History screen.
export function historyButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "history-btn tappable";
  btn.setAttribute("aria-label", "History");
  btn.innerHTML = HISTORY_SVG;
  btn.addEventListener("click", () => navigate("history"));
  return btn;
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
 *   leftExtra  — optional HTMLElement mounted in the left slot, before the back button
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
    leftExtra,
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
  if (leftExtra instanceof HTMLElement) left.appendChild(leftExtra);
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
