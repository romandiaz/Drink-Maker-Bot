import { navigate } from "../app.js";
import {
  categories,
  drinks,
  getDrinksByCategory,
} from "../drinks.js";
import { header } from "../components/header.js";
import { glass } from "../components/glass.js";
import { setCurrentCategory } from "../state.js";
import { isDrinkPourable, loadedIngredientCount, slotCount } from "../inventory-store.js";

function splitName(name) {
  const [first, ...rest] = name.split(" ");
  return [first, rest.join(" ")];
}

function categoryTile(cat) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "category-tile tappable";
  tile.style.setProperty("--accent", cat.accent);

  const glow = document.createElement("div");
  glow.className = "category-tile__glow";
  tile.appendChild(glow);

  const top = document.createElement("div");
  top.className = "category-tile__top";
  const number = document.createElement("span");
  number.className = "category-tile__number";
  number.textContent = cat.number;
  const descriptor = document.createElement("span");
  descriptor.className = "category-tile__descriptor";
  descriptor.textContent = cat.descriptor;
  top.append(number, descriptor);
  tile.appendChild(top);

  const middle = document.createElement("div");
  middle.className = "category-tile__middle";
  const representativeDrink = getDrinksByCategory(cat.id)[0];
  if (representativeDrink) {
    middle.appendChild(glass(representativeDrink, { width: 64 }));
  }
  tile.appendChild(middle);

  const bottom = document.createElement("div");
  bottom.className = "category-tile__bottom";

  const name = document.createElement("div");
  name.className = "category-tile__name";
  const [line1, line2] = splitName(cat.name);
  const l1 = document.createElement("span");
  l1.textContent = line1;
  const l2 = document.createElement("span");
  l2.textContent = line2;
  name.append(l1, l2);
  bottom.appendChild(name);

  const drinksList = document.createElement("div");
  drinksList.className = "category-tile__drinks";
  const maxListed = 3;
  const catDrinks = getDrinksByCategory(cat.id);
  const names = catDrinks.slice(0, maxListed).map((d) => d.name);
  if (catDrinks.length > maxListed) {
    names.push(`+ ${catDrinks.length - maxListed} more`);
  }
  drinksList.textContent = names.join(" · ");
  bottom.appendChild(drinksList);
  tile.appendChild(bottom);

  tile.addEventListener("click", () => {
    setCurrentCategory(cat.id);
    navigate("drinkList", { categoryId: cat.id });
  });

  return tile;
}

// Secondary action: the shots flow is a utility for pouring a single ingredient
// (e.g. "rum and coke" — dispense the rum, user mixes the rest themselves).
// It's not a drink category, so it lives outside the main grid as a pill.
function shotsPill() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "shots-pill tappable";

  const glassSlot = document.createElement("span");
  glassSlot.className = "shots-pill__glass";
  // Inline hex matches --accent-shots — SVG fill attrs don't resolve CSS vars.
  glassSlot.appendChild(glass({ glassType: "shot", color: "#c45060" }, { width: 22 }));
  btn.appendChild(glassSlot);

  const label = document.createElement("span");
  label.className = "shots-pill__label";
  label.textContent = "Just a shot? Pour a single ingredient →";
  btn.appendChild(label);

  btn.addEventListener("click", () => {
    setCurrentCategory("shots");
    navigate("shotPicker");
  });

  return btn;
}

export function category() {
  const element = document.createElement("section");
  element.className = "screen";
  element.dataset.screen = "category";

  element.appendChild(
    header({
      back: false,
      eyebrow: "Station 01",
      title: "Choose a category",
      search: true,
      onSearch: () => navigate("search"),
      right: "ready",
    })
  );

  const grid = document.createElement("div");
  grid.className = "category-grid";
  for (const cat of categories) {
    if (cat.id === "shots") continue;
    grid.appendChild(categoryTile(cat));
  }
  element.appendChild(grid);

  const shotsRow = document.createElement("div");
  shotsRow.className = "category-shots-row";
  shotsRow.appendChild(shotsPill());
  element.appendChild(shotsRow);

  const footer = document.createElement("footer");
  footer.className = "screen-footer";
  const meta = document.createElement("span");
  meta.className = "screen-footer__meta";
  const pourable = drinks.filter(isDrinkPourable).length;
  const slots = slotCount();
  const loaded = loadedIngredientCount();
  const loadedLabel = slots > 0
    ? `${loaded} / ${slots} ingredients loaded`
    : `${loaded} ingredients loaded`;
  meta.textContent = `${pourable} ${pourable === 1 ? "drink" : "drinks"} · ${loadedLabel}`;
  const hint = document.createElement("span");
  hint.className = "screen-footer__hint";
  hint.textContent = "Tap a category →";
  footer.append(meta, hint);
  element.appendChild(footer);

  return { element, mount() {}, unmount() {} };
}
