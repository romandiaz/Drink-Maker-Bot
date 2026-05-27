import { createActivityChart } from "../components/activity-chart.js";
import { shortDate } from "../components/stat-tile.js";
import { drinks, categories } from "../drinks.js";

// 14-day stacked activity chart for the Top Drinks page. Aggregates each
// day's pours into the standard category accents — drinks not in the catalog
// (shots / custom / unknown) fall into "Other" with the muted token. Stable
// category order across bars keeps the visual reading easy. Selection state
// is owned by createActivityChart; this builder just wires bars / legend /
// per-day breakdown into it.

const CAT_OTHER = { id: "other", accent: "var(--text-quaternary)", name: "Other" };

export function buildDrinkActivityChart(daily, nameByKey) {
  const allCats = [...categories, CAT_OTHER];
  const colorOf = Object.fromEntries(allCats.map((c) => [c.id, c.accent]));
  const drinkCat = (key) => drinks.find((d) => d.id === key)?.category || "other";

  // Legend lists only the categories that actually contributed in the window
  // — clutter avoidance for slow weeks.
  const seen = new Set();
  for (const d of daily) for (const key of Object.keys(d.byDrink)) seen.add(drinkCat(key));
  const legend = allCats
    .filter((c) => seen.has(c.id))
    .map((c) => ({ color: c.accent, label: c.name }));

  const bars = daily.map((day) => {
    const byCat = new Map();
    for (const [key, count] of Object.entries(day.byDrink)) {
      const cat = drinkCat(key);
      byCat.set(cat, (byCat.get(cat) || 0) + count);
    }
    const segments = allCats
      .map((c) => ({ value: byCat.get(c.id) || 0, color: c.accent }))
      .filter((s) => s.value > 0);
    return { segments };
  });

  // Default selection: latest day with any pours, so the breakdown panel is
  // informative on first view rather than nagging the user to tap a bar.
  let defaultIndex = -1;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].count > 0) {
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
    if (day.count === 0) {
      return { date, summary: "0 pours", lines: [], hint: "Nothing poured this day." };
    }
    const sorted = Object.entries(day.byDrink).sort((a, b) => b[1] - a[1]);
    const MAX = 5;
    const lines = sorted.slice(0, MAX).map(([key, count]) => ({
      color: colorOf[drinkCat(key)],
      name: nameByKey.get(key) || key,
      value: String(count),
    }));
    const restCount = sorted.slice(MAX).reduce((s, [, c]) => s + c, 0);
    if (restCount > 0) {
      lines.push({
        color: "transparent",
        name: `+ ${sorted.length - MAX} more`,
        value: String(restCount),
      });
    }
    return {
      date,
      summary: `${day.count} pour${day.count === 1 ? "" : "s"}`,
      lines,
    };
  }

  const windowTotal = daily.reduce((s, d) => s + d.count, 0);
  return createActivityChart({
    title: `Last ${daily.length} days`,
    note: `${windowTotal} pour${windowTotal === 1 ? "" : "s"}`,
    axisLeft: shortDate(daily[0].dayStartMs),
    axisRight: "Today",
    bars,
    legend,
    defaultIndex,
    buildBreakdown,
  });
}
