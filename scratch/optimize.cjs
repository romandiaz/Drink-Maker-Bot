const fs = require('fs');

const drinksText = fs.readFileSync('drinks.js', 'utf8');

const drinks = [
  { id: 'martini', ing: ['gin', 'vermouth'] },
  { id: 'manhattan', ing: ['whiskey', 'sweet-vermouth', 'bitters'] },
  { id: 'negroni', ing: ['gin', 'campari', 'sweet-vermouth'] },
  { id: 'old-fashioned', ing: ['bourbon', 'simple-syrup', 'bitters'] },
  { id: 'gin-tonic', ing: ['gin', 'tonic'] },
  { id: 'cuba-libre', ing: ['rum', 'cola', 'lime-juice'] },
  { id: 'vodka-soda', ing: ['vodka', 'soda'] },
  { id: 'tom-collins', ing: ['gin', 'lemon-juice', 'simple-syrup', 'soda'] },
  { id: 'margarita', ing: ['tequila', 'lime-juice', 'triple-sec'] },
  { id: 'whiskey-sour', ing: ['whiskey', 'lemon-juice', 'simple-syrup'] },
  { id: 'daiquiri', ing: ['rum', 'lime-juice', 'simple-syrup'] },
  { id: 'gimlet', ing: ['gin', 'lime-juice', 'simple-syrup'] },
  { id: 'cosmopolitan', ing: ['vodka', 'cranberry-juice', 'lime-juice', 'triple-sec'] },
  { id: 'tequila-sunrise', ing: ['tequila', 'orange-juice', 'grenadine'] },
  { id: 'sea-breeze', ing: ['vodka', 'cranberry-juice', 'grapefruit-juice'] },
  { id: 'screwdriver', ing: ['vodka', 'orange-juice'] },
];

const COMBINE_WHISKEY = true;
if (COMBINE_WHISKEY) {
    drinks.forEach(d => {
        d.ing = d.ing.map(i => i === 'bourbon' ? 'whiskey' : i);
    });
}

const allIngredients = [...new Set(drinks.flatMap(d => d.ing))];

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

const dropCount = allIngredients.length - 16;
const subsetsToDrop = getSubsets(allIngredients, dropCount);

let results = [];

const REQUIRED_DRINKS = ['martini', 'manhattan', 'negroni', 'old-fashioned'];
// find required ingredients
const reqIngs = new Set();
for (const d of drinks) {
    if (REQUIRED_DRINKS.includes(d.id)) {
        d.ing.forEach(i => reqIngs.add(i));
    }
}

for (const drop of subsetsToDrop) {
    const keep = new Set(allIngredients.filter(i => !drop.includes(i)));
    let validDrop = true;
    for (const d of drop) {
        if (reqIngs.has(d)) validDrop = false;
    }
    if (!validDrop) continue;

    let possibleDrinks = [];
    for (const d of drinks) {
        if (d.ing.every(i => keep.has(i))) {
            possibleDrinks.push(d.id);
        }
    }
    results.push({
        numDrinks: possibleDrinks.length,
        drinks: possibleDrinks,
        kept: [...keep],
        dropped: drop
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
        console.log("Drinks:", res.drinks.join(', '));
        console.log("Dropped Ingredients:", res.dropped.join(', '));
        printed++;
        if (printed >= 5) break;
    }
}
