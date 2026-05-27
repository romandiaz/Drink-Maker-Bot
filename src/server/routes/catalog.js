// The drink catalog: persisted user drinks, categories, and the per-ingredient
// attribute store (ABV, bottle size, cost).
import { readJsonBody, jsonRoute } from "../http-util.js";
import * as drinksStore from "../drinks-store.js";
import * as categoriesStore from "../categories-store.js";
import * as ingredientsStore from "../ingredients-store.js";

export async function catalogRoutes(req, res, urlPath) {
  // --- Ingredients ---
  if (urlPath === "/api/ingredients" && req.method === "GET") {
    await jsonRoute(res, () => ingredientsStore.load());
    return true;
  }
  const ingredientMatch = urlPath.match(/^\/api\/ingredients\/([^/]+)$/);
  if (ingredientMatch && req.method === "PUT") {
    await jsonRoute(res, async () =>
      ingredientsStore.updateAttributes(ingredientMatch[1], await readJsonBody(req))
    );
    return true;
  }
  if (ingredientMatch && req.method === "DELETE") {
    await jsonRoute(res, () => ingredientsStore.remove(ingredientMatch[1]));
    return true;
  }

  // --- Drinks ---
  if (urlPath === "/api/drinks" && req.method === "GET") {
    await jsonRoute(res, () => drinksStore.load());
    return true;
  }
  if (urlPath === "/api/drinks" && req.method === "POST") {
    await jsonRoute(res, async () => drinksStore.create(await readJsonBody(req)), {
      status: 201,
    });
    return true;
  }
  const drinkMatch = urlPath.match(/^\/api\/drinks\/([^/]+)$/);
  if (drinkMatch && req.method === "PUT") {
    await jsonRoute(res, async () =>
      drinksStore.update(drinkMatch[1], await readJsonBody(req))
    );
    return true;
  }
  if (drinkMatch && req.method === "DELETE") {
    await jsonRoute(res, () => drinksStore.remove(drinkMatch[1]));
    return true;
  }
  // Cheap toggle endpoint — avoids re-validating the entire drink record on
  // an enable/disable flip. Body: { enabled: bool }.
  const drinkEnabledMatch = urlPath.match(/^\/api\/drinks\/([^/]+)\/enabled$/);
  if (drinkEnabledMatch && req.method === "PUT") {
    await jsonRoute(res, async () => {
      const body = await readJsonBody(req);
      return drinksStore.setEnabled(drinkEnabledMatch[1], body.enabled);
    });
    return true;
  }

  // --- Categories ---
  if (urlPath === "/api/categories" && req.method === "GET") {
    await jsonRoute(res, () => categoriesStore.load());
    return true;
  }
  if (urlPath === "/api/categories" && req.method === "PUT") {
    await jsonRoute(res, async () => categoriesStore.save(await readJsonBody(req)));
    return true;
  }

  return false;
}
