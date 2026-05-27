// Network admin endpoints — wrap nmcli for the admin Network tab. These
// intentionally aren't PIN-gated at the HTTP layer (matching the existing
// admin endpoints), which assumes the only client on the network is the
// kiosk itself. When the phone-as-client work lands these will need stricter
// gating, since guest devices will share the LAN with the Pi in host mode.
//
// Read endpoints surface nmcli failures as 500 (the system call broke);
// mutations surface bad input as 400.
import { readJsonBody, sendJson, jsonRoute } from "../http-util.js";
import * as network from "../network.js";
import { clearSignedInIPs } from "../captive-portal.js";

export async function networkRoutes(req, res, urlPath) {
  if (urlPath === "/api/network/status" && req.method === "GET") {
    await jsonRoute(res, () => network.getStatus(), { errorStatus: 500 });
    return true;
  }
  if (urlPath === "/api/network/scan" && req.method === "GET") {
    await jsonRoute(res, () => network.scan(), { errorStatus: 500 });
    return true;
  }
  if (urlPath === "/api/network/saved" && req.method === "GET") {
    await jsonRoute(res, () => network.listSaved(), { errorStatus: 500 });
    return true;
  }
  const networkForgetMatch = urlPath.match(/^\/api\/network\/saved\/([^/]+)$/);
  if (networkForgetMatch && req.method === "DELETE") {
    await jsonRoute(res, async () => {
      await network.forget(decodeURIComponent(networkForgetMatch[1]));
      return { ok: true };
    });
    return true;
  }
  if (urlPath === "/api/network/mode" && req.method === "POST") {
    await jsonRoute(res, async () => {
      const body = await readJsonBody(req);
      await network.setMode(body && body.mode);
      return { ok: true };
    });
    return true;
  }
  if (urlPath === "/api/network/connect" && req.method === "POST") {
    await jsonRoute(res, async () => {
      const body = await readJsonBody(req);
      if (body && body.name) {
        await network.connectExisting(body.name);
      } else if (body && body.ssid) {
        await network.connectNew(body.ssid, body.password || "");
      } else {
        throw new Error("provide name or ssid");
      }
      return { ok: true };
    });
    return true;
  }
  if (urlPath === "/api/network/hotspot" && req.method === "GET") {
    await jsonRoute(res, () => network.getHotspotConfig(), { errorStatus: 500 });
    return true;
  }
  if (urlPath === "/api/network/hotspot" && req.method === "PUT") {
    await jsonRoute(res, async () => {
      const body = await readJsonBody(req);
      await network.setHotspotConfig(body || {});
      return { ok: true };
    });
    return true;
  }
  if (urlPath === "/api/network/clients" && req.method === "DELETE") {
    clearSignedInIPs();
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
