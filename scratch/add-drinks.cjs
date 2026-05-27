// One-shot: add 12 drinks for under-used ingredients and fix Sex on the Beach.
// Run with: node scratch/add-drinks.cjs
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "..", "src", "server", "state", "drinks.json");

const NEW_DRINKS = [
  // --- vanilla-vodka ---
  {
    id: "creamsicle",
    name: "Creamsicle",
    tagline: "Childhood, in a glass.",
    category: "refreshers",
    glassType: "highball",
    ingredients: [
      { name: "vanilla-vodka", volumeOz: 1.5 },
      { name: "orange-juice", volumeOz: 2.5 },
      { name: "lemon-lime-soda", volumeOz: 2 },
    ],
    garnish: "orange-peel",
    topUp: null,
    needsIce: true,
    color: "#F4B860",
    enabled: true,
  },
  {
    id: "vanilla-cosmo",
    name: "Vanilla Cosmo",
    tagline: "Cosmopolitan, with a sweet streak.",
    category: "party",
    glassType: "coupe",
    ingredients: [
      { name: "vanilla-vodka", volumeOz: 1.5 },
      { name: "cranberry-juice", volumeOz: 1 },
      { name: "lime-juice", volumeOz: 0.5 },
      { name: "simple-syrup", volumeOz: 0.25 },
    ],
    garnish: "lemon-peel",
    topUp: null,
    needsIce: false,
    color: "#E84A6A",
    enabled: true,
  },
  {
    id: "vanilla-sky",
    name: "Vanilla Sky",
    tagline: "Lemon drop, in soft focus.",
    category: "sours",
    glassType: "coupe",
    ingredients: [
      { name: "vanilla-vodka", volumeOz: 1.5 },
      { name: "lemon-juice", volumeOz: 0.75 },
      { name: "simple-syrup", volumeOz: 0.5 },
      { name: "orange-juice", volumeOz: 0.5 },
    ],
    garnish: "lemon-wedge",
    topUp: null,
    needsIce: false,
    color: "#F4E4A0",
    enabled: true,
  },

  // --- midori ---
  {
    id: "japanese-slipper",
    name: "Japanese Slipper",
    tagline: "Bright, green, unmistakable.",
    category: "sours",
    glassType: "coupe",
    ingredients: [
      { name: "midori", volumeOz: 1 },
      { name: "triple-sec", volumeOz: 1 },
      { name: "lemon-juice", volumeOz: 1 },
    ],
    garnish: "lemon-wedge",
    topUp: null,
    needsIce: false,
    color: "#7FD64A",
    enabled: true,
  },
  {
    id: "midori-sour",
    name: "Midori Sour",
    tagline: "Melon. Lemon. Done.",
    category: "sours",
    glassType: "highball",
    ingredients: [
      { name: "midori", volumeOz: 1.5 },
      { name: "lemon-juice", volumeOz: 1 },
      { name: "simple-syrup", volumeOz: 0.5 },
      { name: "soda", volumeOz: 2 },
    ],
    garnish: "lemon-wedge",
    topUp: null,
    needsIce: true,
    color: "#B4E04A",
    enabled: true,
  },
  {
    id: "tokyo-iced-tea",
    name: "Tokyo Iced Tea",
    tagline: "Long Island goes to Shibuya.",
    category: "party",
    glassType: "highball",
    ingredients: [
      { name: "vodka", volumeOz: 0.5 },
      { name: "gin", volumeOz: 0.5 },
      { name: "light-rum", volumeOz: 0.5 },
      { name: "tequila", volumeOz: 0.5 },
      { name: "triple-sec", volumeOz: 0.5 },
      { name: "midori", volumeOz: 0.5 },
      { name: "lemon-juice", volumeOz: 0.75 },
      { name: "lemon-lime-soda", volumeOz: 2 },
    ],
    garnish: "lemon-wedge",
    topUp: null,
    needsIce: true,
    color: "#8FB04A",
    enabled: true,
  },

  // --- peach-schnapps ---
  {
    id: "fuzzy-navel",
    name: "Fuzzy Navel",
    tagline: "The peach, doing the heavy lifting.",
    category: "refreshers",
    glassType: "highball",
    ingredients: [
      { name: "peach-schnapps", volumeOz: 1.5 },
      { name: "orange-juice", volumeOz: 4 },
    ],
    garnish: "orange-peel",
    topUp: null,
    needsIce: true,
    color: "#F49E4C",
    enabled: true,
  },
  {
    id: "woo-woo",
    name: "Woo Woo",
    tagline: "Two syllables, full commitment.",
    category: "party",
    glassType: "highball",
    ingredients: [
      { name: "vodka", volumeOz: 1.5 },
      { name: "peach-schnapps", volumeOz: 0.75 },
      { name: "cranberry-juice", volumeOz: 3 },
    ],
    garnish: "lime-wedge",
    topUp: null,
    needsIce: true,
    color: "#E04A6A",
    enabled: true,
  },
  {
    id: "hairy-navel",
    name: "Hairy Navel",
    tagline: "Fuzzy Navel, with backup.",
    category: "refreshers",
    glassType: "highball",
    ingredients: [
      { name: "vodka", volumeOz: 1 },
      { name: "peach-schnapps", volumeOz: 1 },
      { name: "orange-juice", volumeOz: 4 },
    ],
    garnish: "orange-peel",
    topUp: null,
    needsIce: true,
    color: "#F4A040",
    enabled: true,
  },

  // --- hpnotiq ---
  {
    id: "hpnotiq-martini",
    name: "Hpnotiq Martini",
    tagline: "Turquoise on the rim.",
    category: "classics",
    glassType: "coupe",
    ingredients: [
      { name: "vodka", volumeOz: 1.5 },
      { name: "hpnotiq", volumeOz: 1 },
      { name: "pineapple-juice", volumeOz: 0.5 },
    ],
    garnish: "lemon-peel",
    topUp: null,
    needsIce: false,
    color: "#5AC8E8",
    enabled: true,
  },
  {
    id: "blue-lagoon-twist",
    name: "Blue Lagoon Twist",
    tagline: "Aqua, fizz, repeat.",
    category: "refreshers",
    glassType: "highball",
    ingredients: [
      { name: "vodka", volumeOz: 1.5 },
      { name: "hpnotiq", volumeOz: 1.5 },
      { name: "lemon-lime-soda", volumeOz: 3 },
    ],
    garnish: "lime-wedge",
    topUp: null,
    needsIce: true,
    color: "#4AB8E8",
    enabled: true,
  },
  {
    id: "mermaid-water",
    name: "Mermaid Water",
    tagline: "Tropical, with a tide pull.",
    category: "party",
    glassType: "rocks",
    ingredients: [
      { name: "coconut-rum", volumeOz: 1 },
      { name: "hpnotiq", volumeOz: 1 },
      { name: "pineapple-juice", volumeOz: 1.5 },
      { name: "lime-juice", volumeOz: 0.5 },
    ],
    garnish: "lime-wedge",
    topUp: null,
    needsIce: true,
    color: "#5DCAA5",
    enabled: true,
  },
];

const raw = fs.readFileSync(FILE, "utf8");
const data = JSON.parse(raw);
const drinks = data.drinks;

// Guard against re-running: skip ids that already exist.
const existingIds = new Set(drinks.map((d) => d.id));
const toAdd = NEW_DRINKS.filter((d) => !existingIds.has(d.id));
const skipped = NEW_DRINKS.filter((d) => existingIds.has(d.id)).map((d) => d.id);

// Fix Sex on the Beach: canonical recipe uses peach-schnapps, not grenadine.
const ssb = drinks.find((d) => d.id === "sex-on-the-beach");
let ssbFixed = false;
if (ssb) {
  const grenIdx = ssb.ingredients.findIndex((i) => i.name === "grenadine");
  const hasPeach = ssb.ingredients.some((i) => i.name === "peach-schnapps");
  if (grenIdx >= 0 && !hasPeach) {
    ssb.ingredients[grenIdx] = { name: "peach-schnapps", volumeOz: 0.75 };
    // Rebalance: bump vodka to 1.5 (already), keep cranberry/OJ at 2 each.
    ssbFixed = true;
  }
}

drinks.push(...toAdd);
data.updatedAt = new Date().toISOString();

fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");

console.log(`Added ${toAdd.length} drinks:`, toAdd.map((d) => d.id).join(", "));
if (skipped.length) console.log(`Skipped (already present):`, skipped.join(", "));
console.log(`Sex on the Beach fix applied:`, ssbFixed);
console.log(`Total drinks now: ${drinks.length}`);
