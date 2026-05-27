// Mobile order page. Lives at /order, served to phones that joined the AP
// and bounced through the captive-portal welcome screen. Talks to the same
// REST + WebSocket backend the kiosk uses — the queue is shared, so a drink
// ordered from a phone shows up in the kiosk's queue view too.

import { startWS, on as onWS } from "./ws.js";
import {
  categories,
  drinks,
  replaceDrinks,
  getDrinkById,
  setCategoryEnabledLookup,
  isDrinkEnabled,
} from "./drinks.js";
import { loadInventory, isDrinkPourable } from "./inventory-store.js";
import { loadIngredients } from "./ingredient-store.js";
import { ingredientName } from "./ingredients.js";
import {
  formatByHand,
  formatGarnishProse,
  formatTopUpProse,
  joinList,
} from "./format.js";
import { loadCategoriesConfig, isCategoryEnabled } from "./category-store.js";
import {
  addToQueue,
  removeFromQueue,
  onQueueChange,
  isQueueFull,
  queueToasts,
  continueQueue,
} from "./queue-store.js";
import { onMachineStatus } from "./machine-status.js";
import { getClientId } from "./order-client-id.js";
import {
  openSheet,
  refreshSheet,
  isOpen as isSheetOpen,
  openDrinkId,
} from "./order-sheet.js";
import { renderStatusBar } from "./order-status.js";
import { mountTray, updateTray, setExpanded as setTrayExpanded } from "./order-tray.js";
import {
  unlockAudio,
  requestNotificationPermission,
  notifyDrinkReady,
  wantWakeLock,
} from "./order-notify.js";
import { showQueueToast } from "./components/toast.js";
import { fireConfettiWhenVisible } from "./components/confetti.js";
import { CHECK_SVG } from "./icons.js";

// drinks.js asks the category store whether a category is on; without this
// shim, hidden-category drinks would still surface here.
setCategoryEnabledLookup(isCategoryEnabled);

const CLIENT_ID = getClientId();

const state = {
  activeCategory: null, // category id, or null = "All" (no filter)
  // Whether the category dropdown is open. Persisted in state so it survives
  // the rerenders that picking a category (and background WS updates) trigger.
  filterOpen: false,
  machine: { status: "idle", job: null },
  queue: { entries: [], awaitingContinue: false },
  // Tracks the pour driver's "waiting-for-glass" sub-state — the machine is
  // still "pouring", but it's idling on the platform waiting for a glass to
  // be placed. The bar surfaces this so the guest knows the pause is on them.
  waitingForGlass: false,
  // Live pour progress mirrored from POUR_PROGRESS events. Reset when the
  // machine transitions out of "pouring". Drives the header progress bar.
  pour: null,
  // The order THIS phone placed that is pouring right now (matched via the
  // live job's clientId). Remembered so POUR_COMPLETE can show a completion
  // banner — the job, and its clientId, are gone by the time the machine idles.
  myPour: null,
  // Completion banner data after this phone's drink finishes:
  // { drinkName, finishHint }. Cleared on glass-lift, tap, or timeout.
  completed: null,
};

// The completion banner self-dismisses after this long if the guest never
// lifts their glass or taps it away — a backstop so it doesn't linger forever.
const COMPLETED_DISMISS_MS = 30000;
let completedTimer = null;
// Tracks whether a glass was on the tray since the banner appeared, so we
// dismiss on the lift (true → false) edge rather than on its mere absence.
let sawGlassAfterComplete = false;

const root = document.getElementById("order-app");

// Set true the instant a category filter changes, so the very next renderList()
// plays the staggered card-entrance animation. Background WS rerenders (queue,
// machine status) leave it false, so the list doesn't re-animate on every tick.
let filterChanged = false;

// ---------- Filters + list ----------------------------------------------

// Categories the guest can pick from — built-in order, minus shots (phase 2)
// and any an admin has hidden.
function selectableCategories() {
  return categories.filter((c) => c.id !== "shots" && isCategoryEnabled(c.id));
}

// Trigger-button text: "All drinks" when nothing's picked, otherwise the
// selected category's name.
function filterLabel() {
  if (state.activeCategory === null) return "All drinks";
  return categories.find((c) => c.id === state.activeCategory)?.name ?? "All drinks";
}

function setFilterOpen(open) {
  state.filterOpen = open;
  rerender();
}

// Pick a category (id === null is the "All" row). Single-select, so this just
// replaces the selection and closes the dropdown; the list re-filters with the
// entrance animation.
function selectCategory(id) {
  state.activeCategory = id;
  state.filterOpen = false;
  filterChanged = true;
  rerender();
}

// Available-drink count as a small pill. Shared by the dropdown rows and the
// trigger; the trigger's --active variant flips it dark so it stays legible on
// the inverted button.
function filterBadge(count) {
  const b = document.createElement("span");
  b.className = "order-filter__badge";
  b.textContent = String(count);
  return b;
}

function filterOption(id, label, selected, count) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "order-filter__option";
  row.setAttribute("role", "menuitemradio");
  row.setAttribute("aria-checked", String(selected));
  if (selected) row.classList.add("is-selected");
  const main = document.createElement("span");
  main.className = "order-filter__option-main";
  const text = document.createElement("span");
  text.className = "order-filter__option-label";
  text.textContent = label;
  main.append(filterBadge(count), text);
  const check = document.createElement("span");
  check.className = "order-filter__check";
  check.innerHTML = CHECK_SVG;
  row.append(main, check);
  row.addEventListener("click", () => selectCategory(id));
  return row;
}

function renderFilters() {
  const wrap = document.createElement("nav");
  wrap.className = "order-filter";
  if (state.filterOpen) wrap.classList.add("is-open");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "order-filter__trigger";
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", String(state.filterOpen));
  if (state.activeCategory !== null) trigger.classList.add("is-active");
  const main = document.createElement("span");
  main.className = "order-filter__trigger-main";
  const label = document.createElement("span");
  label.className = "order-filter__label";
  label.textContent = filterLabel();
  main.append(filterBadge(availableCount(state.activeCategory)), label);
  const chev = document.createElement("span");
  chev.className = "order-filter__chev";
  chev.setAttribute("aria-hidden", "true");
  chev.textContent = "▾";
  trigger.append(main, chev);
  trigger.addEventListener("click", () => setFilterOpen(!state.filterOpen));
  wrap.appendChild(trigger);

  if (state.filterOpen) {
    // Full-screen tap-catcher behind the panel: a tap anywhere off the menu
    // closes it without changing the filter (no animation).
    const backdrop = document.createElement("div");
    backdrop.className = "order-filter__backdrop";
    backdrop.addEventListener("click", () => setFilterOpen(false));
    wrap.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.className = "order-filter__panel";
    panel.setAttribute("role", "menu");
    panel.appendChild(
      filterOption(null, "All drinks", state.activeCategory === null, availableCount(null))
    );
    const divider = document.createElement("div");
    divider.className = "order-filter__divider";
    divider.setAttribute("role", "separator");
    panel.appendChild(divider);
    for (const c of selectableCategories()) {
      panel.appendChild(
        filterOption(c.id, c.name, state.activeCategory === c.id, availableCount(c.id))
      );
    }
    wrap.appendChild(panel);
  }
  return wrap;
}

// A drink is "available" on the order page when it's enabled, sits in an
// enabled non-shots category, and is currently pourable. Pourability hides
// drinks whose ingredients aren't loaded — the mobile UI shouldn't tease an
// option a guest can't order; inventory updates re-fire rerender() so a
// refilled bottle brings it (and its category count) back. The active-category
// filter is layered on top in visibleDrinks(); the dropdown counts the same
// "available" set per category, ignoring that filter.
function isAvailable(d) {
  return (
    isDrinkEnabled(d) &&
    isCategoryEnabled(d.category) &&
    d.category !== "shots" &&
    isDrinkPourable(d)
  );
}

function visibleDrinks() {
  return drinks.filter(
    (d) => isAvailable(d) && (!state.activeCategory || d.category === state.activeCategory)
  );
}

// Number of available drinks in a category, or the total across all categories
// when categoryId is null (the "All drinks" row).
function availableCount(categoryId) {
  return drinks.filter(
    (d) => isAvailable(d) && (categoryId === null || d.category === categoryId)
  ).length;
}

function ingredientLine(drink) {
  return drink.ingredients
    .map((i) => ingredientName(i.name).toLowerCase())
    .join(" · ");
}

function renderCard(drink) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "order-card";

  const thumb = document.createElement("div");
  thumb.className = "order-card__thumb";
  if (drink.photo) {
    const img = document.createElement("img");
    img.src = drink.photo;
    img.alt = "";
    img.loading = "lazy";
    thumb.appendChild(img);
  } else {
    thumb.classList.add("order-card__thumb--fallback");
    thumb.textContent = drink.name.charAt(0);
  }

  const body = document.createElement("div");
  body.className = "order-card__body";
  const cat = document.createElement("div");
  cat.className = "order-card__category";
  cat.dataset.cat = drink.category;
  cat.textContent = drink.category;
  const name = document.createElement("h2");
  name.className = "order-card__name";
  name.textContent = drink.name;
  const line = document.createElement("div");
  line.className = "order-card__line";
  line.textContent = ingredientLine(drink);
  body.append(cat, name, line);

  card.append(thumb, body);
  card.addEventListener("click", () => openSheetFor(drink));
  return card;
}

function renderList() {
  const wrap = document.createElement("section");
  wrap.className = "order-list";
  // Consume the one-shot flag: animate this build only if a filter just changed.
  const animate = filterChanged;
  filterChanged = false;
  const items = visibleDrinks();
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "order-empty";
    empty.textContent = "No drinks available right now.";
    wrap.appendChild(empty);
    return wrap;
  }
  items.forEach((d, i) => {
    const card = renderCard(d);
    if (animate) {
      card.classList.add("is-entering");
      // Stagger the entrance, capped so a long list doesn't trail off into a
      // visibly slow cascade. CSS multiplies this by the per-card step.
      card.style.setProperty("--stagger", String(Math.min(i, 8)));
    }
    wrap.appendChild(card);
  });
  return wrap;
}

// ---------- Sheet wiring + ordering -------------------------------------

function openSheetFor(drink) {
  openSheet({
    drinkId: drink.id,
    isPourable: isDrinkPourable(drink),
    isQueueFull: isQueueFull(),
    onOrder: placeOrder,
  });
}

async function placeOrder(drink, order) {
  const result = await addToQueue(order, CLIENT_ID);
  if (result.rejected) {
    showQueueToast(queueToasts.full());
    return;
  }
  // Successful add → the guest is now waiting on a "ready" signal, which is
  // the right moment to ask for OS notification permission (sticky across
  // visits, so we only get prompted once).
  requestNotificationPermission();
  if (result.pouringNow) {
    showQueueToast(queueToasts.pouringNow(drink.name));
    return;
  }
  showQueueToast(queueToasts.added(result.position));
}

// ---------- Top-level render --------------------------------------------

function removeOwnDrink(id) {
  removeFromQueue(id, CLIENT_ID);
  showQueueToast(queueToasts.removed());
}

function pourNext() {
  continueQueue();
  showQueueToast(queueToasts.pouringNext());
}

// Finish-by-hand reminder for THIS phone's drink while it's pouring — the
// mobile stand-in for the kiosk's complete screen. It covers the gap the tray
// reminder can't: an order into an empty queue pours immediately, never
// entering the "You're up" parked state, so without this the guest is never
// told to top up / garnish unless the kiosk happens to be idle. Keyed on the
// live job's clientId (threaded through by the server) so it only fires for
// this phone's drink, never a co-guest's. Returns null when there's nothing to
// add by hand or the live pour isn't ours.
// The by-hand items for an order as display prose, in the kiosk complete
// screen's order: ingredients the machine wasn't loaded for, then the top-up
// mixer, then the garnish. Empty when there's nothing to finish by hand.
function finishParts(order, drink) {
  const parts = [];
  for (const ing of order?.missingByHand || []) parts.push(formatByHand(ing));
  if (drink.topUp) parts.push(formatTopUpProse(drink.topUp, order?.amount ?? 1));
  if (drink.garnish) parts.push(formatGarnishProse(drink.garnish));
  return parts;
}

function scheduleCompletedDismiss() {
  if (completedTimer) clearTimeout(completedTimer);
  completedTimer = setTimeout(dismissCompleted, COMPLETED_DISMISS_MS);
}

function dismissCompleted() {
  if (completedTimer) {
    clearTimeout(completedTimer);
    completedTimer = null;
  }
  sawGlassAfterComplete = false;
  state.completed = null;
  // Push the cleared state into the tray (drops the completion block + green
  // border; re-hides the tray if the queue is now empty).
  rerender();
}

// The header (status) and the list re-render on every state change. The tray
// is mounted once and updated in place so its expand/collapse transition
// survives queue updates.
function rerender() {
  // Keep the tray + its backdrop in the DOM across rerenders.
  for (const child of Array.from(root.children)) {
    if (child.classList.contains("order-tray") || child.classList.contains("order-tray-backdrop")) {
      continue;
    }
    child.remove();
  }
  const tray = root.querySelector(".order-tray");
  // Status banner + category filters share one sticky header so the filter
  // chips stay pinned directly under the banner while the drink list scrolls.
  // Wrapping them (rather than making the filters independently sticky with a
  // fixed top offset) keeps the chips glued to the banner's bottom edge even as
  // the banner grows taller to show the pour-progress bar.
  const headerEl = document.createElement("div");
  headerEl.className = "order-header";
  headerEl.appendChild(renderStatusBar({
    machine: state.machine,
    pour: state.pour,
    waitingForGlass: state.waitingForGlass,
    // Mirrors the kiosk's "tap pill → queue" affordance: on mobile, expand
    // the bottom tray so the guest sees their own drinks + Pour-next CTA.
    onPillTap: () => setTrayExpanded(true),
  }));
  headerEl.appendChild(renderFilters());

  // Header + list go between the tray (which stays last) and the top.
  if (tray) {
    root.insertBefore(headerEl, tray);
    root.insertBefore(renderList(), tray);
  } else {
    root.append(headerEl, renderList());
  }

  // The status banner and the category nav are layered independently against the
  // backdrops (banner above, nav behind), so they can't share one sticky
  // wrapper — .order-header is display:contents. Keep the nav's sticky offset
  // equal to the banner's current height (which grows when the pour-progress bar
  // shows) so it stays glued just beneath it as the list scrolls.
  const statusEl = headerEl.querySelector(".order-status");
  const filterEl = headerEl.querySelector(".order-filter");
  if (statusEl && filterEl) filterEl.style.top = `${statusEl.offsetHeight}px`;

  updateTray({ queue: state.queue, completed: state.completed });

  // The drink-detail sheet lives outside `root`. If it's open, push the
  // latest pourability + queue-full state into it.
  if (isSheetOpen()) {
    const drink = getDrinkById(openDrinkId());
    refreshSheet({
      isPourable: drink ? isDrinkPourable(drink) : false,
      isQueueFull: isQueueFull(),
    });
  }
}

// ---------- Boot ---------------------------------------------------------

// True when this phone has any skin in the game — a queued order, or the
// live pour is ours. Drives the screen wake lock so the phone stays awake
// while the guest is waiting.
function hasPendingOrder() {
  if (state.myPour) return true;
  return state.queue.entries.some((e) => e.clientId === CLIENT_ID);
}

async function boot() {
  // Unlock the audio context on the very first user gesture — iOS Safari
  // requires AudioContext to start synchronously inside a touch/click, so
  // a one-shot pointerdown listener catches whichever tap happens first.
  document.addEventListener("pointerdown", unlockAudio, { once: true });

  startWS();
  await Promise.all([
    fetch("/api/drinks").then((r) => r.json()).then((d) => {
      if (Array.isArray(d.drinks)) replaceDrinks(d.drinks);
    }).catch(() => {}),
    loadInventory(),
    loadIngredients(),
    loadCategoriesConfig(),
  ]);

  // Mount the bottom tray once so its expand/collapse transition survives
  // queue updates. The host owns side-effects (toast on remove, etc.).
  mountTray({
    container: root,
    clientId: CLIENT_ID,
    onPourNext: pourNext,
    onRemove: removeOwnDrink,
    onCompletionDismiss: dismissCompleted,
  });

  // Seed initial queue/machine state — these handlers fire immediately with
  // whatever the stores cached at WS connect, then again on every update.
  onQueueChange((q) => {
    state.queue = q;
    wantWakeLock(hasPendingOrder());
    rerender();
  });
  onMachineStatus((m) => {
    state.machine = m;
    // Remember our in-flight pour while the job (and its clientId) is live, so
    // POUR_COMPLETE below can celebrate the right drink.
    if (m.status === "pouring" && m.job?.clientId === CLIENT_ID) {
      state.myPour = m.job.order;
    }
    // Any machine transition out of "pouring" clears the glass-wait sub-state
    // and the live progress data — the pour finished, was cancelled, or errored.
    // POUR_COMPLETE fires just before this idle transition and captures myPour
    // into `completed`; clear the in-flight ref either way so a cancelled or
    // errored pour doesn't leave a stale reference for the next completion.
    if (m.status !== "pouring") {
      state.waitingForGlass = false;
      state.pour = null;
      state.myPour = null;
    }
    // Lifting the glass off the tray dismisses the completion banner — the
    // guest has taken their drink. Mirrors the kiosk complete screen's exit.
    if (state.completed) {
      if (m.glassPresent) sawGlassAfterComplete = true;
      else if (sawGlassAfterComplete) dismissCompleted();
    }
    wantWakeLock(hasPendingOrder());
    rerender();
  });
  // Our drink just finished. Show the completion banner with the finish-by-hand
  // reminder — this is the phone's only "done" moment, and the during-pour hint
  // in the status bar vanishes the instant the machine idles. Quiet for pours
  // that aren't ours (kiosk-ordered, or a co-guest's).
  onWS("POUR_COMPLETE", () => {
    if (!state.myPour) return;
    const order = state.myPour;
    const drink = order.customDrink || getDrinkById(order.drinkId);
    state.myPour = null;
    if (!drink) return;
    const parts = finishParts(order, drink);
    state.completed = {
      drinkName: drink.name,
      finishHint: parts.length ? `Don’t forget to add ${joinList(parts)}` : null,
    };
    // If a glass is already on the tray (real hardware), arm the lift-to-dismiss
    // edge; in mock/dev glassPresent stays false and the timeout dismisses.
    sawGlassAfterComplete = !!state.machine.glassPresent;
    navigator.vibrate?.([180, 90, 180]);
    notifyDrinkReady(drink.name);
    fireConfettiWhenVisible();
    scheduleCompletedDismiss();
    rerender(); // tray picks up state.completed and takes over its surface
  });
  // POUR_PROGRESS drives both the waiting-for-glass label and the header's
  // progress bar. status:"waiting-for-glass" toggles the sub-state; any
  // other progress message carries pct/step data for the bar.
  onWS("POUR_PROGRESS", (msg) => {
    if (msg.status === "waiting-for-glass") {
      state.waitingForGlass = true;
      rerender();
      return;
    }
    state.waitingForGlass = false;
    state.pour = {
      pct: typeof msg.pct === "number" ? msg.pct : state.pour?.pct ?? 0,
      step: msg.step ?? state.pour?.step ?? null,
      stepIndex: Number.isInteger(msg.stepIndex) ? msg.stepIndex : state.pour?.stepIndex ?? 0,
      totalSteps: Number.isInteger(msg.totalSteps) ? msg.totalSteps : state.pour?.totalSteps ?? 0,
    };
    rerender();
  });
  onWS("INVENTORY_UPDATED", () => rerender());

  rerender();
}

boot();
