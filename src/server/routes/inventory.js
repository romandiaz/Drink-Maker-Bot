// Physical-machine state: pump-slot inventory and per-slot flow calibration.
import { readJsonBody, jsonRoute } from "../http-util.js";
import { loadInventory, saveInventory } from "../inventory.js";
import { loadCalibration, saveCalibration, clearSlotRate } from "../calibration.js";

export async function inventoryRoutes(req, res, urlPath) {
  if (urlPath === "/api/inventory" && req.method === "GET") {
    await jsonRoute(res, () => loadInventory());
    return true;
  }
  if (urlPath === "/api/inventory" && req.method === "PUT") {
    await jsonRoute(res, async () => saveInventory(await readJsonBody(req)));
    return true;
  }

  if (urlPath === "/api/calibration" && req.method === "GET") {
    await jsonRoute(res, () => loadCalibration());
    return true;
  }
  if (urlPath === "/api/calibration" && req.method === "PUT") {
    await jsonRoute(res, async () => saveCalibration(await readJsonBody(req)));
    return true;
  }
  const calSlotMatch = urlPath.match(/^\/api\/calibration\/slot\/(\d+)$/);
  if (calSlotMatch && req.method === "DELETE") {
    await jsonRoute(res, () => clearSlotRate(Number(calSlotMatch[1])));
    return true;
  }

  return false;
}
