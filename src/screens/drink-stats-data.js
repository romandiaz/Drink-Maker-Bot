// Pure aggregation over the raw pour log for the Top Drinks overview. No DOM —
// the screen renders these numbers, the backend stays untouched. Everything is
// derived from /api/history's entries (capped at 500), keyed and summed the
// same way the dashboard's /api/stats does so the two never disagree.

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

// 14 → "12 AM", 13 → "1 PM". Bucketing by local hour matches how a host thinks
// about "when do people order" better than UTC would.
function formatHour(h) {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

// Newest pour timestamp per drink, keyed like the backend aggregates stats
// (drinkId, falling back to drinkName) so counts and timestamps line up.
export function lastPouredByDrink(entries) {
  const last = new Map();
  for (const e of entries) {
    const key = e.drinkId || e.drinkName;
    if (!key) continue;
    const ts = Date.parse(e.ts);
    if (!Number.isFinite(ts)) continue;
    const prev = last.get(key);
    if (prev == null || ts > prev) last.set(key, ts);
  }
  return last;
}

export function computeOverview(entries, dayCount = 14) {
  const valid = entries
    .map((e) => ({ ...e, t: Date.parse(e.ts) }))
    .filter((e) => Number.isFinite(e.t));

  let volumeOz = 0;
  const distinct = new Set();
  const byDow = new Array(7).fill(0);
  const byHour = new Array(24).fill(0);
  const activeDays = new Set();

  for (const e of valid) {
    const d = new Date(e.t);
    byDow[d.getDay()]++;
    byHour[d.getHours()]++;
    activeDays.add(startOfDay(e.t));
    distinct.add(e.drinkId || e.drinkName);
    for (const ing of e.ingredients || []) volumeOz += Number(ing.volumeOz) || 0;
  }

  // Daily buckets for the last `dayCount` calendar days, oldest first. Each
  // bucket carries a per-drink breakdown so the chart can stack the bar by
  // contribution and the tap-to-reveal panel can list the actual drinks.
  const todayStart = startOfDay(Date.now());
  const daily = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    daily.push({ dayStartMs: todayStart - i * DAY_MS, count: 0, byDrink: {} });
  }
  const dayIndex = new Map(daily.map((d, i) => [d.dayStartMs, i]));
  const weekCutoff = todayStart - 6 * DAY_MS; // last 7 calendar days incl. today
  let weekPours = 0;
  let todayPours = 0;
  for (const e of valid) {
    const ds = startOfDay(e.t);
    if (dayIndex.has(ds)) {
      const bucket = daily[dayIndex.get(ds)];
      bucket.count++;
      const key = e.drinkId || e.drinkName;
      if (key) bucket.byDrink[key] = (bucket.byDrink[key] || 0) + 1;
    }
    if (ds >= weekCutoff) weekPours++;
    if (ds === todayStart) todayPours++;
  }

  const peakOf = (arr) => {
    let idx = -1;
    let max = 0;
    arr.forEach((c, i) => {
      if (c > max) {
        max = c;
        idx = i;
      }
    });
    return { idx, count: max };
  };
  const dow = peakOf(byDow);
  const hr = peakOf(byHour);

  return {
    total: valid.length,
    volumeOz,
    distinctDrinks: distinct.size,
    weekPours,
    todayPours,
    avgPerActiveDay: activeDays.size > 0 ? valid.length / activeDays.size : 0,
    busiestDay: dow.idx >= 0 ? { name: DAY_LONG[dow.idx], count: dow.count } : null,
    peakHour: hr.idx >= 0 ? { label: formatHour(hr.idx), count: hr.count } : null,
    daily,
  };
}
