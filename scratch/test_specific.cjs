const fs = require('fs');

const extendedDrinks = [
  // CLASSICS
  { id: 'martini', ing: ['gin', 'vermouth'] },
  { id: 'manhattan', ing: ['whiskey', 'sweet-vermouth', 'bitters'] },
  { id: 'negroni', ing: ['gin', 'campari', 'sweet-vermouth'] },
  { id: 'old-fashioned', ing: ['whiskey', 'simple-syrup', 'bitters'] },
  { id: 'boulevardier', ing: ['whiskey', 'campari', 'sweet-vermouth'] },
  { id: 'americano', ing: ['campari', 'sweet-vermouth', 'soda'] },
  { id: 'bronx', ing: ['gin', 'sweet-vermouth', 'vermouth', 'orange-juice'] },
  { id: 'garibaldi', ing: ['campari', 'orange-juice'] },
  
  // REFRESHERS
  { id: 'gin-tonic', ing: ['gin', 'tonic'] },
  { id: 'vodka-tonic', ing: ['vodka', 'tonic'] },
  { id: 'tequila-tonic', ing: ['tequila', 'tonic'] },
  { id: 'rum-tonic', ing: ['rum', 'tonic'] },
  { id: 'cuba-libre', ing: ['rum', 'cola', 'lime-juice'] },
  { id: 'vodka-soda', ing: ['vodka', 'soda'] },
  { id: 'tom-collins', ing: ['gin', 'lemon-juice', 'simple-syrup', 'soda'] },
  { id: 'john-collins', ing: ['whiskey', 'lemon-juice', 'simple-syrup', 'soda'] },
  { id: 'vodka-collins', ing: ['vodka', 'lemon-juice', 'simple-syrup', 'soda'] },
  { id: 'tequila-collins', ing: ['tequila', 'lemon-juice', 'simple-syrup', 'soda'] },
  { id: 'whiskey-highball', ing: ['whiskey', 'soda'] },
  { id: 'gin-rickey', ing: ['gin', 'lime-juice', 'soda'] },
  { id: 'vodka-cranberry', ing: ['vodka', 'cranberry-juice'] },
  { id: 'greyhound', ing: ['vodka', 'grapefruit-juice'] },
  { id: 'screwdriver', ing: ['vodka', 'orange-juice'] },
  { id: 'tequila-soda', ing: ['tequila', 'soda'] },
  { id: 'whiskey-cola', ing: ['whiskey', 'cola'] },
  
  // SOURS
  { id: 'margarita', ing: ['tequila', 'lime-juice', 'triple-sec'] },
  { id: 'tommys-margarita', ing: ['tequila', 'lime-juice', 'simple-syrup'] },
  { id: 'whiskey-sour', ing: ['whiskey', 'lemon-juice', 'simple-syrup'] },
  { id: 'daiquiri', ing: ['rum', 'lime-juice', 'simple-syrup'] },
  { id: 'gimlet', ing: ['gin', 'lime-juice', 'simple-syrup'] },
  { id: 'vodka-gimlet', ing: ['vodka', 'lime-juice', 'simple-syrup'] },
  { id: 'kamikaze', ing: ['vodka', 'lime-juice', 'triple-sec'] },
  { id: 'lemon-drop', ing: ['vodka', 'lemon-juice', 'triple-sec', 'simple-syrup'] },
  { id: 'brown-derby', ing: ['whiskey', 'grapefruit-juice', 'simple-syrup'] },
  { id: 'paloma-cheat', ing: ['tequila', 'grapefruit-juice', 'lime-juice', 'soda', 'simple-syrup'] },
  { id: 'white-lady', ing: ['gin', 'lemon-juice', 'triple-sec'] },

  // PARTY / SWEET
  { id: 'cosmopolitan', ing: ['vodka', 'cranberry-juice', 'lime-juice', 'triple-sec'] },
  { id: 'tequila-sunrise', ing: ['tequila', 'orange-juice', 'grenadine'] },
  { id: 'sea-breeze', ing: ['vodka', 'cranberry-juice', 'grapefruit-juice'] },
  { id: 'long-island', ing: ['vodka', 'gin', 'rum', 'tequila', 'triple-sec', 'lemon-juice', 'cola'] },
  { id: 'madras', ing: ['vodka', 'cranberry-juice', 'orange-juice'] },
];

const testSet = new Set(['vodka', 'gin', 'rum', 'tequila', 'whiskey', 'vermouth', 'sweet-vermouth', 'campari', 'simple-syrup', 'bitters', 'lime-juice', 'lemon-juice', 'soda', 'triple-sec', 'cranberry-juice', 'orange-juice']);

let possibleDrinks = [];
for (const d of extendedDrinks) {
    if (d.ing.every(i => testSet.has(i))) {
        possibleDrinks.push(d.id);
    }
}
console.log("Total drinks:", possibleDrinks.length);
console.log(possibleDrinks.join(', '));
