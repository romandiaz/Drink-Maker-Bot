import { navigate } from "../app.js";
import { getCategoryById, searchDrinks } from "../drinks.js";
import { header, searchField } from "../components/header.js";
import { keyboard } from "../components/keyboard.js";
import { glass } from "../components/glass.js";
import { appState, setSelectedDrink } from "../state.js";
import { isPrimaryLoaded, missingIngredients } from "../inventory-store.js";
import { ingredientName } from "../ingredients.js";

const MAX_RESULTS = 4;

function highlightedName(name, query, accent) {
  const wrap = document.createElement("div");
  wrap.className = "search-result__name";
  const tokens = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    wrap.textContent = name;
    return wrap;
  }
  const lower = name.toLowerCase();

  // Collect every occurrence of every token, then merge overlapping ranges so a
  // multi-word query ("gin t") highlights each matched word in the name.
  const ranges = [];
  for (const t of tokens) {
    for (let from = lower.indexOf(t); from >= 0; from = lower.indexOf(t, from + t.length)) {
      ranges.push([from, from + t.length]);
    }
  }
  if (!ranges.length) {
    wrap.textContent = name;
    return wrap;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let k = 1; k < ranges.length; k++) {
    const last = merged[merged.length - 1];
    if (ranges[k][0] <= last[1]) last[1] = Math.max(last[1], ranges[k][1]);
    else merged.push(ranges[k]);
  }

  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) wrap.appendChild(document.createTextNode(name.slice(pos, s)));
    const span = document.createElement("span");
    span.className = "search-result__match";
    span.style.setProperty("--accent", accent);
    span.textContent = name.slice(s, e);
    wrap.appendChild(span);
    pos = e;
  }
  if (pos < name.length) wrap.appendChild(document.createTextNode(name.slice(pos)));
  return wrap;
}

function searchResultCard(drink, query) {
  const cat = getCategoryById(drink.category);
  const card = document.createElement("button");
  card.type = "button";
  card.className = "search-result tappable";
  card.style.setProperty("--accent", cat.accent);

  const glassWrap = document.createElement("div");
  glassWrap.className = "search-result__glass";
  glassWrap.appendChild(glass(drink, { width: 34 }));
  card.appendChild(glassWrap);

  const info = document.createElement("div");
  info.className = "search-result__info";
  info.appendChild(highlightedName(drink.name, query, cat.accent));

  const missing = missingIngredients(drink);
  const canPourByHand = missing.length > 0 && isPrimaryLoaded(drink);
  const catLabel = document.createElement("div");
  catLabel.className = "search-result__category";
  if (canPourByHand) {
    // Manual-completion result — keep it tappable and label the by-hand count
    // so the result row matches the drink-list grid badge.
    catLabel.classList.add("search-result__byhand");
    catLabel.textContent = `+${missing.length} by hand`;
  } else if (missing.length) {
    // Swap the category tag for the missing-ingredient hint — on a 3-line
    // card the hint is the more actionable label.
    catLabel.classList.add("search-result__missing");
    catLabel.textContent = `Needs ${missing.map(ingredientName).join(", ")}`;
  } else {
    catLabel.textContent = cat.name;
  }
  info.appendChild(catLabel);
  card.appendChild(info);

  if (missing.length && !canPourByHand) {
    card.classList.add("is-unavailable");
    card.disabled = true;
  } else {
    card.addEventListener("click", () => {
      setSelectedDrink(drink.id);
      navigate("detail", { drinkId: drink.id });
    });
  }

  return card;
}

export function search() {
  let query = appState.searchQuery || "";

  const element = document.createElement("section");
  element.className = "screen screen--search";
  element.dataset.screen = "search";

  // Build the persistent shell — only the header and results area swap content per keystroke.
  // The keyboard stays mounted so its shift state persists.
  const headerSlot = document.createElement("div");
  const resultsEl = document.createElement("div");
  resultsEl.className = "search-results";
  const kb = keyboard({
    onLetter: (l) => setQuery(query + l),
    onBackspace: () => setQuery(query.slice(0, -1)),
    onPaste: (text) => setQuery(query + text),
    getValue: () => query,
  });

  element.append(headerSlot, resultsEl, kb);

  function renderHeader() {
    headerSlot.innerHTML = "";
    const matches = query ? searchDrinks(query).length : 0;
    const right = query
      ? { count: `${matches} ${matches === 1 ? "match" : "matches"}` }
      : "none";
    headerSlot.appendChild(
      header({
        centerEl: searchField({ value: query, onClear: () => setQuery("") }),
        right,
      })
    );
  }

  function renderResults() {
    resultsEl.innerHTML = "";
    if (!query) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "Type to search by name or ingredient";
      resultsEl.appendChild(empty);
      return;
    }
    const matches = searchDrinks(query).slice(0, MAX_RESULTS);
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = `No drinks match "${query}". Try an ingredient like "lime" or "gin".`;
      resultsEl.appendChild(empty);
      return;
    }
    for (const d of matches) resultsEl.appendChild(searchResultCard(d, query));
  }

  function setQuery(q) {
    query = q;
    appState.searchQuery = q;
    renderHeader();
    renderResults();
  }

  renderHeader();
  renderResults();

  return {
    element,
    mount() {},
    unmount() {
      appState.searchQuery = "";
    },
  };
}
