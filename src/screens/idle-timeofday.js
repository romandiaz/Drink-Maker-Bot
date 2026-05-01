// Time-of-day buckets for the idle screen. The label replaces the static
// "Discover" eyebrow and the categoryIds are preferred when picking what to
// feature — callers fall back to the full pool when the bucket is empty.

const BUCKETS = [
  { startHour: 5,  label: "MORNING",   categoryIds: ["refreshers"] },
  { startHour: 11, label: "AFTERNOON", categoryIds: ["refreshers", "sours"] },
  { startHour: 16, label: "EVENING",   categoryIds: ["classics", "sours"] },
  { startHour: 21, label: "NIGHTCAP",  categoryIds: ["classics", "party"] },
];

export function timeBucket(date = new Date()) {
  const h = date.getHours();
  // Walk backwards so the last bucket whose startHour ≤ h wins. 21–5 wraps
  // across midnight by falling through to the last entry when h < 5.
  for (let i = BUCKETS.length - 1; i >= 0; i--) {
    if (h >= BUCKETS[i].startHour) return BUCKETS[i];
  }
  return BUCKETS[BUCKETS.length - 1];
}
