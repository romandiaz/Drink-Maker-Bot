// One-shot: move lemon-lime-soda from ingredients[] -> topUp{} for every drink
// that lists it. Skips drinks already migrated or with a conflicting topUp.
// Run with: node scratch/migrate-lemon-lime-soda.cjs
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "..", "src", "server", "state", "drinks.json");

const raw = fs.readFileSync(FILE, "utf8");
const data = JSON.parse(raw);
const drinks = data.drinks;

const migrated = [];
const skipped = [];

for (const d of drinks) {
  const idx = (d.ingredients || []).findIndex((i) => i.name === "lemon-lime-soda");
  if (idx < 0) continue;
  if (d.topUp) {
    skipped.push(`${d.id} (already has topUp=${d.topUp.name})`);
    continue;
  }
  const oz = d.ingredients[idx].volumeOz;
  d.ingredients.splice(idx, 1);
  d.topUp = { name: "lemon-lime-soda", volumeOz: oz };
  migrated.push(`${d.id} (${oz}oz)`);
}

data.updatedAt = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");

console.log(`Migrated ${migrated.length} drinks:`);
for (const m of migrated) console.log("  " + m);
if (skipped.length) {
  console.log(`Skipped ${skipped.length}:`);
  for (const s of skipped) console.log("  " + s);
}
