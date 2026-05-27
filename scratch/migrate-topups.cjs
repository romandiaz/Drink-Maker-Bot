// One-off migration: topUp `'cola'` (string id) → `{ name, volumeOz }`.
// Run once from the repo root:  node scratch/migrate-topups.cjs
// Updates both the SEED in src/drinks.js and the live src/server/state/drinks.json.

const fs = require("fs");

// Per-drink top-up volume (oz) — base pour + enough mixer to fill the glass
// over ice. Long Island is the deliberate exception (a token splash of cola).
const VOL = {
  "moscow-mule": 4,
  "dark-and-stormy": 4,
  "kentucky-mule": 4,
  "mexican-mule": 4,
  "gin-buck": 4,
  "rum-buck": 4,
  "suffering-bastard": 4,
  "jackie-welles": 4,
  "long-island-iced-tea": 1,
  "cuba-libre": 5,
  "batanga": 5,
  "whiskey-cola": 5,
  "david-martinez": 3,
  "adam-smasher": 3,
  "johnny-silverhand": 3,
};

// --- src/drinks.js (SEED_DRINKS source) ---
const jsPath = "src/drinks.js";
let js = fs.readFileSync(jsPath, "utf8");
let jsCount = 0;
for (const [id, oz] of Object.entries(VOL)) {
  // Non-greedy span from this drink's id to its (first, own) topUp line.
  const re = new RegExp(`(id: '${id}',[\\s\\S]*?topUp: )'([\\w-]+)'`);
  if (!re.test(js)) {
    console.warn("drinks.js: no string topUp for", id, "(already migrated?)");
    continue;
  }
  js = js.replace(re, (m, pre, name) => `${pre}{ name: '${name}', volumeOz: ${oz} }`);
  jsCount++;
}
fs.writeFileSync(jsPath, js);
console.log(`drinks.js: migrated ${jsCount} top-ups`);

// --- src/server/state/drinks.json (live persisted data) ---
const jsonPath = "src/server/state/drinks.json";
if (fs.existsSync(jsonPath)) {
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  let jsonCount = 0;
  for (const d of data.drinks || []) {
    if (typeof d.topUp === "string" && d.topUp) {
      const oz = VOL[d.id];
      if (oz == null) {
        console.warn("drinks.json: no volume mapping for", d.id);
        continue;
      }
      d.topUp = { name: d.topUp, volumeOz: oz };
      jsonCount++;
    }
  }
  // Match drinks-store.js persist() formatting (2-space, no trailing newline).
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`drinks.json: migrated ${jsonCount} top-ups`);
} else {
  console.log("drinks.json: not present, skipped");
}
