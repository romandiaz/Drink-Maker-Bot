// Composed activity-over-time block used by both stats pages: a stacked bar
// chart, a colour-key legend, and a drill-down panel that updates when the
// user taps a bar. Selection state lives in here so the host screen only
// supplies how to derive bars / legend / per-day breakdown — taps mutate the
// state and the closure re-renders the two affected hosts.

import { createBarChart } from "./bar-chart.js";
import { createLegend, createBreakdownPanel } from "./chart-extras.js";

export function createActivityChart({
  title,
  note,
  axisLeft,
  axisRight,
  bars,
  legend,
  defaultIndex = -1,
  buildBreakdown,
}) {
  const wrap = document.createElement("div");
  wrap.className = "dstat-activity";

  const card = document.createElement("div");
  card.className = "dstat-chart";

  const head = document.createElement("div");
  head.className = "dstat-chart__head";
  const titleEl = document.createElement("span");
  titleEl.className = "dstat-chart__title";
  titleEl.textContent = title;
  const actions = document.createElement("div");
  actions.className = "dstat-chart__head-actions";
  const noteEl = document.createElement("span");
  noteEl.className = "dstat-chart__note";
  noteEl.textContent = note;
  // Toggle for the breakdown panel below the chart. Label flips between
  // "Hide" / "Show" so the action is self-describing on the touchscreen.
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "dstat-toggle tappable";
  toggleBtn.addEventListener("click", () => {
    collapsed = !collapsed;
    render();
  });
  actions.append(noteEl, toggleBtn);
  head.append(titleEl, actions);
  card.appendChild(head);

  const chartHost = document.createElement("div");
  card.appendChild(chartHost);

  const axis = document.createElement("div");
  axis.className = "dstat-chart__axis";
  const left = document.createElement("span");
  left.textContent = axisLeft;
  const right = document.createElement("span");
  right.textContent = axisRight;
  axis.append(left, right);
  card.appendChild(axis);

  if (legend && legend.length > 0) card.appendChild(createLegend(legend));

  wrap.appendChild(card);

  const breakdownHost = document.createElement("div");
  wrap.appendChild(breakdownHost);

  let selectedIdx = defaultIndex;
  let collapsed = true;

  function render() {
    chartHost.innerHTML = "";
    chartHost.appendChild(
      createBarChart({
        bars: bars.map((b, i) => ({ ...b, selected: i === selectedIdx })),
        height: 50,
        onSelect: (i) => {
          selectedIdx = i;
          render();
        },
      }),
    );
    toggleBtn.textContent = collapsed ? "Show" : "Hide";
    toggleBtn.setAttribute(
      "aria-label",
      collapsed ? "Show breakdown" : "Hide breakdown",
    );
    breakdownHost.style.display = collapsed ? "none" : "";
    // Skip rebuilding the breakdown DOM while hidden — it'll be rebuilt the
    // next time the user reveals the panel, picking up any selection change
    // they made while collapsed.
    if (!collapsed) {
      breakdownHost.innerHTML = "";
      breakdownHost.appendChild(createBreakdownPanel(buildBreakdown(selectedIdx)));
    }
  }

  render();
  return wrap;
}
