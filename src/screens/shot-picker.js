import { navigate } from "../app.js";
import { shotIngredients, buildShotDrink } from "../drinks.js";
import { header } from "../components/header.js";
import { glass } from "../components/glass.js";
import { ingredientName } from "../ingredients.js";
import {
  loadInventory,
  remainingForIngredient,
  assignedIngredientIds,
} from "../inventory-store.js";

// Smallest pour the shot-detail screen will let you commit to. Anything below
// this is effectively "out" — the tile blocks the tap rather than dropping the
// user into a screen that just disables the pour button.
const MIN_POURABLE_OZ = 0.25;

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

  // Stock state drives both the meta line and tappability. Unknown stock
  // (Infinity, before first inventory load) defaults to "ok" so the picker
  // doesn't flash everything as empty during boot.
  const remaining = remainingForIngredient(ing.id);
  const stockKnown = Number.isFinite(remaining);
  const isOut = stockKnown && remaining < MIN_POURABLE_OZ;
  const isLow = stockKnown && !isOut && remaining < ing.defaultOz;

  if (isOut) {
    tile.classList.add("is-unavailable");
    tile.disabled = true;
    meta.textContent = "Empty — refill to pour";
  } else if (isLow) {
    meta.textContent = `${remaining.toFixed(1)} oz left`;
  } else {
    meta.textContent = `${ing.defaultOz.toFixed(1)} oz default`;
  }

  text.append(name, meta);
  tile.appendChild(text);

  if (!isOut) {
    tile.addEventListener("click", () => {
      navigate("shotDetail", { ingredientId: ing.id });
    });
  }

  return tile;
}

export function shotPicker() {
  const element = document.createElement("section");
  element.className = "screen";
  element.dataset.screen = "shotPicker";

  const headerSlot = document.createElement("div");
  const grid = document.createElement("div");
  grid.className = "shot-grid";

  // Only spirits physically assigned to a pump slot belong in the picker —
  // there are more shot ingredients than slots, so the rest are never pourable.
  // Before the first inventory load the assigned set is empty; fall back to the
  // full list then so the grid doesn't flash blank on boot, the same permissive
  // cold-boot default the inventory store uses elsewhere.
  function visibleIngredients() {
    const assigned = assignedIngredientIds();
    if (assigned.size === 0) return shotIngredients;
    return shotIngredients.filter((ing) => assigned.has(ing.id));
  }

  function availableCount() {
    return visibleIngredients().filter((ing) => {
      const r = remainingForIngredient(ing.id);
      return !Number.isFinite(r) || r >= MIN_POURABLE_OZ;
    }).length;
  }

  function render() {
    headerSlot.innerHTML = "";
    headerSlot.appendChild(
      header({
        eyebrow: "Category 05",
        eyebrowAccent: "var(--accent-shots)",
        title: "The Shots",
        search: true,
        onSearch: () => navigate("search"),
        right: { count: `${availableCount()} spirits` },
      })
    );
    grid.innerHTML = "";
    for (const ing of visibleIngredients()) grid.appendChild(shotTile(ing));
  }

  element.appendChild(headerSlot);
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

  // Snapshot of remaining oz per spirit, so a no-op refresh after the inventory
  // arrives doesn't trigger a re-render on a screen with no real changes.
  function stockSignature() {
    return shotIngredients
      .map((ing) => `${ing.id}:${remainingForIngredient(ing.id)}`)
      .join("|");
  }

  render();
  return {
    element,
    mount() {
      // Same race as detail/shot-detail: the post-pour inventory fetch may not
      // have landed yet when the user lands here. Refresh and re-render if the
      // signature changed so empty bottles surface immediately.
      const before = stockSignature();
      loadInventory().then(() => {
        if (stockSignature() !== before) render();
      });
    },
    unmount() {},
  };
}
