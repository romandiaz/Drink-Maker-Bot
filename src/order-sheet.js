// Bottom sheet for the mobile order page — drink detail + strength selector +
// Order button. Owns its own DOM lifecycle (mounts on open, animates off and
// removes on close) and its own strength selection. The host wires up
// pourability + queue-full state on open and refreshes whenever either
// changes underneath.

import { adjustedIngredients, getDrinkById } from "./drinks.js";
import { ingredientName } from "./ingredients.js";
import { missingIngredients } from "./inventory-store.js";
import { glass } from "./components/glass.js";
import { abvReadout } from "./components/abv-readout.js";
import { formatGarnishList, formatIngredient } from "./format.js";

let sheetEl = null;
let backdropEl = null;
let context = null; // { drinkId, strength, isPourable, isQueueFull, onOrder }
let drag = null; // active drag-to-dismiss gesture, or null

// Pull further than this (or flick down faster than DISMISS_VELOCITY px/ms) to
// dismiss on release; anything short springs back to the open position.
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.55;

export function isOpen() {
  return !!context;
}

// Drink id of the open sheet, or null. Lets the host re-derive pourability
// when inventory changes without having to mirror the sheet's own state.
export function openDrinkId() {
  return context?.drinkId ?? null;
}

export function openSheet({ drinkId, isPourable, isQueueFull, onOrder }) {
  context = {
    drinkId,
    strength: "regular",
    amount: 1.0,
    isPourable,
    isQueueFull,
    onOrder,
  };
  if (!sheetEl) {
    backdropEl = document.createElement("div");
    backdropEl.className = "sheet-backdrop";
    backdropEl.addEventListener("click", closeSheet);
    document.body.appendChild(backdropEl);
    sheetEl = document.createElement("aside");
    sheetEl.className = "sheet";
    // Drag-to-dismiss. Listeners live on the sheet itself (not its children,
    // which render() recreates) and die with the element on close, so there's
    // nothing to detach. touchmove is non-passive so we can preventDefault and
    // own the gesture instead of the page scrolling underneath.
    sheetEl.addEventListener("touchstart", onDragStart, { passive: true });
    sheetEl.addEventListener("touchmove", onDragMove, { passive: false });
    sheetEl.addEventListener("touchend", onDragEnd);
    sheetEl.addEventListener("touchcancel", onDragEnd);
    document.body.appendChild(sheetEl);
  }
  render();
  // Trigger the slide-up after the element is in the DOM so the transition
  // sees the from-state and animates instead of snapping.
  requestAnimationFrame(() => {
    sheetEl.classList.add("is-open");
    backdropEl.classList.add("is-open");
  });
}

export function closeSheet() {
  if (!sheetEl) return;
  drag = null;
  // Restore the CSS transition + clear any inline drag offset so removing
  // .is-open animates the slide-down from wherever the finger left it.
  sheetEl.style.transition = "";
  sheetEl.style.transform = "";
  sheetEl.classList.remove("is-open");
  backdropEl.classList.remove("is-open");
  context = null;
  // Defer DOM removal so the slide-down animation can play (a touch longer
  // than the CSS duration to cover the spring easing's overshoot tail).
  setTimeout(() => {
    sheetEl?.remove();
    backdropEl?.remove();
    sheetEl = null;
    backdropEl = null;
  }, 320);
}

// --- Drag-to-dismiss ------------------------------------------------------

function onDragStart(e) {
  if (!sheetEl) return;
  // Only the non-scrolling header zone initiates a drag — the grabber and the
  // photo/title row. The sliders, segmented control, scroll body, and Order
  // button keep their own touch behavior untouched.
  if (!e.target.closest(".sheet__grabber, .sheet__header")) return;
  const t = e.touches[0];
  drag = { startY: t.clientY, lastY: t.clientY, lastT: e.timeStamp, dy: 0, vy: 0 };
  sheetEl.style.transition = "none"; // follow the finger 1:1
}

function onDragMove(e) {
  if (!drag) return;
  const t = e.touches[0];
  drag.dy = t.clientY - drag.startY;
  const dt = e.timeStamp - drag.lastT || 1;
  drag.vy = (t.clientY - drag.lastY) / dt;
  drag.lastY = t.clientY;
  drag.lastT = e.timeStamp;
  // Downward drag tracks the finger; upward drag past the open position gets
  // heavy rubber-band resistance so the sheet feels anchored, not draggable up.
  const offset = drag.dy < 0 ? drag.dy * 0.2 : drag.dy;
  sheetEl.style.transform = `translateY(${offset}px)`;
  e.preventDefault();
}

function onDragEnd() {
  if (!drag) return;
  const { dy, vy } = drag;
  drag = null;
  if (dy > DISMISS_DISTANCE || vy > DISMISS_VELOCITY) {
    // closeSheet clears the inline transition, so the slide-down uses the CSS
    // ease-out (no overshoot).
    closeSheet();
  } else {
    // Snap back to open with a springy overshoot — the elastic feel stays on
    // the gesture even though the initial slide-in is a plain ease-out.
    sheetEl.style.transition = "transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)";
    sheetEl.style.transform = "";
  }
}

// Called by the host when inventory or queue state changes — the order button
// label and pourability hint need to reflect the new world without forcing the
// guest to close and re-open.
export function refreshSheet({ isPourable, isQueueFull }) {
  if (!context) return;
  context.isPourable = isPourable;
  context.isQueueFull = isQueueFull;
  render();
}

// One row in the sheet's ingredient list for an item the guest adds by hand
// (top-up or garnish). Same two-column shape as the machine-poured rows; the
// --byhand modifier mutes it so it reads as secondary.
function byHandRow(name, detail) {
  const row = document.createElement("div");
  row.className = "sheet__ingredient sheet__ingredient--byhand";
  const n = document.createElement("span");
  n.className = "sheet__ingredient-name";
  n.textContent = name;
  const v = document.createElement("span");
  v.className = "sheet__ingredient-vol";
  v.textContent = detail;
  row.append(n, v);
  return row;
}

function render() {
  if (!context || !sheetEl) return;
  const drink = getDrinkById(context.drinkId);
  if (!drink) return;

  sheetEl.innerHTML = "";
  const adjusted = adjustedIngredients(drink, context.strength, context.amount);

  // Tappable to dismiss — the grabber is a visual affordance from
  // iOS/Android bottom sheets that suggests "pull down to close". Wiring
  // a tap matches users' expectations without needing full drag-to-dismiss,
  // and stays consistent with the bottom queue tray's grabber.
  const grab = document.createElement("button");
  grab.type = "button";
  grab.className = "sheet__grabber";
  grab.setAttribute("aria-label", "Close");
  grab.addEventListener("click", closeSheet);
  sheetEl.appendChild(grab);

  const head = document.createElement("div");
  head.className = "sheet__header";
  // Drink photo (or SVG glass fallback) to the left of the title. Uses the
  // same glass() component the kiosk does so a drink with a photo shows the
  // photo and one without falls back to the colored glass illustration.
  const visual = document.createElement("div");
  visual.className = "sheet__visual";
  visual.appendChild(glass(drink, { width: 84 }));
  head.appendChild(visual);
  const headText = document.createElement("div");
  headText.className = "sheet__header-text";
  const title = document.createElement("h2");
  title.className = "sheet__title";
  title.textContent = drink.name;
  headText.appendChild(title);
  if (drink.tagline) {
    const tag = document.createElement("p");
    tag.className = "sheet__tagline";
    tag.textContent = drink.tagline;
    headText.appendChild(tag);
  }
  // ABV under the tagline. Computed from the served drink (adjusted for
  // strength + amount, including any by-hand top-up) so it tracks the sliders.
  const abvIngredients = drink.topUp
    ? [
        ...adjusted,
        { name: drink.topUp.name, volumeOz: drink.topUp.volumeOz * context.amount },
      ]
    : adjusted;
  const abvWrap = document.createElement("div");
  abvWrap.className = "sheet__abv";
  abvWrap.appendChild(abvReadout(abvIngredients));
  headText.appendChild(abvWrap);
  head.appendChild(headText);
  sheetEl.appendChild(head);

  const ings = document.createElement("div");
  ings.className = "sheet__ingredients";
  for (const i of adjusted) {
    const row = document.createElement("div");
    row.className = "sheet__ingredient";
    const n = document.createElement("span");
    n.className = "sheet__ingredient-name";
    n.textContent = ingredientName(i.name);
    const v = document.createElement("span");
    v.className = "sheet__ingredient-vol";
    v.textContent = `${i.volumeOz.toFixed(1)} oz`;
    row.append(n, v);
    ings.appendChild(row);
  }

  // Garnish + top-up are finished by the guest after the machine pours — the
  // machine has no slot for either. List them under the machine-poured rows
  // with a muted "by hand" treatment so the menu sets the expectation up front;
  // the guest gets the same reminder again in the queue tray when they're up at
  // the bartender (there's no pour/complete screen on the phone to carry it).
  if (drink.topUp || drink.garnish) {
    const byHandLabel = document.createElement("div");
    byHandLabel.className = "sheet__byhand-label";
    byHandLabel.textContent = "Add by hand";
    ings.appendChild(byHandLabel);
  }
  if (drink.topUp) {
    // Top-up scales with the amount slider (a 2× pour tops a bigger glass), the
    // same way the kiosk detail screen renders it.
    const topUpOz = drink.topUp.volumeOz * context.amount;
    ings.appendChild(
      byHandRow(formatIngredient(drink.topUp.name), `${topUpOz.toFixed(1)} oz`)
    );
  }
  if (drink.garnish) {
    ings.appendChild(byHandRow(formatGarnishList(drink.garnish), "garnish"));
  }
  sheetEl.appendChild(ings);

  // Amount slider — same 0.5×–2.0× range as the kiosk detail screen. The
  // server reads order.amount and scales the pour accordingly; the ingredient
  // list above re-renders on input so the guest sees the new volumes live.
  const amountBlock = document.createElement("div");
  amountBlock.className = "sheet__amount";
  const aLabelRow = document.createElement("div");
  aLabelRow.className = "sheet__amount-row";
  const aLabel = document.createElement("p");
  aLabel.className = "sheet__label";
  aLabel.textContent = "Amount";
  const aValue = document.createElement("span");
  aValue.className = "sheet__amount-value";
  aValue.textContent = `${context.amount.toFixed(1)}x`;
  aLabelRow.append(aLabel, aValue);
  amountBlock.appendChild(aLabelRow);
  const aSlider = document.createElement("input");
  aSlider.type = "range";
  aSlider.min = "0.5";
  aSlider.max = "2.0";
  aSlider.step = "0.1";
  aSlider.value = String(context.amount);
  aSlider.className = "sheet__slider";
  aSlider.setAttribute("aria-label", "Amount");
  // `input` updates the readout live for dragging feel; `change` is when we
  // commit + re-render the ingredient volumes (cheaper than re-rendering on
  // every input tick).
  aSlider.addEventListener("input", (e) => {
    aValue.textContent = `${Number(e.target.value).toFixed(1)}x`;
  });
  aSlider.addEventListener("change", (e) => {
    context.amount = Number(e.target.value);
    render();
  });
  amountBlock.appendChild(aSlider);
  sheetEl.appendChild(amountBlock);

  const strengthBlock = document.createElement("div");
  strengthBlock.className = "sheet__strength";
  const sLabel = document.createElement("p");
  sLabel.className = "sheet__label";
  sLabel.textContent = "Strength";
  strengthBlock.appendChild(sLabel);
  const seg = document.createElement("div");
  seg.className = "sheet__segmented";
  for (const s of ["light", "regular", "strong"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.charAt(0).toUpperCase() + s.slice(1);
    if (s === context.strength) b.classList.add("is-active");
    b.addEventListener("click", () => {
      context.strength = s;
      render();
    });
    seg.appendChild(b);
  }
  strengthBlock.appendChild(seg);
  sheetEl.appendChild(strengthBlock);

  const order = document.createElement("button");
  order.className = "sheet__order";
  order.type = "button";
  if (!context.isPourable) {
    order.textContent = "Unavailable";
    order.setAttribute("disabled", "");
  } else if (context.isQueueFull) {
    order.textContent = "Queue full";
    order.setAttribute("disabled", "");
  } else {
    order.textContent = "Order this drink";
    order.addEventListener("click", () => {
      const cb = context.onOrder;
      const out = {
        drinkId: drink.id,
        strength: context.strength,
        amount: context.amount,
      };
      closeSheet();
      cb?.(drink, out);
    });
  }
  sheetEl.appendChild(order);

  if (!context.isPourable) {
    const missing = document.createElement("div");
    missing.className = "sheet__missing";
    const ids = missingIngredients(drink);
    missing.textContent = ids.length
      ? `Missing: ${ids.map(ingredientName).join(", ").toLowerCase()}`
      : "Not available right now.";
    sheetEl.appendChild(missing);
  }
}
