import { navigate } from "../app.js";
import { categories, getCategoryById, getDrinksByCategory } from "../drinks.js";
import { header } from "../components/header.js";
import { glass } from "../components/glass.js";
import { appState, setCurrentCategory, setSelectedDrink } from "../state.js";
import { isDrinkPourable, isPrimaryLoaded, missingIngredients } from "../inventory-store.js";
import { ingredientName } from "../ingredients.js";
import { formatIngredient } from "../format.js";

// Two visual treatments only:
//   pourable — ingredient list under the name, full-color card.
//   extra    — dimmed/dashed card with a "Needs X" line. Still tappable;
//              the detail screen surfaces the right path (by-hand banner if
//              the primary is loaded, otherwise the missing-ingredients
//              banner with a disabled pour button).
function drinkCard(drink, { extra = false } = {}) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "drink-card tappable";

  const glassWrap = document.createElement("div");
  glassWrap.className = "drink-card__glass";
  glassWrap.appendChild(glass(drink, { width: 88 }));
  card.appendChild(glassWrap);

  const name = document.createElement("div");
  name.className = "drink-card__name";
  name.textContent = drink.name;
  card.appendChild(name);

  if (extra) {
    card.classList.add("is-unavailable");
    const need = document.createElement("div");
    need.className = "drink-card__missing";
    need.textContent = `Needs ${missingIngredients(drink).map(ingredientName).join(", ")}`;
    card.appendChild(need);
  } else {
    const ingredients = document.createElement("div");
    ingredients.className = "drink-card__ingredients";
    const maxListed = 3;
    const names = drink.ingredients.slice(0, maxListed).map((i) => formatIngredient(i.name));
    if (drink.ingredients.length > maxListed) {
      names.push(`+ ${drink.ingredients.length - maxListed} more`);
    }
    ingredients.textContent = names.join(" · ");
    card.appendChild(ingredients);
  }

  card.addEventListener("click", () => {
    setSelectedDrink(drink.id);
    navigate("detail", { drinkId: drink.id });
  });

  return card;
}

function moreDrinksTile(count, onOpen) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "drink-card drink-card--more tappable";

  const big = document.createElement("div");
  big.className = "drink-card__more-count";
  big.textContent = `+${count}`;
  card.appendChild(big);

  const name = document.createElement("div");
  name.className = "drink-card__name";
  name.textContent = count === 1 ? "More drink" : "More drinks";
  card.appendChild(name);

  const sub = document.createElement("div");
  sub.className = "drink-card__ingredients";
  sub.textContent = "with extra steps";
  card.appendChild(sub);

  card.addEventListener("click", onOpen);
  return card;
}

function categoryTabs(currentId, onSelect) {
  const nav = document.createElement("div");
  nav.className = "cat-tabs";
  for (const cat of categories) {
    // Shots is a secondary utility (own pill on the category screen), not a
    // peer of the cocktail categories — keep it out of the tab strip.
    if (cat.id === "shots") continue;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "cat-tab tappable";
    const active = cat.id === currentId;
    if (active) {
      tab.classList.add("is-active");
      tab.setAttribute("aria-current", "page");
    }
    tab.style.setProperty("--accent", cat.accent);
    // Drop the leading "The " for compactness — the descriptor on the left
    // of the footer ("TIMELESS", "TART & BRIGHT") still carries the article.
    tab.textContent = cat.name.replace(/^The /, "");
    tab.addEventListener("click", () => onSelect(cat.id));
    nav.appendChild(tab);
  }
  return nav;
}

export function drinkList(props = {}) {
  let currentId = props.categoryId || appState.currentCategory || categories[0].id;
  // Shots is a separate flow; if someone navigates here with categoryId="shots"
  // (hash deep-link, stale state), send them to the picker instead of rendering
  // an empty grid.
  if (currentId === "shots") {
    setCurrentCategory(currentId);
    queueMicrotask(() => navigate("shotPicker"));
    const empty = document.createElement("section");
    empty.className = "screen";
    empty.dataset.screen = "drinkList";
    return { element: empty, mount() {}, unmount() {} };
  }

  const element = document.createElement("section");
  element.className = "screen";
  element.dataset.screen = "drinkList";

  // Append each extra card directly into the existing grid with a staggered
  // reveal class. Mutating in place (instead of re-rendering) preserves the
  // user's scroll position when they tap the "+N more" tile.
  function revealExtras(grid, extras) {
    extras.forEach((d, i) => {
      const card = drinkCard(d, { extra: true });
      card.classList.add("is-revealing");
      // 35ms × N keeps even a 12-card reveal under ~700ms total.
      card.style.animationDelay = `${i * 35}ms`;
      grid.appendChild(card);
    });
  }

  function render() {
    const cat = getCategoryById(currentId);
    const drinksInCat = getDrinksByCategory(currentId);
    const pourable = [];
    const extras = [];
    for (const d of drinksInCat) {
      if (isDrinkPourable(d)) pourable.push(d);
      else extras.push(d);
    }
    // Within extras, surface manual (primary loaded) before blocked — these
    // are the drinks the user can still pour with by-hand additions, so they
    // deserve the more prominent slot.
    extras.sort((a, b) => Number(!isPrimaryLoaded(a)) - Number(!isPrimaryLoaded(b)));

    element.innerHTML = "";

    element.appendChild(
      header({
        onBack: () => navigate("category", {}, "pop"),
        eyebrow: `Category ${cat.number}`,
        eyebrowAccent: cat.accent,
        title: cat.name,
        search: true,
        onSearch: () => navigate("search"),
        right: { count: `${pourable.length} drinks` },
      })
    );

    const grid = document.createElement("div");
    grid.className = "drink-grid";
    for (const d of pourable) grid.appendChild(drinkCard(d));

    if (extras.length) {
      // Tile mutates the grid in place on tap rather than triggering a re-
      // render — keeping the existing card nodes (and the grid's scrollTop)
      // exactly where they were.
      const tile = moreDrinksTile(extras.length, () => {
        tile.remove();
        revealExtras(grid, extras);
      });
      grid.appendChild(tile);
    }
    element.appendChild(grid);

    const footer = document.createElement("footer");
    footer.className = "screen-footer drink-list-footer";
    const meta = document.createElement("span");
    meta.className = "screen-footer__meta";
    meta.textContent = cat.descriptor;
    const hint = document.createElement("span");
    hint.className = "screen-footer__hint";
    hint.textContent = "Tap a drink to begin →";
    footer.append(meta, categoryTabs(currentId, setCategory), hint);
    element.appendChild(footer);
  }

  function setCategory(id) {
    if (id === currentId) return;
    // Shots is a separate flow, not a drink list — switch screens.
    if (id === "shots") {
      setCurrentCategory(id);
      navigate("shotPicker");
      return;
    }
    currentId = id;
    setCurrentCategory(id);
    render();
  }

  setCurrentCategory(currentId);
  render();

  return { element, mount() {}, unmount() {} };
}
