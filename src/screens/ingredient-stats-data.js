// Pure aggregation over the raw pour log for the Top Ingredients overview.
// Parallel to drink-stats-data.js but summing ounces dispensed rather than
// counting pours. Derived from /api/history's entries; the leaderboard ranking
// itself still comes from /api/stats (topIngredients), and both read the same
// 500-entry log so they agree.

const DAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DAY_MS = 86_400_000;

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function entryOz(entry) {
  let oz = 0;
  for (const ing of entry.ingredients || []) oz += Number(ing.volumeOz) || 0;
  return oz;
}

// Newest pour timestamp per ingredient, so the leaderboard can show "last used".
export function lastUsedByIngredient(entries) {
  const last = new Map();
  for (const e of entries) {
    const ts = Date.parse(e.ts);
    if (!Number.isFinite(ts)) continue;
    for (const ing of e.ingredients || []) {
      const prev = last.get(ing.name);
      if (prev == null || ts > prev) last.set(ing.name, ts);
    }
  }
  return last;
}

export function computeIngredientOverview(entries, dayCount = 14) {
  const valid = entries
    .map((e) => ({ ...e, t: Date.parse(e.ts) }))
    .filter((e) => Number.isFinite(e.t));

  let volumeOz = 0;
  const distinct = new Set();
  const byDowOz = new Array(7).fill(0);

  for (const e of valid) {
    const oz = entryOz(e);
    volumeOz += oz;
    byDowOz[new Date(e.t).getDay()] += oz;
    for (const ing of e.ingredients || []) distinct.add(ing.name);
  }

  // Daily ounce buckets for the last `dayCount` calendar days, oldest first.
  // Each bucket carries a per-ingredient breakdown so the chart can stack the
  // bar by contribution and the tap-to-reveal panel can list the ingredients.
  const todayStart = startOfDay(Date.now());
  const daily = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    daily.push({ dayStartMs: todayStart - i * DAY_MS, oz: 0, byIng: {} });
  }
  const dayIndex = new Map(daily.map((d, i) => [d.dayStartMs, i]));
  const weekCutoff = todayStart - 6 * DAY_MS; // last 7 calendar days incl. today
  let weekOz = 0;
  for (const e of valid) {
    const oz = entryOz(e);
    const ds = startOfDay(e.t);
    if (dayIndex.has(ds)) {
      const bucket = daily[dayIndex.get(ds)];
      bucket.oz += oz;
      for (const ing of e.ingredients || []) {
        const ingOz = Number(ing.volumeOz) || 0;
        if (ingOz > 0) bucket.byIng[ing.name] = (bucket.byIng[ing.name] || 0) + ingOz;
      }
    }
    if (ds >= weekCutoff) weekOz += oz;
  }

  let busiestIdx = -1;
  let busiestOz = 0;
  byDowOz.forEach((oz, i) => {
    if (oz > busiestOz) {
      busiestOz = oz;
      busiestIdx = i;
    }
  });

  return {
    volumeOz,
    pours: valid.length,
    distinctIngredients: distinct.size,
    avgPerPour: valid.length > 0 ? volumeOz / valid.length : 0,
    weekOz,
    busiestDay:
      busiestIdx >= 0 ? { name: DAY_LONG[busiestIdx], oz: busiestOz } : null,
    daily,
  };
}
