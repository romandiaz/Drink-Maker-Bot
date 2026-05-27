import { getJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { header } from "../components/header.js";
import { statTile } from "../components/stat-tile.js";
import { ingredientName } from "../ingredients.js";
import { computeSpend, costPerOz, money } from "../ingredient-cost.js";
import {
  computeIngredientOverview,
  lastUsedByIngredient,
} from "./ingredient-stats-data.js";
import { buildIngredientActivityChart } from "./ingredient-activity-chart.js";

// Top Ingredients detail page, reached by tapping the dashboard's "Top
// ingredients" card. Sibling of the Top Drinks page (admin-drink-stats.js) but
// measured in ounces dispensed: an overview band (headline stats + a 14-day
// volume chart) over the full ingredient leaderboard. Ranking comes from
// /api/stats (topIngredients, sorted by total oz); the overview and last-used
// times are derived from the raw /api/history log.

// Ingredients have no category accent, so swatches cycle this palette by rank
// — same set the dashboard's ingredient card and donut use.
const PALETTE = [
  "var(--accent-classics)",
  "var(--accent-refreshers)",
  "var(--accent-sours)",
  "var(--accent-party)",
  "var(--accent-tiki)",
  "var(--accent-shots)",
  "#a78bfa",
  "#38bdf8",
  "#f472b6",
  "#facc15",
  "#34d399",
  "#fb923c",
];

const color = (i) => PALETTE[i % PALETTE.length];

function relativeTime(ts) {
  if (!Number.isFinite(ts)) return "never";
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function overviewSection(ov, top, spend) {
  const section = document.createElement("section");
  section.className = "dstat-overview";

  const grid = document.createElement("div");
  grid.className = "dstat-grid";
  grid.appendChild(
    statTile(
      `${Math.round(ov.volumeOz)} oz`,
      "Total poured",
      `≈ ${(ov.volumeOz / 33.814).toFixed(1)} L`,
    ),
  );
  grid.appendChild(statTile(String(ov.distinctIngredients), "Ingredients used"));
  grid.appendChild(
    top
      ? statTile(ingredientName(top.name), "Most poured", `${top.totalOz} oz`)
      : statTile("—", "Most poured"),
  );
  // Spend tile when any ingredient is priced; otherwise show avg pour volume.
  grid.appendChild(
    spend.totalSpent > 0
      ? statTile(
          money(spend.totalSpent),
          "Total spent",
          ov.pours > 0 ? `${money(spend.totalSpent / ov.pours)} avg/drink` : undefined,
        )
      : statTile(`${ov.avgPerPour.toFixed(1)} oz`, "Avg per pour"),
  );
  grid.appendChild(statTile(`${Math.round(ov.weekOz)} oz`, "This week"));
  grid.appendChild(
    ov.busiestDay
      ? statTile(
          ov.busiestDay.name,
          "Busiest day",
          `${Math.round(ov.busiestDay.oz)} oz`,
        )
      : statTile("—", "Busiest day"),
  );
  section.appendChild(grid);

  if (spend.totalSpent > 0 && spend.pricedCount < spend.pouredCount) {
    const costNote = document.createElement("div");
    costNote.className = "dstat-note";
    costNote.textContent = `Spend based on ${spend.pricedCount} of ${spend.pouredCount} priced ingredients`;
    section.appendChild(costNote);
  }

  return section;
}

function leaderRow(ing, rank, maxOz, totalOz, lastTs) {
  const row = document.createElement("div");
  row.className = "leader-row";

  const rankEl = document.createElement("span");
  rankEl.className = "leader-row__rank";
  rankEl.textContent = String(rank);

  const swatch = document.createElement("span");
  swatch.className = "leader-row__swatch";
  swatch.style.background = color(rank - 1);

  const main = document.createElement("div");
  main.className = "leader-row__main";

  const head = document.createElement("div");
  head.className = "leader-row__head";
  const name = document.createElement("span");
  name.className = "leader-row__name";
  name.textContent = ingredientName(ing.name);
  const value = document.createElement("span");
  value.className = "leader-row__count";
  value.textContent = `${ing.totalOz} oz`;
  head.append(name, value);

  const bar = document.createElement("div");
  bar.className = "leader-row__bar";
  const fill = document.createElement("span");
  fill.className = "leader-row__bar-fill";
  fill.style.width = `${maxOz > 0 ? (ing.totalOz / maxOz) * 100 : 0}%`;
  fill.style.background = color(rank - 1);
  bar.appendChild(fill);

  const meta = document.createElement("div");
  meta.className = "leader-row__meta";
  const share = totalOz > 0 ? Math.round((ing.totalOz / totalOz) * 100) : 0;
  const spent = costPerOz(ing.name) * ing.totalOz;
  const costPart = spent > 0 ? ` · ${money(spent)} spent` : "";
  meta.textContent = `${share}% of volume · ${ing.count} pour${ing.count === 1 ? "" : "s"}${costPart} · last ${relativeTime(lastTs)}`;

  main.append(head, bar, meta);
  row.append(rankEl, swatch, main);
  return row;
}

export function ingredientStats() {
  const element = document.createElement("section");
  element.className = "screen screen--admin";
  element.dataset.screen = "ingredientStats";

  element.appendChild(
    header({
      back: true,
      eyebrow: "Station 01",
      title: "Top Ingredients",
      right: "ready",
    })
  );

  const body = document.createElement("div");
  body.className = "admin-body admin-body--leader";
  element.appendChild(body);

  const footer = document.createElement("footer");
  footer.className = "screen-footer";
  const meta = document.createElement("span");
  meta.className = "screen-footer__meta";
  const hint = document.createElement("span");
  hint.className = "screen-footer__hint";
  hint.textContent = "Ranked by total volume poured";
  footer.append(meta, hint);
  element.appendChild(footer);

  function renderEmpty() {
    body.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No pours yet.";
    const sub = document.createElement("div");
    sub.className = "history-empty__sub";
    sub.textContent = "Ingredient stats will appear here once you start pouring.";
    empty.appendChild(sub);
    body.appendChild(empty);
    meta.textContent = "No pours recorded yet";
  }

  function render(stats, entries) {
    const ranked = stats.topIngredients || [];
    if (ranked.length === 0) {
      renderEmpty();
      return;
    }

    body.innerHTML = "";
    const ov = computeIngredientOverview(entries);
    body.appendChild(overviewSection(ov, ranked[0], computeSpend(entries)));
    body.appendChild(buildIngredientActivityChart(ov.daily, color));

    const sectionHead = document.createElement("div");
    sectionHead.className = "leader-section-head";
    sectionHead.textContent = "All ingredients";
    body.appendChild(sectionHead);

    const lastByIng = lastUsedByIngredient(entries);
    const list = document.createElement("div");
    list.className = "leader-list";
    const maxOz = ranked[0].totalOz;
    const totalOz = ranked.reduce((s, i) => s + i.totalOz, 0);
    ranked.forEach((ing, i) => {
      list.appendChild(leaderRow(ing, i + 1, maxOz, totalOz, lastByIng.get(ing.name)));
    });
    body.appendChild(list);

    meta.textContent = `${ranked.length} ingredient${ranked.length === 1 ? "" : "s"} · ${Math.round(totalOz)} oz`;
  }

  async function load() {
    meta.textContent = "Loading…";
    try {
      const [stats, history] = await Promise.all([
        getJSON("/api/stats"),
        getJSON("/api/history"),
      ]);
      const entries = Array.isArray(history.entries) ? history.entries : [];
      render(stats, entries);
    } catch (e) {
      console.error(e);
      meta.textContent = "Failed to load";
      showToast(`Couldn't load ingredient stats — ${e.message}`);
    }
  }

  function mount() {
    load();
  }

  function unmount() {}

  return { element, mount, unmount };
}
