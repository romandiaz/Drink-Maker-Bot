// Admin PIN verification. A wrong PIN is a 401, distinct from a malformed
// request (400), so this keeps its explicit response rather than using jsonRoute.
import { readJsonBody, sendJson } from "../http-util.js";
import { verifyPin } from "../admin-pin.js";

export async function authRoutes(req, res, urlPath) {
  if (urlPath === "/api/admin/verify-pin" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const ok = await verifyPin(body && body.pin);
      if (!ok) {
        sendJson(res, 401, { ok: false, error: "incorrect pin" });
        return true;
      }
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  return false;
}
