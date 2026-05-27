import { createActivityChart } from "../components/activity-chart.js";
import { shortDate } from "../components/stat-tile.js";
import { ingredientName } from "../ingredients.js";

// 14-day stacked activity chart for the Top Ingredients page. Picks the
// top-N ingredients across the window (by total oz) so their swatch colour is
// stable across every bar, and lumps the rest into a muted "Other" segment.
// `color(i)` comes from the host screen so the chart palette stays the single
// source of truth — same ordering as the leaderboard rows below the chart.

const OTHER_COLOR = "var(--text-quaternary)";
const TOP_N = 5;
const ozLabel = (oz) => `${oz.toFixed(1)} oz`;

export function buildIngredientActivityChart(daily, color) {
  const totalsByIng = new Map();
  for (const day of daily) {
    for (const [name, oz] of Object.entries(day.byIng)) {
      totalsByIng.set(name, (totalsByIng.get(name) || 0) + oz);
    }
  }
  const ranked = [...totalsByIng.entries()].sort((a, b) => b[1] - a[1]);
  const topIngs = ranked.slice(0, TOP_N).map(([name], i) => ({ name, color: color(i) }));
  const topIdx = new Map(topIngs.map((t, i) => [t.name, i]));
  const hasOther = ranked.length > TOP_N;

  const legend = topIngs.map((t) => ({ color: t.color, label: ingredientName(t.name) }));
  if (hasOther) legend.push({ color: OTHER_COLOR, label: "Other" });

  const bars = daily.map((day) => {
    const segs = topIngs.map((t) => ({ value: day.byIng[t.name] || 0, color: t.color }));
    let otherOz = 0;
    for (const [name, oz] of Object.entries(day.byIng)) {
      if (!topIdx.has(name)) otherOz += oz;
    }
    if (otherOz > 0) segs.push({ value: otherOz, color: OTHER_COLOR });
    return { segments: segs.filter((s) => s.value > 0) };
  });

  let defaultIndex = -1;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].oz > 0) {
      defaultIndex = i;
      break;
    }
  }

  function buildBreakdown(idx) {
    if (idx < 0 || idx >= daily.length) {
      return { lines: [], hint: "Tap a bar to see what was poured." };
    }
    const day = daily[idx];
    const date = new Date(day.dayStartMs).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (day.oz === 0) {
      return { date, summary: "0 oz", lines: [], hint: "Nothing poured this day." };
    }
    const sorted = Object.entries(day.byIng).sort((a, b) => b[1] - a[1]);
    const MAX = 5;
    const lines = sorted.slice(0, MAX).map(([name, oz]) => ({
      color: topIdx.has(name) ? topIngs[topIdx.get(name)].color : OTHER_COLOR,
      name: ingredientName(name),
      value: ozLabel(oz),
    }));
    const restOz = sorted.slice(MAX).reduce((s, [, oz]) => s + oz, 0);
    if (restOz > 0) {
      lines.push({
        color: "transparent",
        name: `+ ${sorted.length - MAX} more`,
        value: ozLabel(restOz),
      });
    }
    return { date, summary: ozLabel(day.oz), lines };
  }

  const windowOz = daily.reduce((s, d) => s + d.oz, 0);
  return createActivityChart({
    title: `Last ${daily.length} days`,
    note: `${Math.round(windowOz)} oz`,
    axisLeft: shortDate(daily[0].dayStartMs),
    axisRight: "Today",
    bars,
    legend,
    defaultIndex,
    buildBreakdown,
  });
}
