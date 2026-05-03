import { idle } from "./screens/idle.js";
import { category } from "./screens/category.js";
import { search } from "./screens/search.js";
import { drinkList } from "./screens/drink-list.js";
import { detail } from "./screens/detail.js";
import { pouring } from "./screens/pouring.js";
import { complete } from "./screens/complete.js";
import { shotPicker } from "./screens/shot-picker.js";
import { shotDetail } from "./screens/shot-detail.js";
import { admin } from "./screens/admin.js";
import { on, onStatusChange, startWS } from "./ws.js";
import { replaceDrinks } from "./drinks.js";
import { loadInventory } from "./inventory-store.js";
import { loadCalibration } from "./calibration-store.js";

const screens = {
  idle,
  category,
  search,
  drinkList,
  detail,
  pouring,
  complete,
  shotPicker,
  shotDetail,
  admin,
};

// Inactivity: any screen except idle (already there) and pouring (don't interrupt
// an active pour) returns to idle after 60 seconds without a touch.
const INACTIVITY_MS = 60_000;
const NO_TIMEOUT_SCREENS = new Set(["idle", "pouring"]);

let currentScreen = null;
let currentScreenName = null;
let inactivityTimer = null;

// Screen transition: must match the CSS duration. A small buffer covers the
// case where transitionend doesn't fire (we don't listen for it — the timer
// is the authority so we aren't tied to which property finishes last).
const TRANSITION_MS = 250;
let pendingCleanup = null;

function resetInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (NO_TIMEOUT_SCREENS.has(currentScreenName)) return;
  inactivityTimer = setTimeout(() => {
    inactivityTimer = null;
    if (!NO_TIMEOUT_SCREENS.has(currentScreenName)) navigate("idle", {}, "pop");
  }, INACTIVITY_MS);
}

export function navigate(screenName, props = {}, direction = "push") {
  const factory = screens[screenName];
  if (!factory) throw new Error(`Unknown screen: ${screenName}`);

  // Finalise any in-flight transition before starting a new one. Without this,
  // a fast tap during the 180ms window would leave the previous outgoing
  // element stranded in the DOM.
  if (pendingCleanup) {
    pendingCleanup();
    pendingCleanup = null;
  }

  const outgoing = currentScreen;
  const outgoingEl = outgoing?.element ?? null;

  // Unmount the outgoing screen immediately to stop its timers/listeners.
  // The element itself stays in the DOM through the leave animation but with
  // no live JS attached — safer than letting intervals fire mid-transition.
  outgoing?.unmount?.();

  currentScreen = factory(props);
  currentScreenName = screenName;
  const incomingEl = currentScreen.element;

  const root = document.getElementById("app");

  // First mount, or explicit instant swap — no transition.
  if (!outgoingEl || direction === "none") {
    root.innerHTML = "";
    root.appendChild(incomingEl);
    currentScreen.mount?.();
    resetInactivityTimer();
    return;
  }

  const enterClass = `is-entering-${direction}`;
  const leaveClass = `is-leaving-${direction}`;

  incomingEl.classList.add("is-transitioning", enterClass);
  outgoingEl.classList.add("is-transitioning");
  root.appendChild(incomingEl);
  currentScreen.mount?.();

  // Force layout so the enter start-state is committed before we strip the
  // class — otherwise the browser collapses both states and skips the anim.
  void incomingEl.offsetHeight;

  incomingEl.classList.remove(enterClass);
  outgoingEl.classList.add(leaveClass);

  const cleanup = () => {
    outgoingEl.remove();
    incomingEl.classList.remove("is-transitioning");
    pendingCleanup = null;
  };
  pendingCleanup = cleanup;
  setTimeout(() => { if (pendingCleanup === cleanup) cleanup(); }, TRANSITION_MS + 20);

  resetInactivityTimer();
}

// Global touch press feedback. CLAUDE.md mandates `.pressed` on touchstart, removed on touchend,
// in case `:active` doesn't fire reliably on the kiosk's touchscreen. Track the
// element pressed per touch identifier so a drag-off doesn't leave `.pressed`
// stuck on the original button forever.
const pressedByTouch = new Map();
document.addEventListener(
  "touchstart",
  (e) => {
    for (const t of e.changedTouches) {
      const el = t.target instanceof Element ? t.target.closest(".tappable") : null;
      if (el) {
        el.classList.add("pressed");
        pressedByTouch.set(t.identifier, el);
      }
    }
  },
  { passive: true }
);
for (const evt of ["touchend", "touchcancel"]) {
  document.addEventListener(evt, (e) => {
    for (const t of e.changedTouches) {
      const el = pressedByTouch.get(t.identifier);
      if (el) {
        el.classList.remove("pressed");
        pressedByTouch.delete(t.identifier);
      }
    }
  });
}

// Any pointer interaction counts as activity — covers touch, stylus, mouse.
document.addEventListener("pointerdown", resetInactivityTimer, { passive: true });

function mountWsOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "ws-overlay";
  overlay.innerHTML = `
    <div class="ws-overlay__inner">
      <div class="ws-overlay__pulse" aria-hidden="true"></div>
      <div class="ws-overlay__label">Reconnecting</div>
    </div>
  `;
  document.body.appendChild(overlay);
  onStatusChange((status) => {
    overlay.classList.toggle("is-visible", status === "disconnected");
  });
}

async function hydrateDrinks() {
  try {
    const res = await fetch("/api/drinks");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.drinks)) replaceDrinks(data.drinks);
  } catch {
    // Offline / static dev server — fall back to the SEED_DRINKS already
    // in the module. No user-facing error; screens keep working.
  }
}

export async function reloadDrinks() {
  await hydrateDrinks();
}

export async function reloadInventory() {
  await loadInventory();
}

export async function reloadCalibration() {
  await loadCalibration();
}

window.addEventListener("DOMContentLoaded", async () => {
  startWS();
  mountWsOverlay();
  await Promise.all([hydrateDrinks(), loadInventory(), loadCalibration()]);
  // Every successful pour decrements stock; refresh the cache so drinks that
  // just went out-of-stock reflect as disabled without needing a screen reload.
  on("POUR_COMPLETE", () => { loadInventory(); });
  // `#admin` is the direct entry point for the inventory screen when you
  // have a keyboard attached; the idle eyebrow 5-tap is the in-kiosk path.
  const initial = location.hash === "#admin" ? "admin" : "idle";
  navigate(initial);
});

window.addEventListener("hashchange", () => {
  if (location.hash === "#admin" && currentScreenName !== "admin") {
    navigate("admin");
  }
});
