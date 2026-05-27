// Low-stock / error alerts shown in the admin Notifications tab. A new
// notification broadcasts NOTIFICATION_ADDED so open tablets refresh; index.js
// passes its broadcast fn in via ctx.
import { readJsonBody, jsonRoute } from "../http-util.js";
import * as notifications from "../notifications.js";

export async function notificationRoutes(req, res, urlPath, ctx) {
  if (urlPath === "/api/notifications" && req.method === "GET") {
    await jsonRoute(res, () => notifications.list());
    return true;
  }
  if (urlPath === "/api/notifications" && req.method === "POST") {
    await jsonRoute(
      res,
      async () => {
        const body = await readJsonBody(req);
        await notifications.record({
          message: body && body.message,
          variant: body && body.variant,
        });
        ctx.broadcast({ type: "NOTIFICATION_ADDED" });
        return { ok: true };
      },
      { status: 201 }
    );
    return true;
  }
  if (urlPath === "/api/notifications" && req.method === "DELETE") {
    await jsonRoute(res, () => notifications.clear());
    return true;
  }

  return false;
}
