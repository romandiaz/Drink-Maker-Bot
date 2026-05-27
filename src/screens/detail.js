import { navigate, resetStack } from "../app.js";
import {
  adjustedIngredients,
  drinks,
  estimatePourSeconds,
  getCategoryById,
  getDrinkById,
  totalVolumeOz,
} from "../drinks.js";
import { header } from "../components/header.js";
import { glass } from "../components/glass.js";
import { segmented } from "../components/editor-fields.js";
import { appState, setPendingOrder, setSelectedDrink } from "../state.js";
import { loadInventory, recipeShortfalls } from "../inventory-store.js";
import {
  defaultFlowOzPerSec,
  flowRateForIngredient,
} from "../calibration-store.js";
import { ingredientName } from "../ingredients.js";
import { abvReadout } from "../components/abv-readout.js";
import {
  formatByHand,
  formatDuration,
  formatGarnishList,
  formatIngredient,
  joinList,
} from "../format.js";
import { onMachineStatus } from "../machine-status.js";
import {
  addToQueue,
  onQueueChange,
  isQueueFull,
  canPourNow,
  queueToasts,
} from "../queue-store.js";
import { showQueueToast } from "../components/toast.js";

// Donut colors: the first four match the category accents so a drink's primary
// ingredient reads in the category color; the rest are neutral fillers for
// recipes with more than 4 ingredients.
const DONUT_COLORS = [
  "var(--accent-classics)",
  "var(--accent-refreshers)",
  "var(--accent-sours)",
  "var(--accent-party)",
  "#a78bfa",
  "#38bdf8",
];

function createDonutChart(ingredients) {
  const wrap = document.createElement("div");
  wrap.className = "donut";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("class", "donut__svg");
  svg.setAttribute("aria-hidden", "true");

  const total = totalVolumeOz(ingredients);
  let accumulated = 0;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;

  ingredients.forEach((i, index) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", radius);
    circle.setAttribute("cx", "20");
    circle.setAttribute("cy", "20");
    circle.setAttribute("fill", "transparent");
    circle.setAttribute("stroke", DONUT_COLORS[index % DONUT_COLORS.length]);
    circle.setAttribute("stroke-width", "6");
    circle.classList.add("donut__slice");

    const portion = i.volumeOz / total;
    const strokeLength = portion * circumference;
    const gap = ingredients.length > 1 ? 1.5 : 0;

    circle.setAttribute("stroke-dasharray", `${Math.max(0, strokeLength - gap)} ${circumference}`);
    circle.setAttribute("stroke-dashoffset", `-${accumulated}`);

    accumulated += strokeLength;
    svg.appendChild(circle);
  });

  wrap.appendChild(svg);

  const center = document.createElement("div");
  center.className = "donut__center";
  const totalEl = document.createElement("div");
  totalEl.className = "donut__total";
  totalEl.textContent = total.toFixed(1);
  const unitEl = document.createElement("div");
  unitEl.className = "donut__unit";
  unitEl.textContent = "oz total";
  center.append(totalEl, unitEl);
  wrap.appendChild(center);

  return wrap;
}

function initialOrder(drink) {
  if (appState.pendingOrder?.drinkId === drink.id) return { ...appState.pendingOrder };
  return { drinkId: drink.id, strength: "regular", amount: 1.0 };
}

function controlGroup(label, contentEl, { valueEl } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "control-group";

  const head = document.createElement("div");
  head.className = "control-group__head";
  const lbl = document.createElement("div");
  lbl.className = "control-group__label";
  lbl.textContent = label;
  head.appendChild(lbl);
  if (valueEl) head.appendChild(valueEl);
  wrap.appendChild(head);

  wrap.appendChild(contentEl);
  return wrap;
}

function sliderControl({ label, min, max, step, value, accent, onChange, formatValue }) {
  const valEl = document.createElement("div");
  valEl.className = "control-group__value";
  valEl.textContent = formatValue ? formatValue(value) : value;

  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.className = "accent-slider";
  input.setAttribute("aria-label", label);
  if (accent) input.style.setProperty("--accent", accent);

  input.addEventListener("input", (e) => {
    const v = Number(e.target.value);
    valEl.textContent = formatValue ? formatValue(v) : v;
  });

  input.addEventListener("change", (e) => {
    onChange(Number(e.target.value));
  });

  return controlGroup(label, input, { valueEl: valEl });
}

function pourButton({ accent, label, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pour-btn tappable";
  btn.style.setProperty("--accent", accent);
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function disabledPourButton({ accent, label }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pour-btn pour-btn--disabled";
  btn.disabled = true;
  btn.style.setProperty("--accent", accent);
  btn.textContent = label;
  return btn;
}

// The confirm-pour button. When the machine is free it pours immediately
// ("Pour" → the pouring screen); when it's busy or a queue exists the SAME
// button adds the drink to the shared queue instead of being disabled — that
// is the whole point of the queue. The server decides which actually happens
// (it owns the machine); the label is just a hint from current state.
function pourActionButton({ accent, pourLabel, order }) {
  if (isQueueFull()) {
    return disabledPourButton({ accent, label: "Queue full — try shortly" });
  }
  return pourButton({
    accent,
    label: canPourNow() ? pourLabel : "Add to queue",
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const res = await addToQueue(order);
      if (res.rejected) {
        showQueueToast(queueToasts.full());
        btn.disabled = false;
      } else if (res.pouringNow) {
        navigate("pouring", { order });
      } else {
        // Added behind a busy machine — land on the queue screen so the
        // guest sees their drink in line and can manage the queue.
        showQueueToast(queueToasts.added(res.position));
        resetStack("idle", "queue");
      }
    },
  });
}

function ingredientLine(text, { accent, outline = false } = {}) {
  const line = document.createElement("div");
  line.className = "detail-ing-line";

  const dot = document.createElement("div");
  dot.className = "detail-ing-dot";
  if (outline) {
    dot.classList.add("detail-ing-dot--outline");
  } else if (accent) {
    dot.style.backgroundColor = accent;
  }

  const label = document.createElement("span");
  label.className = "detail-ing-text";
  label.textContent = text;

  line.appendChild(dot);
  line.appendChild(label);
  return line;
}

export function detail(props = {}) {
  const drinkId = props.drinkId || appState.selectedDrink || drinks[0].id;
  const drink = getDrinkById(drinkId);
  const cat = getCategoryById(drink.category);
  setSelectedDrink(drink.id);

  const order = initialOrder(drink);
  setPendingOrder(order);

  const element = document.createElement("section");
  element.className = "screen";
  element.dataset.screen = "detail";

  function update(patch) {
    Object.assign(order, patch);
    setPendingOrder(order);
    render();
  }

  function render() {
    element.innerHTML = "";

    element.appendChild(
      header({
        title: "Confirm pour",
        search: true,
        onSearch: () => navigate("search"),
        right: "ready",
      })
    );

    const main = document.createElement("div");
    main.className = "detail-main";

    const left = document.createElement("div");
    left.className = "detail-left";

    const name = document.createElement("h2");
    name.className = "detail-name";
    name.textContent = drink.name;
    left.appendChild(name);

    if (drink.tagline) {
      const tagline = document.createElement("p");
      tagline.className = "detail-tagline";
      tagline.textContent = drink.tagline;
      left.appendChild(tagline);
    }

    left.appendChild(glass(drink, { width: 220 }));
    main.appendChild(left);

    const right = document.createElement("div");
    right.className = "detail-right";

    const ingredientsWrap = document.createElement("div");
    ingredientsWrap.className = "ingredients-wrap";

    const ingredientsList = document.createElement("div");
    ingredientsList.className = "detail-ingredients-list";

    const adjusted = adjustedIngredients(drink, order.strength, order.amount);
    // Long recipes (Long Island, etc.) push the pour button below the fold
    // when the list is single-column. Switch to 2-col once the list would
    // exceed the donut's vertical footprint.
    const totalListItems =
      adjusted.length + (drink.garnish ? 1 : 0) + (drink.topUp ? 1 : 0);
    if (totalListItems > 6) {
      ingredientsList.classList.add("detail-ingredients-list--two-col");
    }
    // Shortfalls compare *adjusted* volumes against current stock, so a "strong"
    // pour that would empty the bottle gets caught alongside a slot the admin
    // never loaded. Both flow into the same by-hand path below.
    const shortfalls = recipeShortfalls(adjusted);
    const shortfallByName = new Map(shortfalls.map((s) => [s.name, s]));
    const primaryName = drink.ingredients[0]?.name;
    const primaryShort = primaryName ? shortfallByName.get(primaryName) : null;

    adjusted.forEach((ing, index) => {
      const isShort = shortfallByName.has(ing.name);
      ingredientsList.appendChild(
        ingredientLine(
          `${ing.volumeOz} oz ${formatIngredient(ing.name)}`,
          // Shortfall ingredients get the outline-dot treatment so they read
          // the same as the existing garnish/topUp lines below — anything
          // outlined is "you'll add this", not "machine pours this".
          isShort
            ? { outline: true }
            : { accent: DONUT_COLORS[index % DONUT_COLORS.length] }
        )
      );
    });

    if (drink.garnish) {
      ingredientsList.appendChild(
        ingredientLine(formatGarnishList(drink.garnish), { outline: true })
      );
    }
    if (drink.topUp) {
      // Top-up is finished by hand; show its (amount-scaled) volume so it
      // reads consistently with the machine-poured lines above.
      const topUpOz = Number((drink.topUp.volumeOz * order.amount).toFixed(1));
      ingredientsList.appendChild(
        ingredientLine(
          `${topUpOz} oz ${formatIngredient(drink.topUp.name)}`,
          { outline: true }
        )
      );
    }

    ingredientsWrap.appendChild(ingredientsList);
    // Donut + center total reflect what the machine actually pours. Shortfall
    // ingredients are listed above with outline dots (and surfaced again as the
    // by-hand banner below), so excluding them here keeps the "X oz total"
    // honest — otherwise it'd promise volume the pumps aren't going to deliver.
    const machinePoured = adjusted.filter((i) => !shortfallByName.has(i.name));
    ingredientsWrap.appendChild(createDonutChart(machinePoured));
    right.appendChild(ingredientsWrap);

    // ABV estimate covers the whole drink as served — the machine pour plus
    // the by-hand top-up. The top-up tracks the amount slider (a 2× pour fills
    // a bigger glass) but not strength.
    const abvIngredients = drink.topUp
      ? [
          ...adjusted,
          { name: drink.topUp.name, volumeOz: drink.topUp.volumeOz * order.amount },
        ]
      : adjusted;
    right.appendChild(abvReadout(abvIngredients));

    right.appendChild(
      sliderControl({
        label: "Amount",
        min: 0.5,
        max: 2.0,
        step: 0.1,
        value: order.amount ?? 1.0,
        accent: cat.accent,
        formatValue: (v) => `${v.toFixed(1)}x`,
        onChange: (v) => update({ amount: v }),
      })
    );

    right.appendChild(
      controlGroup(
        "Strength",
        segmented({
          options: ["light", "regular", "strong"],
          value: order.strength,
          labelOf: (v) => v[0].toUpperCase() + v.slice(1),
          onChange: (v) => update({ strength: v }),
        })
      )
    );

    if (shortfalls.length === 0) {
      const seconds = estimatePourSeconds(drink, order.strength, order.amount, {
        flowRateForIngredient,
        defaultFlowOzPerSec: defaultFlowOzPerSec(),
      });
      // missingByHand cleared so the complete screen doesn't tell the user to
      // add ingredients the machine just dispensed.
      right.appendChild(
        pourActionButton({
          accent: cat.accent,
          pourLabel: `Pour · Ready in ~${formatDuration(seconds)}`,
          order: { ...order, missingByHand: null },
        })
      );
    } else if (!primaryShort) {
      // Primary is available — user can complete the recipe by hand. Snapshot
      // the by-hand list with strength/amount-adjusted volumes onto the
      // order so the pouring + complete screens get the right amounts.
      const byHand = adjusted.filter((ing) => shortfallByName.has(ing.name));
      const banner = document.createElement("div");
      banner.className = "detail-missing-banner detail-missing-banner--byhand";
      banner.textContent = `Add by hand after pour: ${joinList(byHand.map(formatByHand))}`;
      right.appendChild(banner);

      // The machine-pour time is shorter than the recipe's full time because
      // shortfall volume isn't pumped — recompute so the label is honest.
      const pouredVolume = adjusted
        .filter((ing) => !shortfallByName.has(ing.name))
        .reduce((s, i) => s + i.volumeOz, 0);
      const seconds = Math.round(15 + pouredVolume * 4.0);
      right.appendChild(
        pourActionButton({
          accent: cat.accent,
          pourLabel: `Pour · Ready in ~${formatDuration(seconds)}`,
          order: { ...order, missingByHand: byHand },
        })
      );
    } else {
      // Primary itself is short — the recipe is structurally blocked. Distinguish
      // "no slot at all" (admin needs to load a bottle) from "slot empty / low"
      // (admin needs to refill) so the prompt is actionable.
      const reasonLabel = (s) => {
        const name = ingredientName(s.name);
        if (s.reason === "missing") return `${name} (not loaded)`;
        if (s.reason === "empty") return `${name} (out)`;
        return `${name} (low — ${s.remainingOz.toFixed(1)} oz left)`;
      };
      const allMissing = shortfalls.every((s) => s.reason === "missing");
      const banner = document.createElement("div");
      banner.className = "detail-missing-banner";
      banner.textContent = `${allMissing ? "Missing" : "Refill needed"}: ${shortfalls.map(reasonLabel).join(", ")}`;
      right.appendChild(banner);

      const disabled = document.createElement("button");
      disabled.type = "button";
      disabled.className = "pour-btn pour-btn--disabled";
      disabled.disabled = true;
      disabled.style.setProperty("--accent", cat.accent);
      disabled.textContent = allMissing
        ? "Load missing ingredients to pour"
        : "Refill ingredients to pour";
      right.appendChild(disabled);
    }

    main.appendChild(right);
    element.appendChild(main);
  }

  // Snapshot of which ingredients are short, so a no-op refresh doesn't trigger
  // a re-render that would interrupt a slider drag in progress.
  function shortfallSignature() {
    const adjusted = adjustedIngredients(drink, order.strength, order.amount);
    return recipeShortfalls(adjusted)
      .map((s) => `${s.name}:${s.reason}`)
      .sort()
      .join("|");
  }

  // Signature of everything the pour button's label depends on — machine
  // status and the shared queue. Re-render only when it changes so a
  // background broadcast doesn't interrupt a slider drag.
  function pourButtonSignature() {
    return `${canPourNow()}|${isQueueFull()}`;
  }

  render();
  let unsubMachine = null;
  let unsubQueue = null;
  let lastSig = pourButtonSignature();
  function refreshIfChanged() {
    const sig = pourButtonSignature();
    if (sig !== lastSig) {
      lastSig = sig;
      render();
    }
  }
  return {
    element,
    mount() {
      // Arriving via "Another" right after a pour completes means the inventory
      // cache may be one fetch behind the consume() that just ran — refresh and
      // re-render if availability shifted, so a now-empty bottle surfaces as
      // by-hand instead of being silently mispoured.
      const before = shortfallSignature();
      loadInventory().then(() => {
        if (shortfallSignature() !== before) render();
      });
      // Re-render when the machine or the shared queue changes so the pour
      // button tracks "Pour" vs "Add to queue" vs "Queue full" live.
      unsubMachine = onMachineStatus(refreshIfChanged);
      unsubQueue = onQueueChange(refreshIfChanged);
    },
    unmount() {
      if (unsubMachine) {
        unsubMachine();
        unsubMachine = null;
      }
      if (unsubQueue) {
        unsubQueue();
        unsubQueue = null;
      }
    },
  };
}
