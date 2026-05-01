import { navigate } from "../app.js";
import { shotIngredients, buildShotDrink } from "../drinks.js";
import { header } from "../components/header.js";
import { glass } from "../components/glass.js";
import { ingredientName } from "../ingredients.js";

function shotTile(ing) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "shot-tile tappable";

  const glow = document.createElement("div");
  glow.className = "shot-tile__glow";
  tile.appendChild(glow);

  const glassWrap = document.createElement("div");
  glassWrap.className = "shot-tile__glass";
  // Render a filled shot glass preview at the ingredient's default pour.
  const displayName = ingredientName(ing.id);
  const preview = buildShotDrink(ing.id, ing.defaultOz, displayName);
  glassWrap.appendChild(glass(preview, { width: 52 }));
  tile.appendChild(glassWrap);

  const text = document.createElement("div");
  text.className = "shot-tile__text";
  const name = document.createElement("div");
  name.className = "shot-tile__name";
  name.textContent = displayName;
  const meta = document.createElement("div");
  meta.className = "shot-tile__meta";
  meta.textContent = `${ing.defaultOz.toFixed(1)} oz default`;
  text.append(name, meta);
  tile.appendChild(text);

  tile.addEventListener("click", () => {
    navigate("shotDetail", { ingredientId: ing.id });
  });

  return tile;
}

export function shotPicker() {
  const element = document.createElement("section");
  element.className = "screen";
  element.dataset.screen = "shotPicker";

  element.appendChild(
    header({
      onBack: () => navigate("category", {}, "pop"),
      eyebrow: "Category 05",
      eyebrowAccent: "var(--accent-shots)",
      title: "The Shots",
      search: true,
      onSearch: () => navigate("search"),
      right: { count: `${shotIngredients.length} spirits` },
    })
  );

  const grid = document.createElement("div");
  grid.className = "shot-grid";
  for (const ing of shotIngredients) grid.appendChild(shotTile(ing));
  element.appendChild(grid);

  const footer = document.createElement("footer");
  footer.className = "screen-footer";
  const meta = document.createElement("span");
  meta.className = "screen-footer__meta";
  meta.textContent = "Pure & direct";
  const hint = document.createElement("span");
  hint.className = "screen-footer__hint";
  hint.textContent = "Tap a spirit to pour →";
  footer.append(meta, hint);
  element.appendChild(footer);

  return { element, mount() {}, unmount() {} };
}
