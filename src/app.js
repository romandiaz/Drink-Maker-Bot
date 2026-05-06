import { idle } from "./screens/idle.js";
import { category } from "./screens/category.js";
import { search } from "./screens/search.js";
import { drinkList } from "./screens/drink-list.js";
import { detail } from "./screens/detail.js";
import { pouring } from "./screens/pouring.js";
import { complete } from "./screens/complete.js";
import { shotPicker } from "./screens/shot-picker.js";
import { shotDetail } from "./screens/shot-detail.js";
import { buildYourOwn } from "./screens/build-your-own.js";
import { admin } from "./screens/admin.js";
import { notifications } from "./screens/admin-notifications.js";
import { on, onStatusChange, startWS } from "./ws.js";
import { replaceDrinks, setCategoryEnabledLookup } from "./drinks.js";
import { loadInventory } from "./inventory-store.js";
import { loadCalibration } from "./calibration-store.js";
import {
  loadCategoriesConfig,
  isCategoryEnabled,
} from "./category-store.js";
import { requestAdminAccess, dismissAdminPrompt } from "./admin-auth.js";
import { clearBuildDraft } from "./state.js";

// Hand drinks.js a way to ask "is this category enabled?" without a circular
// import. setCategoryEnabledLookup just stores the function; the live
// disabled set lives in category-store.js.
setCategoryEnabledLookup(isCategoryEnabled);

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
  buildYourOwn,
  admin,
  notifications,
};

// Inactivity: any screen except idle (already there) and pouring (don't interrupt
// an active pour) returns to idle after 60 seconds without a touch. Admin is
// also exempt — an admin walking off mid-edit shouldn't get punted to idle and
// lose the tab they were on.
const INACTIVITY_MS = 60_000;
const NO_TIMEOUT_SCREENS = new Set(["idle", "pouring", "admin", "notifications"]);

let currentScreen = null;
let currentScreenName = null;
let inactivityTimer = null;

// Screen transition: must match the CSS duration. A small buffer covers the
// case where transitionend doesn't fire (we don't listen for it — the timer
// is the authority so we aren't tied to which property finishes last).
const TRANSITION_MS = 250;
let pendingCleanup = null;

// History stack — every entry is { screen, props }. The top of the stack is
// the screen on screen. Mutated by navigate / goBack / replaceWith / resetStack;
// the back button uses this instead of hard-coded destinations so the same
// button does the right thing whether the user came from search, drink-list,
// idle, or anywhere else.
const stack = [];

function resetInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (NO_TIMEOUT_SCREENS.has(currentScreenName)) return;
  inactivityTimer = setTimeout(() => {
    inactivityTimer = null;
    if (!NO_TIMEOUT_SCREENS.has(currentScreenName)) {
      // A PIN modal left up by a user who walked away shouldn't survive the
      // auto-return — otherwise the next person finds it on top of idle.
      dismissAdminPrompt();
      // The next guest shouldn't inherit the previous user's half-built
      // recipe — wipe the draft alongside the screen reset.
      clearBuildDraft();
      resetStack("idle");
    }
  }, INACTIVITY_MS);
}

// Internal — mounts the screen and runs the transition. Pure presentation;
// stack mutation happens in the public navigate / goBack / replaceWith /
// resetStack helpers.
function doTransition(screenName, props, direction) {
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

// Push a new screen onto the stack. Default forward navigation.
export function navigate(screen, props = {}) {
  stack.push({ screen, props: { ...props } });
  doTransition(screen, props, "push");
}

// Walk back `steps` entries on the stack. Header back buttons call this with
// no argument (= 1 step) by default. Stops at the root entry; if the stack
// somehow empties (defensive — shouldn't happen) we fall through to idle.
export function goBack(steps = 1) {
  while (steps > 0 && stack.length > 1) {
    stack.pop();
    steps--;
  }
  if (stack.length === 0) stack.push({ screen: "idle", props: {} });
  const top = stack[stack.length - 1];
  doTransition(top.screen, top.props, "pop");
}

// Swap the top entry — the previous screen vanishes from history. Used when
// the screen being left should never be a back target (e.g. pouring → complete).
export function replaceWith(screen, props = {}, direction = "push") {
  if (stack.length === 0) stack.push({ screen, props: { ...props } });
  else stack[stack.length - 1] = { screen, props: { ...props } };
  doTransition(screen, props, direction);
}

// Clear the stack and rebuild it from `entries` — each entry is either a
// screen name string or `[screen, props]`. The last entry becomes the active
// screen. Used for "Done"-style returns to idle and for jumps that should
// re-seed the back path (e.g. complete's "Another" button).
export function resetStack(...entries) {
  stack.length = 0;
  for (const e of entries) {
    if (typeof e === "string") stack.push({ screen: e, props: {} });
    else stack.push({ screen: e[0], props: { ...(e[1] || {}) } });
  }
  if (stack.length === 0) stack.push({ screen: "idle", props: {} });
  const top = stack[stack.length - 1];
  // First mount uses resetStack("idle") with no outgoing element — direction
  // is moot in that case. Otherwise treat reset as a return-style transition.
  const direction = currentScreen ? "pop" : "none";
  doTransition(top.screen, top.props, direction);
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

export async function reloadCategoriesConfig() {
  await loadCategoriesConfig();
}

window.addEventListener("DOMContentLoaded", async () => {
  startWS();
  mountWsOverlay();
  await Promise.all([
    hydrateDrinks(),
    loadInventory(),
    loadCalibration(),
    loadCategoriesConfig(),
  ]);
  // Every successful pour decrements stock; refresh the cache so drinks that
  // just went out-of-stock reflect as disabled without needing a screen reload.
  // A successful pour also retires the build-your-own draft — the just-poured
  // recipe is "consumed", and the next category-tap should land on an empty
  // editor (complete-screen "Another" reseeds explicitly via setBuildDraft).
  on("POUR_COMPLETE", () => {
    loadInventory();
    clearBuildDraft();
  });
  // `#admin` is the direct entry point for the inventory screen when you
  // have a keyboard attached; the idle eyebrow 5-tap is the in-kiosk path.
  // The hash route is PIN-gated like the on-screen entries so there's no
  // backdoor — start at idle, then prompt.
  resetStack("idle");
  if (location.hash === "#admin") requestAdminAccess();
});

window.addEventListener("hashchange", () => {
  if (location.hash === "#admin" && currentScreenName !== "admin") {
    requestAdminAccess();
  }
});
