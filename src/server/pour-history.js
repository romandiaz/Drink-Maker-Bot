// Append-only log of completed pours, plus aggregated stats for the dashboard.
// Stored as JSON next to inventory.json. Capped at MAX_ENTRIES (rolling) so
// the file can't grow unbounded across long uptimes.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const HISTORY_PATH = resolve(STATE_DIR, "pour-history.json");

const MAX_ENTRIES = 500;

let cache = null;

async function load() {
  if (cache) return cache;
  if (!existsSync(HISTORY_PATH)) {
    cache = { entries: [] };
    return cache;
  }
  try {
    const raw = await readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
    return cache;
  } catch {
    cache = { entries: [] };
    return cache;
  }
}

async function persist() {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(cache, null, 2), "utf8");
}

export async function record({ drinkId, drinkName, ingredients }) {
  const data = await load();
  data.entries.push({
    drinkId: drinkId ?? null,
    drinkName: drinkName ?? drinkId ?? "Unknown",
    ts: new Date().toISOString(),
    ingredients: (ingredients || []).map((i) => ({
      name: i.name,
      volumeOz: Number(i.volumeOz) || 0,
    })),
  });
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }
  await persist();
}

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function stats() {
  const data = await load();
  const entries = data.entries;
  const total = entries.length;
  const todayStart = startOfTodayMs();
  let today = 0;
  let lastTs = null;

  const drinkCounts = new Map(); // drinkId -> { count, name }
  const ingredientTotals = new Map(); // name -> { count, totalOz }

  for (const e of entries) {
    const ts = Date.parse(e.ts);
    if (Number.isFinite(ts)) {
      if (ts >= todayStart) today++;
      if (lastTs == null || ts > lastTs) lastTs = ts;
    }
    const key = e.drinkId || e.drinkName;
    const dc = drinkCounts.get(key) || { id: e.drinkId, name: e.drinkName, count: 0 };
    dc.count++;
    dc.name = e.drinkName || dc.name;
    drinkCounts.set(key, dc);
    for (const ing of e.ingredients || []) {
      const ic = ingredientTotals.get(ing.name) || { name: ing.name, count: 0, totalOz: 0 };
      ic.count++;
      ic.totalOz += Number(ing.volumeOz) || 0;
      ingredientTotals.set(ing.name, ic);
    }
  }

  // Return every aggregated drink/ingredient — the dashboard renders all of
  // them on its donut charts and only slices the top few for the text list.
  const topDrinks = [...drinkCounts.values()].sort((a, b) => b.count - a.count);
  const topIngredients = [...ingredientTotals.values()]
    .sort((a, b) => b.totalOz - a.totalOz)
    .map((i) => ({ ...i, totalOz: Number(i.totalOz.toFixed(1)) }));

  return {
    totalPours: total,
    todayPours: today,
    lastPourAt: lastTs ? new Date(lastTs).toISOString() : null,
    topDrinks,
    topIngredients,
    pourMode: process.env.SERIAL_PORT ? "serial" : "mock",
  };
}
