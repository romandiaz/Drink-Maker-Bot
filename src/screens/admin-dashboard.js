import { drinks, getCategoryById, isDrinkEnabled } from "../drinks.js";
import { ingredientName } from "../ingredients.js";
import { isDrinkPourable, bottleStatus, barValue } from "../inventory-store.js";
import { reloadInventory, reloadDrinks, reloadCategoriesConfig } from "../app.js";
import { isCategoryEnabled } from "../category-store.js";
import { getJSON } from "../api.js";
import { navigate } from "../app.js";
import { showToast } from "../components/toast.js";
import { createDonut } from "../components/donut.js";

// The dashboard's recipe + suggestion counts mirror what guests see, so they
// should ignore drinks the admin has hidden — same with disabled categories.
const isVisibleDrink = (d) => isDrinkEnabled(d) && isCategoryEnabled(d.category);

// Dashboard view for the admin shell. Aggregates machine + inventory state
// alongside historical pour stats from /api/stats. Each card pairs a donut
// chart (showing the full distribution) with a short text summary (top few
// items by name). Inventory and Recipes cards double as tab shortcuts via the
// `onSwitchTab` callback the shell hands in.

// Fallback palette for ingredient slices and any drink whose category we
// can't resolve. Cycles through warm/cool tones distinct from the four
// status colors elsewhere on the dashboard.
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

function relativeTime(iso) {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function statBlock(label, value) {
  const wrap = document.createElement("div");
  wrap.className = "dash-stat";
  const v = document.createElement("div");
  v.className = "dash-stat__value";
  v.textContent = value;
  const l = document.createElement("div");
  l.className = "dash-stat__label";
  l.textContent = label;
  wrap.append(v, l);
  return wrap;
}

function drinkColor(id, fallbackIndex) {
  const drink = drinks.find((d) => d.id === id);
  if (drink) {
    const cat = getCategoryById(drink.category);
    if (cat?.accent) return cat.accent;
  }
  return FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length];
}

function buildCard(title) {
  const card = document.createElement("section");
  card.className = "dash-card";
  const head = document.createElement("div");
  head.className = "dash-card__title";
  head.textContent = title;
  card.appendChild(head);
  const body = document.createElement("div");
  body.className = "dash-card__body";
  card.appendChild(body);
  return { card, body };
}

function buildList(rows, formatRight) {
  const list = document.createElement("ol");
  list.className = "dash-list";
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "dash-list__row";
    const swatch = document.createElement("span");
    swatch.className = "dash-list__swatch";
    swatch.style.background = r.color;
    const name = document.createElement("span");
    name.className = "dash-list__name";
    name.textContent = r.label;
    const right = document.createElement("span");
    right.className = "dash-list__value";
    right.textContent = formatRight(r);
    li.append(swatch, name, right);
    list.appendChild(li);
  });
  return list;
}

function topDrinksCard(stats) {
  const { card, body } = buildCard("Top drinks");
  const all = stats.topDrinks || [];

  if (all.length === 0) {
    body.classList.add("dash-card__body--empty");
    const empty = document.createElement("div");
    empty.className = "dash-card__empty";
    empty.textContent = "No pours yet";
    body.appendChild(empty);
    return card;
  }

  const segments = all.map((d, i) => ({
    value: d.count,
    color: drinkColor(d.id, i),
  }));
  const totalPours = all.reduce((s, d) => s + d.count, 0);

  body.appendChild(
    createDonut({
      segments,
      size: 76,
      thickness: 9,
      centerLabel: String(totalPours),
      centerSubLabel: "POURS",
    }),
  );

  const rows = all.slice(0, 3).map((d, i) => ({
    label: d.name || d.id || "Unknown",
    count: d.count,
    color: drinkColor(d.id, i),
  }));
  body.appendChild(buildList(rows, (r) => `${r.count}`));

  // With pours logged, the card drills into the full drink leaderboard. The
  // empty state above returns early, so it stays inert.
  card.classList.add("dash-card--shortcut", "tappable");
  card.addEventListener("click", () => navigate("drinkStats"));

  return card;
}

function topIngredientsCard(stats) {
  const { card, body } = buildCard("Top ingredients");
  const all = stats.topIngredients || [];

  if (all.length === 0) {
    body.classList.add("dash-card__body--empty");
    const empty = document.createElement("div");
    empty.className = "dash-card__empty";
    empty.textContent = "No pours yet";
    body.appendChild(empty);
    return card;
  }

  const segments = all.map((ing, i) => ({
    value: ing.totalOz,
    color: FALLBACK_PALETTE[i % FALLBACK_PALETTE.length],
  }));
  const totalOz = all.reduce((s, ing) => s + ing.totalOz, 0);

  body.appendChild(
    createDonut({
      segments,
      size: 76,
      thickness: 9,
      centerLabel: totalOz.toFixed(1),
      centerSubLabel: "OZ",
    }),
  );

  const rows = all.slice(0, 3).map((ing, i) => ({
    label: ingredientName(ing.name),
    totalOz: ing.totalOz,
    color: FALLBACK_PALETTE[i % FALLBACK_PALETTE.length],
  }));
  body.appendChild(buildList(rows, (r) => `${r.totalOz} oz`));

  // Mirrors the top-drinks card: with pours logged, drill into the full
  // ingredient leaderboard. The empty state above returns early.
  card.classList.add("dash-card--shortcut", "tappable");
  card.addEventListener("click", () => navigate("ingredientStats"));

  return card;
}

function inventoryCard(inventory, onTap) {
  const slots = inventory?.slots || [];
  const grouped = { unloaded: [], empty: [], low: [], healthy: [] };
  for (const s of slots) grouped[bottleStatus(s)].push(s);
  const loadedCount = grouped.empty.length + grouped.low.length + grouped.healthy.length;
  const emptySlots = grouped.empty;
  const lowSlots = grouped.low;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dash-card dash-card--shortcut tappable";
  btn.addEventListener("click", onTap);

  const head = document.createElement("div");
  head.className = "dash-card__title";
  head.textContent = "Inventory";
  btn.appendChild(head);

  const body = document.createElement("div");
  body.className = "dash-card__body";
  btn.appendChild(body);

  body.appendChild(
    createDonut({
      segments: [
        { value: grouped.healthy.length, color: "var(--status-ready)" },
        { value: lowSlots.length, color: "var(--accent-sours)" },
        { value: emptySlots.length, color: "var(--accent-shots)" },
        { value: grouped.unloaded.length, color: "var(--text-quaternary)" },
      ],
      size: 76,
      thickness: 9,
      centerLabel: `${loadedCount}/${slots.length}`,
      centerSubLabel: "LOADED",
    }),
  );

  const formatGroup = (label, group) => {
    const names = group.map((s) => ingredientName(s.ingredientId)).join(", ");
    return `${group.length} ${label} — ${names}`;
  };

  const parts = [];
  if (emptySlots.length > 0) parts.push(formatGroup("empty", emptySlots));
  if (lowSlots.length > 0) parts.push(formatGroup("low", lowSlots));

  const text = document.createElement("div");
  text.className = "dash-shortcut__text";
  const secondary = document.createElement("div");
  secondary.className = "dash-shortcut__secondary";
  secondary.textContent = parts.length > 0 ? parts.join(" · ") : "All bottles healthy";
  text.appendChild(secondary);
  body.appendChild(text);

  return btn;
}

// Per-shortfall reasons map to user-facing verbs. 'missing' means no slot
// holds the ingredient (load or swap); 'empty'/'low' mean a slot exists but
// doesn't have enough volume for the recipe (refill). Splitting these out
// lets the suggestion say "Refill lime juice" — usually a 30-second fix —
// instead of always nudging toward a swap.
function shortfallsFor(drink, assigned, remainingByIngredient) {
  const out = [];
  for (const ing of drink.ingredients) {
    const remaining = remainingByIngredient.get(ing.name) || 0;
    if (remaining >= ing.volumeOz) continue;
    const reason = !assigned.has(ing.name)
      ? "missing"
      : remaining <= 0
        ? "empty"
        : "low";
    out.push({ name: ing.name, reason });
  }
  return out;
}

// Compose "...to unlock Margarita, Daiquiri, and 2 more" from the actual
// drinks a suggestion would make pourable. Names are far more motivating
// than a bare count — and they let the user sanity-check the suggestion
// before tapping through to inventory.
function describeUnlocks(unlockedDrinks) {
  const names = unlockedDrinks.map((d) => d.name).filter(Boolean);
  if (names.length === 0) return "more drinks";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`;
}

// Single best action to unlock more recipes — load a new ingredient, refill
// an empty/low bottle, or swap one slot's contents. Each candidate is
// weighted by pour history: a candidate that unlocks one favorite beats one
// that unlocks two never-poured novelties. Returns null when no single
// action is a clean win (caller falls back to a most-needed list).
function recipeSuggestion(inventory, stats) {
  const slots = inventory?.slots || [];
  const assigned = new Set(
    slots.filter((s) => s.ingredientId).map((s) => s.ingredientId),
  );
  const unassignedSlotCount = slots.filter((s) => !s.ingredientId).length;
  const remainingByIngredient = new Map();
  for (const s of slots) {
    if (!s.ingredientId) continue;
    remainingByIngredient.set(
      s.ingredientId,
      (remainingByIngredient.get(s.ingredientId) || 0) +
        (Number(s.remainingOz) || 0),
    );
  }

  // +1 baseline so never-poured drinks still register, but a drink poured 10
  // times outweighs a single novelty. Using id keys because topDrinks groups
  // by drinkId from pour history.
  const popularity = new Map(
    (stats?.topDrinks || []).map((d) => [d.id, d.count || 0]),
  );
  const weightOf = (drink) => (popularity.get(drink.id) || 0) + 1;

  const blockedDrinks = drinks.filter(
    (d) => isVisibleDrink(d) && !isDrinkPourable(d),
  );
  if (blockedDrinks.length === 0) return null;

  // Group by the ingredient that's the *sole* unmet item — fixing one
  // ingredient can't unlock a recipe missing two things, and we want
  // suggestions the user can act on in one step.
  const candidates = new Map();
  for (const d of blockedDrinks) {
    const sh = shortfallsFor(d, assigned, remainingByIngredient);
    if (sh.length !== 1) continue;
    const { name } = sh[0];
    // The action verb depends only on whether the ingredient is currently
    // assigned to a slot (refill vs load/swap), not on per-drink empty-vs-low
    // — so we don't need the shortfall reason here.
    const entry = candidates.get(name) || {
      ingredient: name,
      weight: 0,
      drinks: [],
      assigned: assigned.has(name),
    };
    entry.weight += weightOf(d);
    entry.drinks.push(d);
    candidates.set(name, entry);
  }
  if (candidates.size === 0) return null;

  // Sort drinks within each candidate by popularity so describeUnlocks puts
  // the most-poured drinks first — the suggestion reads as "...to unlock
  // [your favorites]..." rather than alphabetical order.
  let best = null;
  for (const c of candidates.values()) {
    c.drinks.sort((a, b) => weightOf(b) - weightOf(a));
    if (
      !best ||
      c.weight > best.weight ||
      (c.weight === best.weight && c.drinks.length > best.drinks.length)
    ) {
      best = c;
    }
  }

  const inName = ingredientName(best.ingredient);
  const unlocks = describeUnlocks(best.drinks);

  if (best.assigned) {
    return `Refill ${inName} to unlock ${unlocks}`;
  }
  if (unassignedSlotCount > 0) {
    return `Load ${inName} to unlock ${unlocks}`;
  }

  // All slots full — find an ingredient we can drop without breaking a
  // pourable recipe. Among safe candidates, prefer the one used in the
  // fewest recipes overall (least valuable to keep).
  const usedByPourable = new Set();
  for (const d of drinks) {
    if (!isVisibleDrink(d) || !isDrinkPourable(d)) continue;
    for (const i of d.ingredients) usedByPourable.add(i.name);
  }
  const usedByAnyDrink = new Map();
  for (const d of drinks) {
    if (!isVisibleDrink(d)) continue;
    for (const i of d.ingredients) {
      usedByAnyDrink.set(i.name, (usedByAnyDrink.get(i.name) || 0) + 1);
    }
  }
  const swapCandidates = [...assigned].filter((id) => !usedByPourable.has(id));
  if (swapCandidates.length === 0) return null;
  swapCandidates.sort(
    (a, b) => (usedByAnyDrink.get(a) || 0) - (usedByAnyDrink.get(b) || 0),
  );
  const outName = ingredientName(swapCandidates[0]);
  return `Swap ${outName} for ${inName} to unlock ${unlocks}`;
}

// Ingredients holding back the most blocked recipes, ranked by popularity-
// weighted demand. Used as the recipes-card fallback when no single action
// unlocks anything cleanly (every blocked drink needs 2+ ingredients) — we
// surface the bottles the user would benefit most from sourcing next.
function missingBottleNames(inventory, stats) {
  const slots = inventory?.slots || [];
  const assigned = new Set(
    slots.filter((s) => s.ingredientId).map((s) => s.ingredientId),
  );
  const popularity = new Map(
    (stats?.topDrinks || []).map((d) => [d.id, d.count || 0]),
  );
  const weightOf = (drink) => (popularity.get(drink.id) || 0) + 1;

  const demand = new Map();
  for (const d of drinks) {
    if (!isVisibleDrink(d)) continue;
    for (const i of d.ingredients) {
      if (!assigned.has(i.name)) {
        demand.set(i.name, (demand.get(i.name) || 0) + weightOf(d));
      }
    }
  }
  return [...demand.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => ingredientName(id));
}

function recipesCard(inventory, stats, onOpenRecipes, onOpenInventory) {
  const visible = drinks.filter(isVisibleDrink);
  const totalRecipes = visible.length;
  const pourableCount = visible.filter((d) => isDrinkPourable(d)).length;
  const blocked = totalRecipes - pourableCount;

  // Outer is a div (not a button) so we can nest a real button for the
  // suggestion's secondary action — clicking the suggestion jumps to the
  // Inventory tab where the swap gets done; clicking anywhere else opens
  // Recipes as before.
  const card = document.createElement("div");
  card.className = "dash-card dash-card--shortcut tappable";
  card.addEventListener("click", onOpenRecipes);

  const head = document.createElement("div");
  head.className = "dash-card__title";
  head.textContent = "Recipes";
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "dash-card__body";
  card.appendChild(body);

  body.appendChild(
    createDonut({
      segments: [
        { value: pourableCount, color: "var(--status-ready)" },
        { value: blocked, color: "var(--text-quaternary)" },
      ],
      size: 76,
      thickness: 9,
      centerLabel: `${pourableCount}/${totalRecipes}`,
      centerSubLabel: "POURABLE",
    }),
  );

  const text = document.createElement("div");
  text.className = "dash-shortcut__text";

  if (blocked === 0) {
    const primary = document.createElement("div");
    primary.className = "dash-shortcut__primary";
    primary.textContent = "Every recipe is pourable";
    text.appendChild(primary);
  } else {
    const primary = document.createElement("div");
    primary.className = "dash-shortcut__primary";
    primary.textContent = `${blocked} Locked recipes`;
    text.appendChild(primary);

    let suggestionText = recipeSuggestion(inventory, stats);
    if (!suggestionText) {
      const missing = missingBottleNames(inventory, stats);
      suggestionText =
        missing.length > 0
          ? `Missing: ${missing.join(", ")}`
          : "Refill empty bottles to unlock more";
    }
    const suggestionBtn = document.createElement("button");
    suggestionBtn.type = "button";
    suggestionBtn.className =
      "dash-shortcut__secondary dash-shortcut__suggestion tappable";
    suggestionBtn.textContent = suggestionText;
    suggestionBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onOpenInventory();
    });
    text.appendChild(suggestionBtn);
  }

  body.appendChild(text);

  return card;
}

export function adminDashboardView({ setMeta, onSwitchTab }) {
  const element = document.createElement("div");
  element.className = "admin-body admin-body--dashboard";

  function renderStatusStrip(stats, inventory) {
    const strip = document.createElement("section");
    strip.className = "dash-status";

    const dot = document.createElement("span");
    dot.className = "dash-status__dot";
    const mode = document.createElement("span");
    mode.className = "dash-status__mode";
    mode.textContent =
      stats.pourMode === "serial" ? "Connected" : "Mock pour";
    if (stats.pourMode !== "serial") strip.classList.add("is-mock");
    strip.append(dot, mode);

    strip.appendChild(statBlock("Total pours", String(stats.totalPours)));
    strip.appendChild(statBlock("Today", String(stats.todayPours)));
    strip.appendChild(statBlock("Last pour", relativeTime(stats.lastPourAt)));
    // Only shown once at least one bottle has a recorded cost.
    const value = barValue(inventory?.slots);
    if (value > 0) strip.appendChild(statBlock("Bar value", `$${value}`));

    return strip;
  }

  function renderRow1(stats) {
    const row = document.createElement("div");
    row.className = "dash-row dash-row--lists";
    row.appendChild(topDrinksCard(stats));
    row.appendChild(topIngredientsCard(stats));
    return row;
  }

  function renderRow2(inventory, stats) {
    const row = document.createElement("div");
    row.className = "dash-row dash-row--shortcuts";
    row.appendChild(inventoryCard(inventory, () => onSwitchTab("inventory")));
    row.appendChild(
      recipesCard(
        inventory,
        stats,
        () => onSwitchTab("recipes"),
        () => onSwitchTab("inventory"),
      ),
    );
    return row;
  }

  function render(stats, inventory) {
    element.innerHTML = "";
    element.appendChild(renderStatusStrip(stats, inventory));
    element.appendChild(renderRow1(stats));
    element.appendChild(renderRow2(inventory, stats));

    const today = stats.todayPours;
    const total = stats.totalPours;
    setMeta(
      total === 0
        ? "No pours recorded yet"
        : `${total} pours all time · ${today} today`,
    );
  }

  async function load() {
    setMeta("Loading…");
    try {
      // Refresh shared caches so the inventory + recipe shortcut counts
      // match what the Inventory and Recipes tabs would show this instant.
      await Promise.all([reloadInventory(), reloadDrinks(), reloadCategoriesConfig()]);
      const [stats, inventory] = await Promise.all([
        getJSON("/api/stats"),
        getJSON("/api/inventory"),
      ]);
      render(stats, inventory);
    } catch (e) {
      console.error(e);
      setMeta("Failed to load dashboard");
      showToast(`Couldn't load dashboard — ${e.message}`);
    }
  }

  function mount() {
    load();
  }

  function unmount() {}

  return { element, mount, unmount };
}
