import { getJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { header } from "../components/header.js";
import { statTile } from "../components/stat-tile.js";
import { drinks, getCategoryById } from "../drinks.js";
import { computeOverview, lastPouredByDrink } from "./drink-stats-data.js";
import { buildDrinkActivityChart } from "./drink-activity-chart.js";
import { computeSpend, costByDrink, money } from "../ingredient-cost.js";

// Drink-history detail page, reached by tapping the dashboard's "Top drinks"
// card. Two parts: a high-level overview (headline stats + a 14-day activity
// chart) and the full pour leaderboard (every drink, not just the top three
// the card lists). Counts come from /api/stats (already aggregated + sorted);
// the overview and per-drink last-poured times are derived from the raw
// /api/history log. Both endpoints read the same 500-entry rolling log, so the
// views stay consistent — no backend change.

// Mirror of the dashboard's slice palette so a drink's swatch colour matches
// between the card and this page. Drinks resolve to their category accent;
// shots / custom / unknown ids fall back to the cycling palette.
const FALLBACK_PALETTE = [
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

function drinkColor(id, fallbackIndex) {
  const drink = drinks.find((d) => d.id === id);
  if (drink) {
    const cat = getCategoryById(drink.category);
    if (cat?.accent) return cat.accent;
  }
  return FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length];
}

function relativeTime(iso) {
  if (!iso) return "never";
  const ts = Date.parse(iso);
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

function overviewSection(ov, spend) {
  const section = document.createElement("section");
  section.className = "dstat-overview";

  const grid = document.createElement("div");
  grid.className = "dstat-grid";
  grid.appendChild(statTile(String(ov.total), "Total pours", `${ov.todayPours} today`));
  grid.appendChild(
    statTile(
      String(ov.weekPours),
      "This week",
      `${ov.avgPerActiveDay.toFixed(1)}/day avg`,
    ),
  );
  grid.appendChild(statTile(String(ov.distinctDrinks), "Distinct drinks"));
  // Spend tile when any ingredient is priced; otherwise fall back to volume so
  // the slot isn't a useless "$0".
  grid.appendChild(
    spend.totalSpent > 0
      ? statTile(
          money(spend.totalSpent),
          "Total spent",
          `${money(spend.totalSpent / ov.total)} avg/drink`,
        )
      : statTile(
          `${Math.round(ov.volumeOz)} oz`,
          "Poured",
          `≈ ${(ov.volumeOz / 33.814).toFixed(1)} L`,
        ),
  );
  grid.appendChild(
    ov.busiestDay
      ? statTile(ov.busiestDay.name, "Busiest day", `${ov.busiestDay.count} pours`)
      : statTile("—", "Busiest day"),
  );
  grid.appendChild(
    ov.peakHour
      ? statTile(ov.peakHour.label, "Peak hour", `${ov.peakHour.count} pours`)
      : statTile("—", "Peak hour"),
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

function leaderRow(drink, rank, maxCount, totalPours, lastTs, avgCost) {
  const row = document.createElement("div");
  row.className = "leader-row";

  const rankEl = document.createElement("span");
  rankEl.className = "leader-row__rank";
  rankEl.textContent = String(rank);

  const swatch = document.createElement("span");
  swatch.className = "leader-row__swatch";
  swatch.style.background = drinkColor(drink.id, rank - 1);

  const main = document.createElement("div");
  main.className = "leader-row__main";

  const head = document.createElement("div");
  head.className = "leader-row__head";
  const name = document.createElement("span");
  name.className = "leader-row__name";
  name.textContent = drink.name || drink.id || "Unknown";
  const count = document.createElement("span");
  count.className = "leader-row__count";
  count.textContent = `${drink.count}`;
  head.append(name, count);

  const bar = document.createElement("div");
  bar.className = "leader-row__bar";
  const fill = document.createElement("span");
  fill.className = "leader-row__bar-fill";
  fill.style.width = `${maxCount > 0 ? (drink.count / maxCount) * 100 : 0}%`;
  fill.style.background = drinkColor(drink.id, rank - 1);
  bar.appendChild(fill);

  const meta = document.createElement("div");
  meta.className = "leader-row__meta";
  const share = totalPours > 0 ? Math.round((drink.count / totalPours) * 100) : 0;
  const costPart = avgCost > 0 ? ` · ${money(avgCost)}/drink` : "";
  meta.textContent = `${share}% of pours${costPart} · last ${relativeTime(lastTs)}`;

  main.append(head, bar, meta);
  row.append(rankEl, swatch, main);
  return row;
}

export function drinkStats() {
  const element = document.createElement("section");
  element.className = "screen screen--admin";
  element.dataset.screen = "drinkStats";

  element.appendChild(
    header({
      back: true,
      eyebrow: "Station 01",
      title: "Top Drinks",
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
  hint.textContent = "Ranked by all-time pours";
  footer.append(meta, hint);
  element.appendChild(footer);

  function renderEmpty() {
    body.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No pours yet.";
    const sub = document.createElement("div");
    sub.className = "history-empty__sub";
    sub.textContent = "Drink stats will appear here once you start pouring.";
    empty.appendChild(sub);
    body.appendChild(empty);
    meta.textContent = "No pours recorded yet";
  }

  function render(stats, entries) {
    const ranked = stats.topDrinks || [];
    if (ranked.length === 0) {
      renderEmpty();
      return;
    }

    body.innerHTML = "";
    const ov = computeOverview(entries);
    body.appendChild(overviewSection(ov, computeSpend(entries)));

    // Stats already names every drink that ever poured (including shots /
    // custom), so build a key→name map for the breakdown panel from there.
    const nameByKey = new Map();
    for (const d of ranked) nameByKey.set(d.id || d.name, d.name || d.id);
    body.appendChild(buildDrinkActivityChart(ov.daily, nameByKey));

    const sectionHead = document.createElement("div");
    sectionHead.className = "leader-section-head";
    sectionHead.textContent = "All drinks";
    body.appendChild(sectionHead);

    const lastTsByDrink = lastPouredByDrink(entries);
    const costs = costByDrink(entries);
    const list = document.createElement("div");
    list.className = "leader-list";
    const maxCount = ranked[0].count;
    const totalPours = stats.totalPours || ranked.reduce((s, d) => s + d.count, 0);
    ranked.forEach((d, i) => {
      const key = d.id || d.name;
      const lastTs = lastTsByDrink.get(key);
      const iso = Number.isFinite(lastTs) ? new Date(lastTs).toISOString() : null;
      const avgCost = d.count > 0 ? (costs.get(key) || 0) / d.count : 0;
      list.appendChild(leaderRow(d, i + 1, maxCount, totalPours, iso, avgCost));
    });
    body.appendChild(list);

    meta.textContent = `${ranked.length} drink${ranked.length === 1 ? "" : "s"} · ${totalPours} pour${totalPours === 1 ? "" : "s"}`;
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
      showToast(`Couldn't load drink stats — ${e.message}`);
    }
  }

  function mount() {
    load();
  }

  function unmount() {}

  return { element, mount, unmount };
}
