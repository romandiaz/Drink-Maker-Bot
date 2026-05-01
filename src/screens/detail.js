import { navigate } from "../app.js";
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
import { isPrimaryLoaded, missingIngredients } from "../inventory-store.js";
import { ingredientName } from "../ingredients.js";
import {
  formatByHand,
  formatGarnishList,
  formatIngredient,
  formatTopUpList,
  joinList,
} from "../format.js";

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
        onBack: () => navigate("drinkList", { categoryId: drink.category }, "pop"),
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
    const missing = missingIngredients(drink);
    const missingSet = new Set(missing);

    adjusted.forEach((ing, index) => {
      const isMissing = missingSet.has(ing.name);
      ingredientsList.appendChild(
        ingredientLine(
          `${ing.volumeOz} oz ${formatIngredient(ing.name)}`,
          // Missing ingredients get the outline-dot treatment so they read the
          // same as the existing garnish/topUp lines below — anything outlined
          // is "you'll add this", not "machine pours this".
          isMissing
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
      ingredientsList.appendChild(
        ingredientLine(formatTopUpList(drink.topUp), { outline: true })
      );
    }

    ingredientsWrap.appendChild(ingredientsList);
    ingredientsWrap.appendChild(createDonutChart(adjusted));
    right.appendChild(ingredientsWrap);

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

    if (missing.length === 0) {
      const seconds = estimatePourSeconds(drink, order.strength, order.amount);
      right.appendChild(
        pourButton({
          accent: cat.accent,
          label: `Pour · Ready in ~${seconds}s`,
          onClick: (e) => {
            e.currentTarget.disabled = true;
            // Clear any stale by-hand list from a prior manual pour of this
            // drink — otherwise the complete screen would tell the user to
            // add ingredients we just dispensed.
            setPendingOrder({ ...order, missingByHand: null });
            navigate("pouring", { drinkId: drink.id });
          },
        })
      );
    } else if (isPrimaryLoaded(drink)) {
      // Primary is loaded — user can complete the recipe by hand. Snapshot
      // the by-hand list with strength/amount-adjusted volumes onto the
      // pending order so the pouring + complete screens get the right amounts.
      const byHand = adjusted.filter((ing) => missingSet.has(ing.name));
      const banner = document.createElement("div");
      banner.className = "detail-missing-banner detail-missing-banner--byhand";
      banner.textContent = `Add by hand after pour: ${joinList(byHand.map(formatByHand))}`;
      right.appendChild(banner);

      // The machine-pour time is shorter than the recipe's full time because
      // missing volume isn't pumped — recompute so the label is honest.
      const pouredVolume = adjusted
        .filter((ing) => !missingSet.has(ing.name))
        .reduce((s, i) => s + i.volumeOz, 0);
      const seconds = Math.round(15 + pouredVolume * 4.0);
      right.appendChild(
        pourButton({
          accent: cat.accent,
          label: `Pour · Ready in ~${seconds}s`,
          onClick: (e) => {
            e.currentTarget.disabled = true;
            setPendingOrder({ ...order, missingByHand: byHand });
            navigate("pouring", { drinkId: drink.id });
          },
        })
      );
    } else {
      const banner = document.createElement("div");
      banner.className = "detail-missing-banner";
      banner.textContent = `Missing: ${missing.map(ingredientName).join(", ")}`;
      right.appendChild(banner);

      const disabled = document.createElement("button");
      disabled.type = "button";
      disabled.className = "pour-btn pour-btn--disabled";
      disabled.disabled = true;
      disabled.style.setProperty("--accent", cat.accent);
      disabled.textContent = "Load missing ingredients to pour";
      right.appendChild(disabled);
    }

    main.appendChild(right);
    element.appendChild(main);
  }

  render();
  return { element, mount() {}, unmount() {} };
}
