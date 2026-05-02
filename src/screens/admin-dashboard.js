import { drinks } from "../drinks.js";
import { ingredientName } from "../ingredients.js";
import { isDrinkPourable } from "../inventory-store.js";
import { reloadInventory, reloadDrinks } from "../app.js";
import { getJSON } from "../api.js";

// Dashboard view for the admin shell. Aggregates machine + inventory state
// alongside historical pour stats from /api/stats. Two of its cards
// (Inventory, Recipes) are shortcuts that switch to the matching tab via the
// `onSwitchTab` callback the shell hands in.

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

function listCard(title, rows, formatRight) {
  const card = document.createElement("section");
  card.className = "dash-card dash-card--list";

  const head = document.createElement("div");
  head.className = "dash-card__title";
  head.textContent = title;
  card.appendChild(head);

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-card__empty";
    empty.textContent = "No pours yet";
    card.appendChild(empty);
    return card;
  }

  const list = document.createElement("ol");
  list.className = "dash-list";
  rows.slice(0, 4).forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "dash-list__row";
    const rank = document.createElement("span");
    rank.className = "dash-list__rank";
    rank.textContent = String(i + 1);
    const name = document.createElement("span");
    name.className = "dash-list__name";
    name.textContent = r.label;
    const right = document.createElement("span");
    right.className = "dash-list__value";
    right.textContent = formatRight(r);
    li.append(rank, name, right);
    list.appendChild(li);
  });
  card.appendChild(list);
  return card;
}

function shortcutCard({ title, primary, secondary, onTap }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dash-card dash-card--shortcut tappable";
  btn.addEventListener("click", onTap);

  const t = document.createElement("div");
  t.className = "dash-card__title";
  t.textContent = title;
  const p = document.createElement("div");
  p.className = "dash-shortcut__primary";
  p.textContent = primary;
  const s = document.createElement("div");
  s.className = "dash-shortcut__secondary";
  s.textContent = secondary || "";
  const arrow = document.createElement("span");
  arrow.className = "dash-shortcut__arrow";
  arrow.textContent = "›";

  btn.append(t, p, s, arrow);
  return btn;
}

export function adminDashboardView({ setMeta, onSwitchTab }) {
  const element = document.createElement("div");
  element.className = "admin-body admin-body--dashboard";

  function renderStatusStrip(stats) {
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

    return strip;
  }

  function renderRow1(stats) {
    const row = document.createElement("div");
    row.className = "dash-row dash-row--lists";

    const drinkRows = (stats.topDrinks || []).map((d) => ({
      label: d.name || d.id || "Unknown",
      count: d.count,
    }));
    row.appendChild(
      listCard("Top drinks", drinkRows, (r) => `${r.count}`)
    );

    const ingRows = (stats.topIngredients || []).map((i) => ({
      label: ingredientName(i.name),
      totalOz: i.totalOz,
    }));
    row.appendChild(
      listCard("Top ingredients", ingRows, (r) => `${r.totalOz} oz`)
    );

    return row;
  }

  function renderRow2(inventory) {
    const row = document.createElement("div");
    row.className = "dash-row dash-row--shortcuts";

    const slots = inventory?.slots || [];
    const loaded = slots.filter((s) => s.ingredientId).length;
    const lowSlots = slots.filter(
      (s) => s.ingredientId && s.capacityOz > 0 && s.remainingOz / s.capacityOz <= 0.15
    );
    const lowCount = lowSlots.length;

    const totalRecipes = drinks.length;
    const pourableCount = drinks.filter((d) => isDrinkPourable(d)).length;
    const blocked = totalRecipes - pourableCount;

    row.appendChild(
      shortcutCard({
        title: "Inventory",
        primary: `${loaded} / ${slots.length} loaded`,
        secondary:
          lowCount > 0
            ? `${lowCount} low — ${lowSlots
                .slice(0, 2)
                .map((s) => ingredientName(s.ingredientId))
                .join(", ")}${lowCount > 2 ? "…" : ""}`
            : "All bottles healthy",
        onTap: () => onSwitchTab("inventory"),
      })
    );

    row.appendChild(
      shortcutCard({
        title: "Recipes",
        primary: `${pourableCount} / ${totalRecipes} pourable`,
        secondary:
          blocked > 0
            ? `${blocked} blocked — load missing bottles`
            : "Every recipe is pourable",
        onTap: () => onSwitchTab("recipes"),
      })
    );

    return row;
  }

  function render(stats, inventory) {
    element.innerHTML = "";
    element.appendChild(renderStatusStrip(stats));
    element.appendChild(renderRow1(stats));
    element.appendChild(renderRow2(inventory));

    const today = stats.todayPours;
    const total = stats.totalPours;
    setMeta(
      total === 0
        ? "No pours recorded yet"
        : `${total} pours all time · ${today} today`
    );
  }

  async function load() {
    setMeta("Loading…");
    try {
      // Refresh shared caches so the inventory + recipe shortcut counts
      // match what the Inventory and Recipes tabs would show this instant.
      await Promise.all([reloadInventory(), reloadDrinks()]);
      const [stats, inventory] = await Promise.all([
        getJSON("/api/stats"),
        getJSON("/api/inventory"),
      ]);
      render(stats, inventory);
    } catch (e) {
      console.error(e);
      setMeta("Failed to load dashboard");
    }
  }

  function mount() {
    load();
  }

  function unmount() {}

  return { element, mount, unmount };
}
