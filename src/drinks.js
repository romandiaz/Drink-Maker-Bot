// Volumes are for a "regular" strength pour; the detail screen scales these
// based on the strength slider.

export const categories = [
  {
    id: 'classics',
    name: 'The Classics',
    descriptor: 'TIMELESS',
    number: '01',
    accent: 'var(--accent-classics)',
  },
  {
    id: 'refreshers',
    name: 'The Refreshers',
    descriptor: 'LIGHT & CRISP',
    number: '02',
    accent: 'var(--accent-refreshers)',
  },
  {
    id: 'sours',
    name: 'The Sours',
    descriptor: 'TART & BRIGHT',
    number: '03',
    accent: 'var(--accent-sours)',
  },
  {
    id: 'party',
    name: 'The Party',
    descriptor: 'BRIGHT & BOLD',
    number: '04',
    accent: 'var(--accent-party)',
  },
  {
    id: 'tiki',
    name: 'The Tiki',
    descriptor: 'TROPICAL & RUM',
    number: '05',
    accent: 'var(--accent-tiki)',
  },
  // Shots is metadata-only — rendered as a secondary pill on the category
  // screen, not a tile. Kept in this list so getCategoryById('shots') still
  // resolves for stale state, deep-links, and pagination redirects.
  {
    id: 'shots',
    name: 'The Shots',
    descriptor: 'PURE & DIRECT',
    number: '06',
    accent: 'var(--accent-shots)',
  },
];

// Category IDs the drink editor can assign to. "shots" is excluded — it's a
// utility flow driven by shotIngredients, not a free-form recipe. Exported so
// both the client editor and the server-side validator reference one list.
export const EDITABLE_CATEGORY_IDS = ['classics', 'refreshers', 'sours', 'party', 'tiki'];

// Glass types the editor lets you pick and the validator accepts. The "shot"
// glass exists but is only used internally by buildShotDrink().
export const GLASS_TYPES = ['coupe', 'rocks', 'highball', 'margarita'];

// Pourable pure spirits for the Shots category. `color` is the liquid fill for
// the shot glass visualization; `defaultOz` is the preselected pour volume on
// the shot-detail screen. Display name is derived from ingredientName(id).
export const shotIngredients = [
  { id: 'whiskey',        color: '#C98A3F', defaultOz: 1.5 },
  { id: 'vodka',          color: '#E8EEF2', defaultOz: 1.5 },
  { id: 'gin',            color: '#D6E8EC', defaultOz: 1.5 },
  { id: 'tequila',        color: '#E8E0A8', defaultOz: 1.5 },
  { id: 'rum',            color: '#D4B07A', defaultOz: 1.5 },
  { id: 'campari',        color: '#D13B2F', defaultOz: 1.0 },
  { id: 'vermouth',       color: '#EDE0B0', defaultOz: 1.0 },
  { id: 'sweet-vermouth', color: '#A8482F', defaultOz: 1.0 },
  { id: 'triple-sec',     color: '#F0D88A', defaultOz: 1.0 },
];

export const getShotIngredientById = (id) =>
  shotIngredients.find((s) => s.id === id);

// Synthesize a single-ingredient "drink" so the existing pouring screen,
// progress UI, and mock pour engine can handle shots without branching.
// The caller supplies the resolved pretty name so drinks.js doesn't need to
// import from ingredients.js (which already imports from here).
export function buildShotDrink(ingredientId, volumeOz, displayName) {
  const ing = getShotIngredientById(ingredientId);
  if (!ing) throw new Error(`Unknown shot ingredient: ${ingredientId}`);
  const volume = Number(volumeOz.toFixed(2));
  return {
    id: `shot-${ing.id}-${volume.toFixed(2)}`,
    name: `${displayName} Shot`,
    tagline: null,
    category: 'shots',
    glassType: 'shot',
    ingredients: [{ name: ing.id, volumeOz: volume }],
    garnish: null,
    color: ing.color,
    isShot: true,
  };
}

// Glass types: 'coupe' | 'rocks' | 'highball' | 'margarita'
// Each drink has `color` for the fallback SVG rendering until real photos are shot.

// Seed data used to bootstrap the backend's drinks.json on first run and as
// the pre-hydration fallback on the frontend. Do not mutate — edits flow
// through the /api/drinks endpoints into the `drinks` array below.
export const SEED_DRINKS = [
  // THE CLASSICS
  {
    id: 'martini',
    name: 'Martini',
    tagline: 'Clean, bracing, iconic.',
    category: 'classics',
    glassType: 'coupe',
    ingredients: [
      { name: 'gin', volumeOz: 2 },
      { name: 'vermouth', volumeOz: 0.25 },
    ],
    garnish: 'olive',
    color: '#E8DFA8',
    photo: 'assets/drinks/martini.png',
  },
  {
    id: 'manhattan',
    name: 'Manhattan',
    tagline: 'Whiskey, tamed and dressed.',
    category: 'classics',
    glassType: 'coupe',
    ingredients: [
      { name: 'whiskey', volumeOz: 2 },
      { name: 'sweet-vermouth', volumeOz: 0.75 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: 'cherry',
    color: '#B8483A',
    photo: 'assets/drinks/manhattan.png',
  },
  {
    id: 'negroni',
    name: 'Negroni',
    tagline: 'Bitter, balanced, unapologetic.',
    category: 'classics',
    glassType: 'rocks',
    ingredients: [
      { name: 'gin', volumeOz: 1 },
      { name: 'campari', volumeOz: 1 },
      { name: 'sweet-vermouth', volumeOz: 1 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#C94E3A',
    photo: 'assets/drinks/negroni.png',
  },
  {
    id: 'old-fashioned',
    name: 'Old Fashioned',
    tagline: 'The original, still perfect.',
    category: 'classics',
    glassType: 'rocks',
    ingredients: [
      { name: 'whiskey', volumeOz: 2 },
      { name: 'simple-syrup', volumeOz: 0.25 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#A0623A',
    photo: 'assets/drinks/old-fashioned.png',
  },
  {
    id: 'boulevardier',
    name: 'Boulevardier',
    tagline: 'Negroni’s warmer cousin.',
    category: 'classics',
    glassType: 'rocks',
    ingredients: [
      { name: 'whiskey', volumeOz: 1 },
      { name: 'campari', volumeOz: 1 },
      { name: 'sweet-vermouth', volumeOz: 1 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#9C3A27',
    photo: 'assets/drinks/boulevardier.png',
  },
  {
    id: 'americano',
    name: 'Americano',
    tagline: 'Light, bitter, effervescent.',
    category: 'classics',
    glassType: 'highball',
    ingredients: [
      { name: 'campari', volumeOz: 1 },
      { name: 'sweet-vermouth', volumeOz: 1 },
      { name: 'soda', volumeOz: 3 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#D25841',
    photo: 'assets/drinks/americano.png',
  },
  {
    id: 'bronx',
    name: 'Bronx Cocktail',
    tagline: 'A fruity twist on the Martini.',
    category: 'classics',
    glassType: 'coupe',
    ingredients: [
      { name: 'gin', volumeOz: 1.5 },
      { name: 'sweet-vermouth', volumeOz: 0.75 },
      { name: 'vermouth', volumeOz: 0.5 },
      { name: 'orange-juice', volumeOz: 1 },
    ],
    garnish: 'orange-peel',
    color: '#F49E4C',
    photo: 'assets/drinks/bronx.png',
  },
  {
    id: 'garibaldi',
    name: 'Garibaldi',
    tagline: 'Italian sunshine in a glass.',
    category: 'classics',
    glassType: 'highball',
    ingredients: [
      { name: 'campari', volumeOz: 1.5 },
      { name: 'orange-juice', volumeOz: 4 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#EF6A32',
    photo: 'assets/drinks/garibaldi.png',
  },
  {
    id: 'vesper',
    name: 'Vesper',
    tagline: 'Shaken, not stirred.',
    category: 'classics',
    glassType: 'coupe',
    ingredients: [
      { name: 'gin', volumeOz: 1.5 },
      { name: 'vodka', volumeOz: 0.5 },
      { name: 'vermouth', volumeOz: 0.25 },
    ],
    garnish: 'lemon-wedge',
    color: '#EAE3B0',
    photo: 'assets/drinks/vesper.png',
  },
  {
    id: 'sazerac',
    name: 'Sazerac',
    tagline: 'New Orleans in a glass.',
    category: 'classics',
    glassType: 'rocks',
    ingredients: [
      { name: 'whiskey', volumeOz: 2 },
      { name: 'simple-syrup', volumeOz: 0.15 },
      { name: 'bitters', volumeOz: 0.2 },
    ],
    garnish: 'lemon-wedge',
    color: '#A0623A',
    photo: 'assets/drinks/sazerac.png',
  },
  {
    id: 'el-presidente',
    name: 'El Presidente',
    tagline: 'Havana, before the storm.',
    category: 'classics',
    glassType: 'coupe',
    ingredients: [
      { name: 'rum', volumeOz: 1.5 },
      { name: 'sweet-vermouth', volumeOz: 0.75 },
      { name: 'triple-sec', volumeOz: 0.25 },
      { name: 'grenadine', volumeOz: 0.1 },
    ],
    garnish: 'orange-peel',
    color: '#D88A4A',
    photo: 'assets/drinks/el-presidente.png',
  },

  // THE REFRESHERS
  {
    id: 'gin-tonic',
    name: 'Gin & Tonic',
    tagline: 'A garden in a glass.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'gin', volumeOz: 1.5 },
      { name: 'soda', volumeOz: 4.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#C8E6F0',
    photo: 'assets/drinks/gin-tonic.png',
  },
  {
    id: 'vodka-tonic',
    name: 'Vodka Tonic',
    tagline: 'Crisp, clear, cooling.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'soda', volumeOz: 4.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#DDEEF4',
    photo: 'assets/drinks/vodka-tonic.png',
  },
  {
    id: 'tequila-tonic',
    name: 'Tequila Tonic',
    tagline: 'Agave meets bubbles.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'tequila', volumeOz: 1.5 },
      { name: 'soda', volumeOz: 4.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#EAF0CD',
    photo: 'assets/drinks/tequila-tonic.png',
  },
  {
    id: 'rum-tonic',
    name: 'Rum & Tonic',
    tagline: 'Tropical twist on a classic.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 1.5 },
      { name: 'soda', volumeOz: 4.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#E0DBBE',
    photo: 'assets/drinks/rum-tonic.png',
  },
  {
    id: 'tom-collins',
    name: 'Tom Collins',
    tagline: 'Sparkling gin with lemon and sun.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'gin', volumeOz: 1.5 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
      { name: 'soda', volumeOz: 3 },
    ],
    garnish: 'lemon-wedge',
    needsIce: true,
    color: '#F0E8A0',
    photo: 'assets/drinks/tom-collins.png',
  },
  {
    id: 'john-collins',
    name: 'John Collins',
    tagline: 'Whiskey’s sparkling side.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'whiskey', volumeOz: 1.5 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
      { name: 'soda', volumeOz: 3 },
    ],
    garnish: 'lemon-wedge',
    needsIce: true,
    color: '#F0D194',
    photo: 'assets/drinks/john-collins.png',
  },
  {
    id: 'vodka-collins',
    name: 'Vodka Collins',
    tagline: 'A sharp and bubbly cooler.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
      { name: 'soda', volumeOz: 3 },
    ],
    garnish: 'lemon-wedge',
    needsIce: true,
    color: '#F5F2D0',
    photo: 'assets/drinks/vodka-collins.png',
  },
  {
    id: 'tequila-collins',
    name: 'Tequila Collins',
    tagline: 'Agave, citrus, bubbles.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'tequila', volumeOz: 1.5 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
      { name: 'soda', volumeOz: 3 },
    ],
    garnish: 'lemon-wedge',
    needsIce: true,
    color: '#EBF0BA',
    photo: 'assets/drinks/tequila-collins.png',
  },
  {
    id: 'whiskey-highball',
    name: 'Whiskey Highball',
    tagline: 'Tall, dark, and bubbly.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'whiskey', volumeOz: 1.5 },
      { name: 'soda', volumeOz: 4.5 },
    ],
    garnish: 'lemon-wedge',
    needsIce: true,
    color: '#D89C60',
    photo: 'assets/drinks/whiskey-highball.png',
  },
  {
    id: 'gin-rickey',
    name: 'Gin Rickey',
    tagline: 'No sugar, all refreshment.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'gin', volumeOz: 1.5 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'soda', volumeOz: 4 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#D3EFD8',
    photo: 'assets/drinks/gin-rickey.png',
  },
  {
    id: 'screwdriver',
    name: 'Screwdriver',
    tagline: 'Vodka and orange, simply.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'orange-juice', volumeOz: 4.5 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#F5A030',
    photo: 'assets/drinks/screwdriver.png',
  },
  {
    id: 'bay-breeze',
    name: 'Bay Breeze',
    tagline: 'Cranberry meets pineapple, breezy.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'cranberry-juice', volumeOz: 2 },
      { name: 'pineapple-juice', volumeOz: 2 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#E66585',
    photo: 'assets/drinks/bay-breeze.png',
  },
  {
    id: 'moscow-mule',
    name: 'Moscow Mule',
    tagline: 'Cold copper, sharp ginger.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    topUp: 'ginger-beer',
    needsIce: true,
    color: '#E0C68A',
    photo: 'assets/drinks/moscow-mule.png',
  },
  {
    id: 'dark-and-stormy',
    name: 'Dark and Stormy',
    tagline: 'Rum, ginger, and a heavy sky.',
    category: 'refreshers',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    topUp: 'ginger-beer',
    needsIce: true,
    color: '#8C5A2A',
    photo: 'assets/drinks/dark-and-stormy.png',
  },

  // THE SOURS
  {
    id: 'margarita',
    name: 'Margarita',
    tagline: 'Tequila, lime, salt — done.',
    category: 'sours',
    glassType: 'margarita',
    ingredients: [
      { name: 'tequila', volumeOz: 1.5 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'triple-sec', volumeOz: 0.75 },
    ],
    garnish: 'salt-rim-lime',
    color: '#C8E88A',
    photo: 'assets/drinks/margarita.png',
  },
  {
    id: 'tommys-margarita',
    name: 'Tommy\'s Margarita',
    tagline: 'Agave-forward perfection.',
    category: 'sours',
    glassType: 'rocks',
    ingredients: [
      { name: 'tequila', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 1 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#D1E892',
    photo: 'assets/drinks/tommys-margarita.png',
  },
  {
    id: 'whiskey-sour',
    name: 'Whiskey Sour',
    tagline: 'Whiskey with a lemony edge.',
    category: 'sours',
    glassType: 'coupe',
    ingredients: [
      { name: 'whiskey', volumeOz: 2 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'lemon-wedge',
    color: '#E8B858',
    photo: 'assets/drinks/whiskey-sour.png',
  },
  {
    id: 'daiquiri',
    name: 'Daiquiri',
    tagline: 'Cuban summer in a coupe.',
    category: 'sours',
    glassType: 'coupe',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    color: '#F0E8C8',
    photo: 'assets/drinks/daiquiri.png',
  },
  {
    id: 'gimlet',
    name: 'Gimlet',
    tagline: 'Gin meets lime, sharply.',
    category: 'sours',
    glassType: 'coupe',
    ingredients: [
      { name: 'gin', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    color: '#B8DCA8',
    photo: 'assets/drinks/gimlet.png',
  },
  {
    id: 'vodka-gimlet',
    name: 'Vodka Gimlet',
    tagline: 'Clean and sharply citrus.',
    category: 'sours',
    glassType: 'coupe',
    ingredients: [
      { name: 'vodka', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    color: '#D5EFC7',
    photo: 'assets/drinks/vodka-gimlet.png',
  },
  {
    id: 'kamikaze',
    name: 'Kamikaze',
    tagline: 'A sharp, sweet shot or sip.',
    category: 'sours',
    glassType: 'rocks',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'triple-sec', volumeOz: 0.75 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#C6E8AD',
    photo: 'assets/drinks/kamikaze.png',
  },
  {
    id: 'lemon-drop',
    name: 'Lemon Drop',
    tagline: 'Like the candy, but better.',
    category: 'sours',
    glassType: 'coupe',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'triple-sec', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.25 },
    ],
    garnish: 'lemon-wedge',
    color: '#F7ED96',
    photo: 'assets/drinks/lemon-drop.png',
  },
  {
    id: 'white-lady',
    name: 'White Lady',
    tagline: 'A delicate gin sour.',
    category: 'sours',
    glassType: 'coupe',
    ingredients: [
      { name: 'gin', volumeOz: 1.5 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'triple-sec', volumeOz: 0.75 },
    ],
    garnish: 'lemon-wedge',
    color: '#F7F3CF',
    photo: 'assets/drinks/white-lady.png',
  },
  {
    id: 'tequila-sour',
    name: 'Tequila Sour',
    tagline: 'Agave with a citrus snap.',
    category: 'sours',
    glassType: 'coupe',
    ingredients: [
      { name: 'tequila', volumeOz: 2 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'lemon-wedge',
    color: '#E8DC8A',
    photo: 'assets/drinks/tequila-sour.png',
  },
  {
    id: 'pink-lady',
    name: 'Pink Lady',
    tagline: 'Pretty in pink, sharp underneath.',
    category: 'sours',
    glassType: 'coupe',
    ingredients: [
      { name: 'gin', volumeOz: 1.5 },
      { name: 'lemon-juice', volumeOz: 0.5 },
      { name: 'grenadine', volumeOz: 0.5 },
    ],
    garnish: 'cherry',
    color: '#F5A8B8',
    photo: 'assets/drinks/pink-lady.png',
  },

  // THE PARTY
  {
    id: 'cosmopolitan',
    name: 'Cosmopolitan',
    tagline: 'Pink, cold, unapologetic.',
    category: 'party',
    glassType: 'coupe',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'cranberry-juice', volumeOz: 1 },
      { name: 'lime-juice', volumeOz: 0.5 },
      { name: 'triple-sec', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    color: '#E85D75',
    photo: 'assets/drinks/cosmopolitan.png',
  },
  {
    id: 'vodka-cranberry',
    name: 'Cape Codder',
    tagline: 'A party classic.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'cranberry-juice', volumeOz: 4.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#C7243A',
    photo: 'assets/drinks/vodka-cranberry.png',
  },
  {
    id: 'madras',
    name: 'Madras',
    tagline: 'Cranberry and orange unite.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'cranberry-juice', volumeOz: 3 },
      { name: 'orange-juice', volumeOz: 2 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#DE4538',
    photo: 'assets/drinks/madras.png',
  },
  {
    id: 'tequila-sunrise',
    name: 'Tequila Sunrise',
    tagline: 'A sunrise over the agave fields.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'tequila', volumeOz: 1.5 },
      { name: 'orange-juice', volumeOz: 4 },
      { name: 'grenadine', volumeOz: 0.5 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#F08840',
    photo: 'assets/drinks/tequila-sunrise.png',
  },
  {
    id: 'long-island-iced-tea',
    name: 'Long Island Iced Tea',
    tagline: 'Five spirits, one regret.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'gin', volumeOz: 0.5 },
      { name: 'vodka', volumeOz: 0.5 },
      { name: 'rum', volumeOz: 0.5 },
      { name: 'tequila', volumeOz: 0.5 },
      { name: 'triple-sec', volumeOz: 0.5 },
      { name: 'lemon-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.25 },
    ],
    garnish: 'lemon-wedge',
    topUp: 'cola',
    needsIce: true,
    color: '#7A4A2A',
    photo: 'assets/drinks/long-island-iced-tea.png',
  },
  {
    id: 'cuba-libre',
    name: 'Cuba Libre',
    tagline: 'Rum, lime, and a long night.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.25 },
    ],
    garnish: 'lime-wedge',
    topUp: 'cola',
    needsIce: true,
    color: '#4A2A1A',
    photo: 'assets/drinks/cuba-libre.png',
  },
  {
    id: 'ward-eight',
    name: 'Ward Eight',
    tagline: 'Boston, ballots, and bourbon.',
    category: 'party',
    glassType: 'coupe',
    ingredients: [
      { name: 'whiskey', volumeOz: 2 },
      { name: 'lemon-juice', volumeOz: 0.5 },
      { name: 'orange-juice', volumeOz: 0.5 },
      { name: 'grenadine', volumeOz: 0.5 },
    ],
    garnish: 'orange-peel',
    color: '#C95838',
    photo: 'assets/drinks/ward-eight.png',
  },
  {
    id: 'hawaiian-cocktail',
    name: 'Hawaiian Cocktail',
    tagline: 'Pineapple sunshine in a glass.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'gin', volumeOz: 1.5 },
      { name: 'pineapple-juice', volumeOz: 2 },
      { name: 'orange-juice', volumeOz: 1 },
      { name: 'grenadine', volumeOz: 0.25 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#F08840',
    photo: 'assets/drinks/hawaiian-cocktail.png',
  },
  {
    id: 'sex-on-the-beach',
    name: 'Sex on the Beach',
    tagline: 'Sunset, surf, and zero subtlety.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'cranberry-juice', volumeOz: 2 },
      { name: 'orange-juice', volumeOz: 2 },
      { name: 'grenadine', volumeOz: 0.5 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#E84A4A',
    photo: 'assets/drinks/sex-on-the-beach.png',
  },

  // CYBERPUNK 2077 — Afterlife canon. Machine pours the base; the user
  // tops these off with the post-pour ingredient noted in the garnish.
  {
    id: 'johnny-silverhand',
    name: 'Johnny Silverhand',
    tagline: 'Tequila, fire, silver.',
    category: 'party',
    glassType: 'rocks',
    ingredients: [
      { name: 'tequila', volumeOz: 2 },
      { name: 'simple-syrup', volumeOz: 0.25 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: 'chili-rim',
    topUp: 'mexican-beer',
    needsIce: true,
    color: '#B8763A',
    photo: 'assets/drinks/johnny-silverhand.png',
  },
  {
    id: 'jackie-welles',
    name: 'Jackie Welles',
    tagline: 'Vodka, lime, ginger… and a splash of love.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'grenadine', volumeOz: 0.25 },
    ],
    garnish: null,
    topUp: 'ginger-beer',
    needsIce: true,
    color: '#F0A8A8',
    photo: 'assets/drinks/jackie-welles.png',
  },
  {
    id: 'david-martinez',
    name: 'David Martinez',
    tagline: "An edgerunner's last drink.",
    category: 'party',
    glassType: 'rocks',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'lemon-juice', volumeOz: 0.5 },
    ],
    garnish: null,
    topUp: 'cola',
    needsIce: true,
    color: '#4A2818',
    photo: 'assets/drinks/david-martinez.png',
  },
  {
    id: 'trauma-team',
    name: 'Trauma Team',
    tagline: 'Platinum coverage, in a glass.',
    category: 'party',
    glassType: 'rocks',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'cranberry-juice', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.5 },
      { name: 'grenadine', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#C8202A',
    photo: 'assets/drinks/trauma-team.png',
  },
  {
    id: 'rogue',
    name: 'Rogue',
    tagline: "Afterlife's queen takes her whiskey straight.",
    category: 'party',
    glassType: 'rocks',
    ingredients: [
      { name: 'whiskey', volumeOz: 1.5 },
      { name: 'sweet-vermouth', volumeOz: 0.5 },
      { name: 'triple-sec', volumeOz: 0.25 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#8C3A1A',
    photo: 'assets/drinks/rogue.png',
  },
  {
    id: 'adam-smasher',
    name: 'Adam Smasher',
    tagline: 'Heavy chrome, heavier hand.',
    category: 'party',
    glassType: 'rocks',
    ingredients: [
      { name: 'whiskey', volumeOz: 2 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: null,
    topUp: 'cola',
    needsIce: true,
    color: '#3A2818',
    photo: 'assets/drinks/adam-smasher.png',
  },

  // CYBERPUNK 2077 — Night City inspired (themed inventions, not canon).
  {
    id: 'night-city-sunrise',
    name: 'Night City Sunrise',
    tagline: 'Neon glass over the Badlands.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'tequila', volumeOz: 1.5 },
      { name: 'orange-juice', volumeOz: 4 },
      { name: 'cranberry-juice', volumeOz: 1 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#F08040',
    photo: 'assets/drinks/night-city-sunrise.png',
  },
  {
    id: 'blackwall',
    name: 'Blackwall',
    tagline: 'Cross at your own risk.',
    category: 'party',
    glassType: 'rocks',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'cranberry-juice', volumeOz: 3 },
      { name: 'lime-juice', volumeOz: 0.5 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#5A1820',
    photo: 'assets/drinks/blackwall.png',
  },
  {
    id: 'chrome',
    name: 'Chrome',
    tagline: 'Clean lines, sharper edges.',
    category: 'party',
    glassType: 'highball',
    ingredients: [
      { name: 'vodka', volumeOz: 1.5 },
      { name: 'triple-sec', volumeOz: 0.5 },
      { name: 'lime-juice', volumeOz: 0.5 },
      { name: 'soda', volumeOz: 3 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#E0EAEC',
    photo: 'assets/drinks/chrome.png',
  },
  {
    id: 'the-relic',
    name: 'The Relic',
    tagline: 'An engram you can taste.',
    category: 'party',
    glassType: 'coupe',
    ingredients: [
      { name: 'rum', volumeOz: 1.5 },
      { name: 'triple-sec', volumeOz: 0.5 },
      { name: 'lime-juice', volumeOz: 0.5 },
      { name: 'cranberry-juice', volumeOz: 1 },
    ],
    garnish: 'lime-wedge',
    color: '#D63A8C',
    photo: 'assets/drinks/the-relic.png',
  },

  // THE TIKI
  {
    id: 'mai-tai',
    name: 'Mai Tai',
    tagline: 'Rum, almond, and a sunset.',
    category: 'tiki',
    glassType: 'rocks',
    ingredients: [
      { name: 'rum', volumeOz: 1.5 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'orgeat', volumeOz: 0.5 },
      { name: 'triple-sec', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#D9803C',
    photo: 'assets/drinks/mai-tai.png',
  },
  {
    id: 'pina-colada',
    name: 'Piña Colada',
    tagline: 'Coconut, pineapple, paradise.',
    category: 'tiki',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'pineapple-juice', volumeOz: 3 },
      { name: 'coconut-cream', volumeOz: 1 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#F4ECD8',
    photo: 'assets/drinks/pina-colada.png',
  },
  {
    id: 'hurricane',
    name: 'Hurricane',
    tagline: 'A storm in a tall glass.',
    category: 'tiki',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 1 },
      { name: 'orange-juice', volumeOz: 1 },
      { name: 'grenadine', volumeOz: 0.5 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#E84A2A',
    photo: 'assets/drinks/hurricane.png',
  },
  {
    id: 'painkiller',
    name: 'Painkiller',
    tagline: 'Rum, juice, and instant relief.',
    category: 'tiki',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'pineapple-juice', volumeOz: 4 },
      { name: 'orange-juice', volumeOz: 1 },
      { name: 'coconut-cream', volumeOz: 1 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#EE9C45',
    photo: 'assets/drinks/painkiller.png',
  },
  {
    id: 'jungle-bird',
    name: 'Jungle Bird',
    tagline: 'Bitter Campari hides in the canopy.',
    category: 'tiki',
    glassType: 'rocks',
    ingredients: [
      { name: 'rum', volumeOz: 1.5 },
      { name: 'campari', volumeOz: 0.75 },
      { name: 'pineapple-juice', volumeOz: 1.5 },
      { name: 'lime-juice', volumeOz: 0.5 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#B8462E',
    photo: 'assets/drinks/jungle-bird.png',
  },
  {
    id: 'zombie',
    name: 'Zombie',
    tagline: 'Strong enough to raise the dead.',
    category: 'tiki',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 1.5 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'pineapple-juice', volumeOz: 1.5 },
      { name: 'grenadine', volumeOz: 0.5 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#E0552B',
    photo: 'assets/drinks/zombie.png',
  },
  {
    id: 'bahama-mama',
    name: 'Bahama Mama',
    tagline: 'Bright island sunshine.',
    category: 'tiki',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 1.5 },
      { name: 'pineapple-juice', volumeOz: 2 },
      { name: 'orange-juice', volumeOz: 1 },
      { name: 'grenadine', volumeOz: 0.5 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#EA6E32',
    photo: 'assets/drinks/bahama-mama.png',
  },
  {
    id: 'navy-grog',
    name: 'Navy Grog',
    tagline: 'A sailor’s ration, civilised.',
    category: 'tiki',
    glassType: 'rocks',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'orange-juice', volumeOz: 0.75 },
      { name: 'simple-syrup', volumeOz: 0.5 },
    ],
    garnish: 'lime-wedge',
    needsIce: true,
    color: '#C97A3A',
    photo: 'assets/drinks/navy-grog.png',
  },
  {
    id: 'planters-punch',
    name: "Planter's Punch",
    tagline: 'Old Caribbean, full sail.',
    category: 'tiki',
    glassType: 'highball',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'orange-juice', volumeOz: 1 },
      { name: 'lime-juice', volumeOz: 0.75 },
      { name: 'grenadine', volumeOz: 0.5 },
      { name: 'simple-syrup', volumeOz: 0.25 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: 'orange-peel',
    needsIce: true,
    color: '#D2542A',
    photo: 'assets/drinks/planters-punch.png',
  },
  {
    id: 'suffering-bastard',
    name: 'Suffering Bastard',
    tagline: 'Cairo cure for last night.',
    category: 'tiki',
    glassType: 'highball',
    ingredients: [
      { name: 'whiskey', volumeOz: 1 },
      { name: 'gin', volumeOz: 1 },
      { name: 'lime-juice', volumeOz: 0.5 },
      { name: 'bitters', volumeOz: 0.1 },
    ],
    garnish: 'orange-peel',
    topUp: 'ginger-beer',
    needsIce: true,
    color: '#C97A3A',
    photo: 'assets/drinks/suffering-bastard.png',
  },
  {
    id: 'mary-pickford',
    name: 'Mary Pickford',
    tagline: 'Silent-era Havana glamour.',
    category: 'tiki',
    glassType: 'coupe',
    ingredients: [
      { name: 'rum', volumeOz: 2 },
      { name: 'pineapple-juice', volumeOz: 1 },
      { name: 'grenadine', volumeOz: 0.25 },
    ],
    garnish: 'cherry',
    color: '#E88A8A',
    photo: 'assets/drinks/mary-pickford.png',
  },
];

// Live drinks array. Starts as a copy of SEED_DRINKS so synchronous readers
// work before the backend fetch resolves; `replaceDrinks()` swaps in the
// canonical list from /api/drinks (frontend) or drinks.json (backend).
// Mutations are in-place so existing `import { drinks }` consumers see
// updates without re-importing.
export const drinks = [...SEED_DRINKS];

export function replaceDrinks(newDrinks) {
  drinks.length = 0;
  for (const d of newDrinks) drinks.push(d);
}

// Helper functions

// `enabled` defaults true so legacy records and the seed list stay visible.
// Only an explicit `false` hides a drink from the main UI. Admin tabs read
// the raw `drinks` array so disabled drinks remain editable.
export const isDrinkEnabled = (drink) => drink && drink.enabled !== false;

// Main-UI helpers filter by `enabled` (and the live category-disabled set
// pulled in here to avoid every call site importing the store). Imported
// indirectly so this module stays consumable by the server too — see the
// guard in lookupCategoryEnabled below.
let categoryEnabledLookup = () => true;
export function setCategoryEnabledLookup(fn) {
  categoryEnabledLookup = typeof fn === "function" ? fn : () => true;
}
function isVisible(drink) {
  return isDrinkEnabled(drink) && categoryEnabledLookup(drink.category);
}

export const getDrinksByCategory = (categoryId) =>
  drinks.filter((d) => d.category === categoryId && isVisible(d));

export const getDrinkById = (id) => drinks.find((d) => d.id === id);

export const getCategoryById = (id) => categories.find((c) => c.id === id);

export const searchDrinks = (query) => {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return drinks.filter((d) => {
    if (!isVisible(d)) return false;
    const nameMatch = d.name.toLowerCase().includes(q);
    const ingredientMatch = d.ingredients.some((i) =>
      i.name.toLowerCase().includes(q)
    );
    return nameMatch || ingredientMatch;
  });
};

// Strength shifts the *ratio* of primary spirit to modifiers while keeping the
// total volume constant. Stronger pulls volume from the modifiers into the
// primary; lighter pushes the other way. Total oz dispensed stays the same.
//
// Convention: ingredients[0] is the primary spirit (true for every drink in
// this file). Modifiers are the remaining ingredients combined.
//
// Clamps:
//   - Modifier total stays at ≥ 0.1 oz or 10% of original (whichever is larger),
//     so Martini-like drinks don't have their vermouth scaled to zero on "strong".
//   - Each individual modifier gets a 0.05 oz floor after rounding, so trace
//     ingredients (e.g. Old Fashioned bitters) don't disappear entirely.
//   - Any rounding drift is absorbed into the primary so the total is exact.
export function adjustedIngredients(drink, strength, amount = 1.0) {
  const ings = drink.ingredients;
  let out;
  
  if (strength === 'regular' || ings.length < 2) {
    out = ings.map((i) => ({ ...i }));
  } else {
    const factor = strength === 'light' ? 0.7 : 1.3;
    const total = ings.reduce((s, i) => s + i.volumeOz, 0);
    const restTotal = total - ings[0].volumeOz;
    const minRest = Math.min(restTotal, Math.max(0.1, restTotal * 0.1));
    const maxPrimary = Math.max(0.1, total - minRest);

    let newPrimary = ings[0].volumeOz * factor;
    newPrimary = Math.min(newPrimary, maxPrimary);
    newPrimary = Math.max(newPrimary, 0.1);

    const restFactor = restTotal > 0 ? (total - newPrimary) / restTotal : 1;

    out = ings.map((ing, i) => {
      if (i === 0) return { ...ing, volumeOz: Number(newPrimary.toFixed(1)) };
      return {
        ...ing,
        volumeOz: Math.max(0.1, Number((ing.volumeOz * restFactor).toFixed(1))),
      };
    });

    // Absorb rounding drift into the primary so the total matches the original.
    const drift = total - out.reduce((s, i) => s + i.volumeOz, 0);
    out[0].volumeOz = Math.max(0.1, Number((out[0].volumeOz + drift).toFixed(1)));
  }

  // Scale by amount and round to nearest 0.1
  if (amount !== 1.0) {
    out = out.map((ing) => ({
      ...ing,
      volumeOz: Number((ing.volumeOz * amount).toFixed(1)),
    }));
  } else {
    out = out.map((ing) => ({
      ...ing,
      volumeOz: Number(ing.volumeOz.toFixed(1)),
    }));
  }

  return out;
}

export const totalVolumeOz = (ingredients) =>
  ingredients.reduce((s, i) => s + i.volumeOz, 0);

// Setup overhead — shaker prep, glass placement, valve cycle. Tuned by
// observation; not currently calibrated.
export const POUR_SETUP_SECONDS = 15;

// Default flow rate when no slot calibration exists. 0.25 oz/sec ≈ 4 s/oz,
// the constant the codebase used before per-slot calibration. Kept in sync
// with src/server/calibration.js so frontend and backend agree on the
// "uncalibrated" baseline.
export const DEFAULT_FLOW_OZ_PER_SEC = 0.25;

// Per-ingredient pump time, summed. `flowRateForIngredient(name)` returns
// oz/sec for the slot holding that ingredient, or undefined to fall back to
// `defaultFlowOzPerSec`. Pass nothing to get the default-rate estimate.
export function estimatePourBodySeconds(ingredients, opts = {}) {
  const {
    flowRateForIngredient,
    defaultFlowOzPerSec = DEFAULT_FLOW_OZ_PER_SEC,
  } = opts;
  let seconds = 0;
  for (const ing of ingredients) {
    const rate = flowRateForIngredient ? flowRateForIngredient(ing.name) : null;
    const useRate = Number.isFinite(rate) && rate > 0 ? rate : defaultFlowOzPerSec;
    seconds += ing.volumeOz / useRate;
  }
  return seconds;
}

// Pour-time estimate in seconds: setup overhead + per-ingredient pump time.
// `opts.flowRateForIngredient` lets the caller plug in calibrated per-slot
// rates (see calibration-store.js on the frontend, calibration.js on the
// server); when omitted the legacy constant rate is used.
export function estimatePourSeconds(drink, strength, amount = 1.0, opts = {}) {
  const adjusted = adjustedIngredients(drink, strength, amount);
  return Math.round(POUR_SETUP_SECONDS + estimatePourBodySeconds(adjusted, opts));
}
