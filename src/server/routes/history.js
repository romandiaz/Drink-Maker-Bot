// Pour analytics: aggregate stats for the dashboard and the raw pour log.
import { jsonRoute } from "../http-util.js";
import { stats as pourStats, list as pourList, clear as pourClear } from "../pour-history.js";

export async function historyRoutes(req, res, urlPath) {
  if (urlPath === "/api/stats" && req.method === "GET") {
    await jsonRoute(res, () => pourStats());
    return true;
  }
  if (urlPath === "/api/history" && req.method === "GET") {
    await jsonRoute(res, () => pourList());
    return true;
  }
  if (urlPath === "/api/history" && req.method === "DELETE") {
    await jsonRoute(res, () => pourClear());
    return true;
  }

  return false;
}
