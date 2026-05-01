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
  { id: 'calimocho', ing: ['red-wine', 'cola'] }, // wait we don't have wine
  
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
  { id: 'bay-breeze', ing: ['vodka', 'cranberry-juice', 'pineapple-juice'] }, // no pineapple
];

const allIngredients = [...new Set(extendedDrinks.flatMap(d => d.ing))];

function getSubsets(array, size) {
    let result = [];
    function backtrack(start, currentSubset) {
        if (currentSubset.length === size) {
            result.push([...currentSubset]);
            return;
        }
        for (let i = start; i < array.length; i++) {
            currentSubset.push(array[i]);
            backtrack(i + 1, currentSubset);
            currentSubset.pop();
        }
    }
    backtrack(0, []);
    return result;
}

const targetCount = 16;
// Limit search space: Spirits are usually required. Let's assume we keep the 5 main spirits.
const mustKeep = ['vodka', 'gin', 'rum', 'tequila', 'whiskey', 'simple-syrup', 'lime-juice'];
const remainingToPick = allIngredients.filter(i => !mustKeep.includes(i));
const pickCount = targetCount - mustKeep.length;

console.log("Must keep:", mustKeep);
console.log("Remaining available:", remainingToPick);
console.log("Need to pick:", pickCount);

const subsetsToPick = getSubsets(remainingToPick, pickCount);

let results = [];

for (const pick of subsetsToPick) {
    const keep = new Set([...mustKeep, ...pick]);
    let possibleDrinks = [];
    for (const d of extendedDrinks) {
        if (d.ing.every(i => keep.has(i))) {
            possibleDrinks.push(d.id);
        }
    }
    results.push({
        numDrinks: possibleDrinks.length,
        drinks: possibleDrinks,
        kept: [...keep],
    });
}

results.sort((a, b) => b.numDrinks - a.numDrinks);

// Get unique top combinations
let printed = 0;
let seen = new Set();
for (const res of results) {
    const key = res.drinks.sort().join(',');
    if (!seen.has(key)) {
        seen.add(key);
        console.log(`\nOption ${printed + 1} (${res.numDrinks} drinks)`);
        console.log("Ingredients:", res.kept.join(', '));
        console.log("Drinks:", res.drinks.join(', '));
        printed++;
        if (printed >= 5) break;
    }
}
