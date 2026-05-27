// Bottom queue tray for the mobile order page. Always visible as a peek; tap
// (or drag) to expand into a sheet that lists every drink the current client
// has waiting. Owns its own DOM so the expand/collapse transition is smooth
// across queue updates — the host calls updateTray() to push new data
// without rebuilding the element.

import { getDrinkById } from "./drinks.js";
import { CLOSE_SVG, CHECK_SVG } from "./icons.js";
import { fireConfettiWhenVisible } from "./components/confetti.js";
import {
  formatByHand,
  formatGarnishProse,
  formatTopUpProse,
  joinList,
} from "./format.js";

let trayEl = null;
let backdropEl = null;
let peekEl = null;
let listEl = null;
let summaryEl = null;
let pourNextEl = null;
let completionEl = null;
let contentEl = null; // wraps peek + completion; its height/opacity animate on swap
let drag = null; // active drag-to-expand/collapse gesture, or null

// Which content the tray is showing — "queue" or "complete". Tracked so only the
// transition between the two animates, not same-mode re-renders (queue updates).
let contentMode = null;
let swapToken = 0;
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

// Drag distances to commit a toggle on release; a flick faster than
// DRAG_VELOCITY px/ms toggles regardless of distance. Expand is easier to
// trigger than collapse so a small upward pull opens the tray, but a stray
// downward nudge on the expanded list doesn't snap it shut.
const EXPAND_DISTANCE = 40;
const COLLAPSE_DISTANCE = 80;
const DRAG_VELOCITY = 0.4;

// iOS-style rubber-band easing: a pull moves the tray progressively less,
// asymptoting toward RUBBER_LIMIT. The collapsed peek can't be dragged far up
// the screen — it gives an elastic tug (leaving a small gap at the bottom) and
// springs back unless the pull crossed the expand threshold.
const RUBBER_LIMIT = 160;
function rubber(distance) {
  const sign = Math.sign(distance);
  const x = Math.abs(distance);
  return sign * (1 - 1 / ((x / RUBBER_LIMIT) * 0.55 + 1)) * RUBBER_LIMIT;
}

let state = {
  queue: { entries: [], awaitingContinue: false },
  clientId: null,
  expanded: false,
  onPourNext: null,
  onRemove: null,
  onCompletionDismiss: null,
  // Completion data { drinkName, finishHint } when the guest's own drink just
  // finished pouring — takes over the tray until dismissed; null otherwise.
  completed: null,
  // Tracks whether the guest's OWN drink was at the head of a parked queue
  // on the previous update. We celebrate (haptic + confetti) on the
  // false → true transition only, not on every subsequent re-render.
  wasOwnDrinkUp: false,
};

export function mountTray({ container, clientId, onPourNext, onRemove, onCompletionDismiss }) {
  state.clientId = clientId;
  state.onPourNext = onPourNext;
  state.onRemove = onRemove;
  state.onCompletionDismiss = onCompletionDismiss;

  // Backdrop sits between the page and the tray when expanded; tapping it
  // collapses. Hidden + non-interactive while peeking.
  backdropEl = document.createElement("div");
  backdropEl.className = "order-tray-backdrop";
  backdropEl.addEventListener("click", () => setExpanded(false));
  container.appendChild(backdropEl);

  trayEl = document.createElement("aside");
  trayEl.className = "order-tray";
  trayEl.setAttribute("role", "region");
  trayEl.setAttribute("aria-label", "Drink queue");

  // The grabber doubles as the toggle. Tap the peek area anywhere = expand;
  // tap the grabber when expanded = collapse.
  const grabber = document.createElement("button");
  grabber.type = "button";
  grabber.className = "order-tray__grabber";
  grabber.setAttribute("aria-label", "Toggle queue");
  grabber.addEventListener("click", () => setExpanded(!state.expanded));
  trayEl.appendChild(grabber);

  // Drag to expand/collapse. Listeners live on the tray itself and persist for
  // its lifetime (it's mounted once). touchmove is non-passive so we can
  // preventDefault and own the gesture instead of the page scrolling under it.
  trayEl.addEventListener("touchstart", onDragStart, { passive: true });
  trayEl.addEventListener("touchmove", onDragMove, { passive: false });
  trayEl.addEventListener("touchend", onDragEnd);
  trayEl.addEventListener("touchcancel", onDragEnd);

  // Peek + completion share a content wrapper so the swap between them can be
  // animated (fade + height morph) without disturbing the grabber above or the
  // expandable list below. See render() / animateContentSwap().
  contentEl = document.createElement("div");
  contentEl.className = "order-tray__content";
  trayEl.appendChild(contentEl);

  peekEl = document.createElement("div");
  peekEl.className = "order-tray__peek";
  // Whole peek is tappable to expand — but only when not already expanded
  // (clicks inside the expanded area shouldn't accidentally collapse).
  peekEl.addEventListener("click", (e) => {
    // Buttons inside the peek (Pour next, Remove) handle their own clicks;
    // bare clicks elsewhere on the peek toggle the tray.
    if (e.target.closest("button")) return;
    setExpanded(!state.expanded);
  });
  contentEl.appendChild(peekEl);

  summaryEl = document.createElement("div");
  summaryEl.className = "order-tray__summary";
  peekEl.appendChild(summaryEl);

  pourNextEl = document.createElement("div");
  pourNextEl.className = "order-tray__pour-next";
  peekEl.appendChild(pourNextEl);

  // Completion content (check + "Enjoy your X" + finish hint + Got it). Hidden
  // by default; .is-complete swaps the peek out for it. See render().
  completionEl = document.createElement("div");
  completionEl.className = "order-tray__completion";
  contentEl.appendChild(completionEl);

  listEl = document.createElement("div");
  listEl.className = "order-tray__list";
  trayEl.appendChild(listEl);

  container.appendChild(trayEl);
  render();
}

export function updateTray({ queue, completed = null }) {
  state.queue = queue;
  state.completed = completed;
  celebrateIfOwnDrinkJustCameUp();
  // Auto-collapse when the queue empties globally — the expanded list
  // shows every drink now, so the trigger is total entries, not just own.
  if (state.expanded && state.queue.entries.length === 0) {
    setExpanded(false);
    return;
  }
  render();
}

// Fires haptic + confetti exactly once when the guest's own drink transitions
// to being parked at the head of the queue (the "go to the bartender now"
// moment). Confetti defers itself if the page isn't currently visible.
function celebrateIfOwnDrinkJustCameUp() {
  const first = state.queue.entries[0];
  const ownDrinkUp =
    !!state.queue.awaitingContinue &&
    !!first &&
    first.clientId === state.clientId;
  if (ownDrinkUp && !state.wasOwnDrinkUp) {
    // Two-pulse pattern reads as a notification, not an error buzz. iOS
    // Safari doesn't implement vibrate — the optional chain swallows it.
    navigator.vibrate?.([180, 90, 180]);
    fireConfettiWhenVisible();
  }
  state.wasOwnDrinkUp = ownDrinkUp;
}

export function setExpanded(next) {
  if (state.expanded === next) return;
  // Can't expand into an empty queue (any drink — own or otherwise — is enough;
  // bystanders can scroll the list to see what's ahead of them), and completion
  // takes over the tray with no list to show, so block expansion while it's up.
  if (next && (state.queue.entries.length === 0 || state.completed)) return;
  state.expanded = next;
  trayEl?.classList.toggle("is-expanded", next);
  backdropEl?.classList.toggle("is-visible", next);
  render();
}

// --- Drag to expand / collapse -------------------------------------------

function onDragStart(e) {
  if (!trayEl) return;
  // The action buttons (Pour next, Remove) keep their own taps and the expanded
  // list keeps its own scroll. Everything else — grabber, peek summary — starts
  // a drag. The grabber is the obvious handle, so it must NOT be excluded here;
  // a tap on it still toggles via its click handler (onDragEnd bails when the
  // gesture never engaged).
  if (e.target.closest(".order-tray__pour-btn, .queue-remove-btn, .order-tray__complete-dismiss")) return;
  if (e.target.closest(".order-tray__list")) return;
  if (state.queue.entries.length === 0 && !state.completed) return; // nothing to drag
  const t = e.touches[0];
  drag = { startY: t.clientY, lastY: t.clientY, lastT: e.timeStamp, dy: 0, vy: 0, active: false };
}

function onDragMove(e) {
  if (!drag) return;
  const t = e.touches[0];
  drag.dy = t.clientY - drag.startY;
  const dt = e.timeStamp - drag.lastT || 1;
  drag.vy = (t.clientY - drag.lastY) / dt;
  drag.lastY = t.clientY;
  drag.lastT = e.timeStamp;
  // Engage only once the finger has clearly moved, so a tap still falls through
  // to the peek/grabber click handlers (which transition normally).
  if (!drag.active && Math.abs(drag.dy) < 6) return;
  if (!drag.active) {
    drag.active = true;
    trayEl.style.transition = "none"; // follow the finger 1:1
  }
  // Expanded or showing completion: pulling down tracks the finger (toward
  // collapse / dismiss); pulling up rubber-bands. Collapsed peek: anchored to
  // the bottom, so pulling up gives an elastic tug (crossing the expand
  // threshold on release) while a downward pull stays put — nowhere below to go.
  let offset;
  if (state.expanded || state.completed) {
    offset = drag.dy > 0 ? drag.dy : rubber(drag.dy);
  } else {
    offset = drag.dy < 0 ? rubber(drag.dy) : 0;
  }
  trayEl.style.transform = `translateY(${offset}px)`;
  e.preventDefault();
}

function onDragEnd() {
  if (!drag) return;
  const { dy, vy, active } = drag;
  drag = null;
  if (!active) return; // it was a tap — the click handler does the toggle

  // Completion takes over the tray: a downward pull (or flick) dismisses it —
  // the same gesture, and threshold, that collapses the expanded queue.
  if (state.completed) {
    if (dy > COLLAPSE_DISTANCE || vy > DRAG_VELOCITY) {
      trayEl.style.transition = "";
      trayEl.style.transform = "";
      state.onCompletionDismiss?.();
    } else {
      springBack();
    }
    return;
  }

  const shouldCollapse = state.expanded && (dy > COLLAPSE_DISTANCE || vy > DRAG_VELOCITY);
  const shouldExpand = !state.expanded && (dy < -EXPAND_DISTANCE || vy < -DRAG_VELOCITY);
  if (shouldCollapse || shouldExpand) {
    // Commit: restore the stylesheet transition so max-height and the transform
    // settle to the new rest state together, then clear the inline offset.
    trayEl.style.transition = "";
    trayEl.style.transform = "";
    setExpanded(shouldExpand);
    return;
  }
  springBack();
}

// Snap back to the current rest state with a springy overshoot, matching the
// drink-detail sheet's feel. Clear the inline transition once it settles so a
// later tap-driven expand/collapse uses the stylesheet's max-height transition
// (a transform-only inline transition would otherwise suppress that animation).
function springBack() {
  trayEl.style.transition = "transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)";
  trayEl.style.transform = "";
  trayEl.addEventListener("transitionend", clearDragTransition, { once: true });
}

function clearDragTransition() {
  if (drag) return; // a new drag is in progress — leave its transition alone
  trayEl.style.transition = "";
}

function ownEntries() {
  return state.queue.entries.filter((e) => e.clientId === state.clientId);
}

function drinkForOrder(order) {
  if (!order) return null;
  if (order.customDrink) return order.customDrink;
  return getDrinkById(order.drinkId);
}

function renderSummary() {
  summaryEl.innerHTML = "";

  const mine = ownEntries();
  const total = state.queue.entries.length;

  const label = document.createElement("div");
  label.className = "order-tray__summary-label";

  const count = document.createElement("div");
  count.className = "order-tray__summary-count";

  if (mine.length > 0) {
    const firstPos = state.queue.entries.findIndex((e) => e.id === mine[0].id) + 1;
    label.textContent = mine.length === 1 ? "Your drink" : `Your ${mine.length} drinks`;
    // "next at #3" reads like a contradiction (next ought to mean #1).
    // Spell it out: position 1 is "up next"; everything else is "#N in line".
    count.textContent = firstPos === 1 ? "up next" : `#${firstPos} in line`;
  } else if (total > 0) {
    label.textContent = "Queue";
    count.textContent = `${total} drink${total > 1 ? "s" : ""} waiting`;
  } else {
    label.textContent = "Queue";
    count.textContent = "empty";
  }

  summaryEl.append(label, count);

  // Chevron hints at expandability — flips when expanded. Hidden when the
  // queue is globally empty (nothing to expand into); shown whenever any
  // drink is queued so bystanders can see what's in line ahead of them.
  if (total > 0) {
    const chev = document.createElement("span");
    chev.className = "order-tray__chev";
    chev.setAttribute("aria-hidden", "true");
    chev.textContent = "▾";
    summaryEl.appendChild(chev);
  }
}

function renderPourNext() {
  pourNextEl.innerHTML = "";
  // Only the guest whose drink is at the head of a parked queue should see
  // the "You're up" prompt. The server accepts QUEUE_CONTINUE from any
  // client, but showing the prompt to bystanders is misleading — their
  // drinks aren't next, and they'd be advancing someone else's pour.
  const first = state.queue.entries[0];
  const ownDrinkUp =
    !!state.queue.awaitingContinue &&
    !!first &&
    first.clientId === state.clientId;
  if (!ownDrinkUp) {
    pourNextEl.hidden = true;
    return;
  }
  pourNextEl.hidden = false;

  const nextDrink = drinkForOrder(state.queue.entries[0].order);
  // The heading names the destination so it's unambiguous that the user has
  // to physically walk over — a remote-looking UI on a phone can otherwise
  // mislead the guest into thinking the button alone starts the pour.
  const heading = document.createElement("span");
  heading.className = "order-tray__pour-heading";
  heading.textContent = "You're up at the bartender";
  const hint = document.createElement("span");
  hint.className = "order-tray__pour-hint";
  hint.textContent = "Place a glass on the tray, then:";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "order-tray__pour-btn";
  btn.textContent = `Pour ${nextDrink?.name || "next drink"} →`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.onPourNext?.();
  });
  pourNextEl.append(heading, hint, btn);

  // Finish-by-hand reminder — the same items the kiosk's complete screen lists
  // ("top up with cola and add a lime wedge"). The phone has no complete
  // screen, so this is the guest's prompt to finish the drink, surfaced at the
  // one moment we know they're at the machine pouring THIS drink. by-hand
  // ingredients (machine wasn't loaded), then the top-up mixer, then garnish —
  // the natural pour-and-finish order, matching complete.js.
  const finishOrder = state.queue.entries[0].order;
  const finishParts = [];
  for (const ing of finishOrder?.missingByHand || []) finishParts.push(formatByHand(ing));
  if (nextDrink?.topUp) finishParts.push(formatTopUpProse(nextDrink.topUp, finishOrder?.amount ?? 1));
  if (nextDrink?.garnish) finishParts.push(formatGarnishProse(nextDrink.garnish));
  if (finishParts.length) {
    const finish = document.createElement("span");
    finish.className = "order-tray__pour-finish";
    finish.textContent = `Then finish it: add ${joinList(finishParts)}`;
    pourNextEl.appendChild(finish);
  }
}

function renderList() {
  listEl.innerHTML = "";
  if (state.queue.entries.length === 0) return;

  const heading = document.createElement("div");
  heading.className = "order-tray__list-heading";
  heading.textContent = "Queue";
  listEl.appendChild(heading);

  for (let i = 0; i < state.queue.entries.length; i++) {
    const entry = state.queue.entries[i];
    const pos = i + 1;
    const drink = drinkForOrder(entry.order);
    const isOwn = entry.clientId === state.clientId;

    const row = document.createElement("div");
    row.className = "order-tray__row";
    // Subtle green left-stripe on the user's own drinks so they can scan
    // the list and find theirs without reading names.
    if (isOwn) row.classList.add("order-tray__row--own");

    const posEl = document.createElement("div");
    posEl.className = "order-tray__row-pos";
    posEl.textContent = `#${pos}`;
    row.appendChild(posEl);

    const info = document.createElement("div");
    info.className = "order-tray__row-info";
    const name = document.createElement("div");
    name.className = "order-tray__row-name";
    name.textContent = drink?.name || "Drink";
    info.appendChild(name);
    if (entry.order?.strength && entry.order.strength !== "regular") {
      const meta = document.createElement("div");
      meta.className = "order-tray__row-meta";
      meta.textContent = entry.order.strength;
      info.appendChild(meta);
    }
    row.appendChild(info);

    // Remove button only on the guest's own rows — server enforces the same
    // scope on QUEUE_REMOVE, but hiding the button keeps the UI honest.
    // Kiosk has its own queue screen that can remove any entry.
    if (isOwn) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "queue-remove-btn";
      remove.setAttribute("aria-label", `Remove ${drink?.name || "drink"}`);
      remove.innerHTML = CLOSE_SVG;
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        state.onRemove?.(entry.id);
      });
      row.appendChild(remove);
    }

    listEl.appendChild(row);
  }
}

function render() {
  if (!trayEl) return;
  const wasHidden = document.body.classList.contains("tray-empty");
  const empty = state.queue.entries.length === 0 && !state.completed;
  // Hide the whole tray when the global queue is empty — there's nothing to
  // indicate. Toggling a body class lets the existing CSS variable cascade
  // collapse the tray height, drop the toast back to the page bottom, and
  // reclaim the list's bottom padding in one shot. Re-appears the moment
  // anyone (user or another guest) queues a drink. Completion keeps the tray on
  // screen even when the queue is otherwise empty.
  document.body.classList.toggle("tray-empty", empty);
  // Green grabber pill only when the guest has skin in the game (their own
  // drink in the queue). Otherwise the pill is muted — the tray still
  // surfaces other guests' drinks but doesn't shout for attention.
  trayEl.classList.toggle("has-own-drink", ownEntries().length > 0);
  // Completion always collapses the tray — there's no list to expand into.
  // Done inline (not via setExpanded) to avoid re-entering render().
  if (state.completed && state.expanded) {
    state.expanded = false;
    trayEl.classList.remove("is-expanded");
    backdropEl?.classList.remove("is-visible");
  }

  const nextMode = state.completed ? "complete" : "queue";
  // Animate only the queue⇄completion swap, and only while the tray stays on
  // screen through it: a hidden→shown change is already animated by the tray's
  // own slide-up, and a hidden element measures as zero height. Same-mode
  // re-renders (queue updates) just rebuild in place.
  const animate =
    contentMode !== null &&
    nextMode !== contentMode &&
    !wasHidden &&
    !empty &&
    !reduceMotion?.matches;
  if (animate) {
    animateContentSwap(applyContent);
  } else {
    applyContent();
  }
  contentMode = nextMode;
}

// Toggles the completion class and renders whichever content the current state
// calls for. Reads live state, so it's correct whether called instantly or at
// the midpoint of a swap animation.
function applyContent() {
  // Completion takes over: green top border + completion block, with the queue
  // peek/list hidden (CSS keys off .is-complete).
  trayEl.classList.toggle("is-complete", !!state.completed);
  if (state.completed) {
    renderCompletion();
    return;
  }
  renderSummary();
  renderPourNext();
  renderList();
}

// Cross-fades the tray's content on a queue⇄completion swap: fade the old out
// at its current height, swap the DOM, then morph the height to the new content
// while fading it in. Token-guarded so a swap superseded mid-flight (e.g. a
// quick dismiss) bails instead of fighting the newer one.
function animateContentSwap(apply) {
  const token = ++swapToken;
  const fromH = contentEl.offsetHeight;
  contentEl.style.height = `${fromH}px`;
  contentEl.style.transition = "opacity 120ms ease";
  contentEl.style.opacity = "0";
  setTimeout(() => {
    if (token !== swapToken) return;
    apply();
    // Measure the incoming content's natural height, then animate to it.
    contentEl.style.height = "auto";
    const toH = contentEl.offsetHeight;
    contentEl.style.height = `${fromH}px`;
    contentEl.offsetHeight; // reflow so the height change transitions
    contentEl.style.transition = "height 220ms ease, opacity 200ms ease";
    contentEl.style.height = `${toH}px`;
    contentEl.style.opacity = "1";
    setTimeout(() => {
      if (token !== swapToken) return;
      contentEl.style.height = "";
      contentEl.style.transition = "";
    }, 240);
  }, 130);
}

// Builds the completion block (check + "Enjoy your X" + finish-by-hand hint +
// Got it). Rebuilt on each render while completion is up; harmless since it
// carries no entrance animation — the tray's slide-up (from empty) or the
// green border is the arrival cue.
function renderCompletion() {
  completionEl.innerHTML = "";
  const head = document.createElement("div");
  head.className = "order-tray__complete-head";
  const check = document.createElement("span");
  check.className = "order-tray__complete-check";
  check.innerHTML = CHECK_SVG;
  const title = document.createElement("p");
  title.className = "order-tray__complete-title";
  title.textContent = `Enjoy your ${state.completed.drinkName}`;
  head.append(check, title);
  completionEl.appendChild(head);

  if (state.completed.finishHint) {
    const hint = document.createElement("p");
    hint.className = "order-tray__complete-finish";
    hint.textContent = state.completed.finishHint;
    completionEl.appendChild(hint);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "order-tray__complete-dismiss";
  dismiss.textContent = "Got it";
  dismiss.addEventListener("click", () => state.onCompletionDismiss?.());
  completionEl.appendChild(dismiss);
}
