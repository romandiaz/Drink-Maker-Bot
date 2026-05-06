import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { mockPour } from "./pour.js";
import { serialPour } from "./serialPour.js";
import { openSerial } from "./serial.js";
import { loadInventory, saveInventory } from "./inventory.js";
import * as drinksStore from "./drinks-store.js";
import * as categoriesStore from "./categories-store.js";
import * as submissionsStore from "./submissions-store.js";
import {
  stats as pourStats,
  list as pourList,
  clear as pourClear,
} from "./pour-history.js";
import * as notifications from "./notifications.js";
import {
  loadCalibration,
  saveCalibration,
  clearSlotRate,
} from "./calibration.js";
import {
  runTimedPump,
  runCalibrationMeasure,
  saveCalibrationResult,
} from "./maintenance.js";
import {
  acquire as acquireMachine,
  updateJob as updateMachineJob,
  subscribe as subscribeMachine,
  stateMessage as machineStateMessage,
} from "./machine-state.js";
import { verifyPin } from "./admin-pin.js";
import * as network from "./network.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, "..");

// Default to mockPour; flipped to serialPour below if SERIAL_PORT is set.
// Declared up here so the wss handler closure references the same binding
// without any temporal-dead-zone fragility.
let pour = mockPour;

// Well-known captive-portal probe paths. iOS, Android, and Windows all hit
// specific URLs after joining a network to detect whether they have real
// internet access. In Host mode we hijack their DNS to point here, so these
// requests land on us. First contact from a device gets a 302 to "/" so the
// OS pops its captive browser; subsequent probes from the same device return
// success once it's been "signed in" (see signedInIPs below) so the OS clears
// the captive flag and the user can use the kiosk in their regular browser
// (where WebSockets work — the captive sandbox often breaks them).
const CAPTIVE_PROBE_PATHS = new Set([
  "/hotspot-detect.html",
  "/library/test/success.html",
  "/generate_204",
  "/gen_204",
  "/connecttest.txt",
  "/ncsi.txt",
  "/check_network_status.txt",
  "/canonical.html",
]);

// Apple-flavored probes look for a specific HTML body, not a 204. Returning
// 204 to these doesn't reliably clear iOS's captive flag on older versions.
const APPLE_PROBE_PATHS = new Set([
  "/hotspot-detect.html",
  "/library/test/success.html",
]);
const APPLE_SUCCESS_HTML =
  "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>";

// IPs that have loaded a real kiosk asset (not just a probe). Once an IP is
// in here, future probe responses tell the OS the network is healthy and the
// captive sandbox dismisses. Process-lifetime only — restart the backend and
// every device re-runs the captive flow, which is fine.
const signedInIPs = new Set();

function clientIp(req) {
  const raw = req.socket.remoteAddress || "";
  // Strip the IPv4-mapped IPv6 prefix Node uses on dual-stack sockets so
  // "::ffff:10.42.0.5" and "10.42.0.5" don't count as different devices.
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
};

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

async function readJsonBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        rejectBody(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        rejectBody(new Error("invalid json"));
      }
    });
    req.on("error", rejectBody);
  });
}

async function handleApi(req, res, urlPath) {
  if (urlPath === "/api/inventory" && req.method === "GET") {
    sendJson(res, 200, await loadInventory());
    return true;
  }
  if (urlPath === "/api/inventory" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, await saveInventory(body));
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/drinks" && req.method === "GET") {
    sendJson(res, 200, await drinksStore.load());
    return true;
  }
  if (urlPath === "/api/drinks" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 201, await drinksStore.create(body));
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }
  const drinkMatch = urlPath.match(/^\/api\/drinks\/([^/]+)$/);
  if (drinkMatch && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, await drinksStore.update(drinkMatch[1], body));
    } catch (e) {
      sendJson(res, e.message === "not found" ? 404 : 400, { error: e.message });
    }
    return true;
  }
  if (drinkMatch && req.method === "DELETE") {
    try {
      sendJson(res, 200, await drinksStore.remove(drinkMatch[1]));
    } catch (e) {
      sendJson(res, e.message === "not found" ? 404 : 400, { error: e.message });
    }
    return true;
  }
  // Cheap toggle endpoint — avoids re-validating the entire drink record on
  // an enable/disable flip. Body: { enabled: bool }.
  const drinkEnabledMatch = urlPath.match(/^\/api\/drinks\/([^/]+)\/enabled$/);
  if (drinkEnabledMatch && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, await drinksStore.setEnabled(drinkEnabledMatch[1], body.enabled));
    } catch (e) {
      sendJson(res, e.message === "not found" ? 404 : 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/categories" && req.method === "GET") {
    sendJson(res, 200, await categoriesStore.load());
    return true;
  }
  if (urlPath === "/api/categories" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, await categoriesStore.save(body));
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/stats" && req.method === "GET") {
    sendJson(res, 200, await pourStats());
    return true;
  }

  if (urlPath === "/api/history" && req.method === "GET") {
    sendJson(res, 200, await pourList());
    return true;
  }
  if (urlPath === "/api/history" && req.method === "DELETE") {
    sendJson(res, 200, await pourClear());
    return true;
  }

  if (urlPath === "/api/notifications" && req.method === "GET") {
    sendJson(res, 200, await notifications.list());
    return true;
  }
  if (urlPath === "/api/notifications" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      await notifications.record({
        message: body && body.message,
        variant: body && body.variant,
      });
      sendJson(res, 201, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }
  if (urlPath === "/api/notifications" && req.method === "DELETE") {
    sendJson(res, 200, await notifications.clear());
    return true;
  }

  if (urlPath === "/api/submissions" && req.method === "GET") {
    sendJson(res, 200, await submissionsStore.load());
    return true;
  }
  if (urlPath === "/api/submissions" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 201, await submissionsStore.create(body));
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }
  const submissionMatch = urlPath.match(/^\/api\/submissions\/([^/]+)$/);
  if (submissionMatch && req.method === "DELETE") {
    try {
      sendJson(res, 200, await submissionsStore.remove(submissionMatch[1]));
    } catch (e) {
      sendJson(res, e.message === "not found" ? 404 : 400, { error: e.message });
    }
    return true;
  }
  const submissionPromoteMatch = urlPath.match(/^\/api\/submissions\/([^/]+)\/promote$/);
  if (submissionPromoteMatch && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const submission = await submissionsStore.get(submissionPromoteMatch[1]);
      if (!submission) {
        sendJson(res, 404, { error: "not found" });
        return true;
      }
      // Promotion folds the admin's edits (category, glass, color, etc.) into
      // the guest-supplied name + ingredients, then drops the submission.
      // drinksStore.create runs the full validator so a malformed promote
      // payload bounces with 400 before we delete the original.
      const drink = await drinksStore.create({
        ...body,
        name: body.name || submission.name,
        ingredients: body.ingredients?.length ? body.ingredients : submission.ingredients,
      });
      await submissionsStore.remove(submission.id);
      sendJson(res, 201, drink);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/calibration" && req.method === "GET") {
    sendJson(res, 200, await loadCalibration());
    return true;
  }
  if (urlPath === "/api/calibration" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, await saveCalibration(body));
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }
  const calSlotMatch = urlPath.match(/^\/api\/calibration\/slot\/(\d+)$/);
  if (calSlotMatch && req.method === "DELETE") {
    try {
      sendJson(res, 200, await clearSlotRate(Number(calSlotMatch[1])));
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/maintenance/run" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const slot = Number(body.slot);
      const durationSec = Number(body.durationSec);
      const mode = body.mode === "clean" ? "clean" : "prime";
      if (!Number.isInteger(slot) || slot < 1) throw new Error("invalid slot");
      if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 60) {
        throw new Error("invalid duration");
      }
      const release = acquireMachine({ kind: "maintenance", mode, slot });
      if (!release) {
        sendJson(res, 409, { error: "machine busy" });
        return true;
      }
      try {
        await runTimedPump(slot, durationSec * 1000);
        sendJson(res, 200, { ok: true, mode, slot, durationSec });
      } finally {
        release();
      }
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/maintenance/calibrate-measure" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const slot = Number(body.slot);
      const durationSec = Number(body.durationSec);
      if (!Number.isInteger(slot) || slot < 1) throw new Error("invalid slot");
      const release = acquireMachine({ kind: "maintenance", mode: "calibrate", slot });
      if (!release) {
        sendJson(res, 409, { error: "machine busy" });
        return true;
      }
      try {
        const result = await runCalibrationMeasure(slot, durationSec);
        sendJson(res, 200, { ok: true, slot, ...result });
      } finally {
        release();
      }
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

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

  // Network admin endpoints — wrap nmcli for the admin Network tab. These
  // intentionally aren't PIN-gated at the HTTP layer (matching the existing
  // admin endpoints), which assumes the only client on the network is the
  // kiosk itself. When the phone-as-client work lands these will need stricter
  // gating, since guest devices will share the LAN with the Pi in host mode.
  if (urlPath === "/api/network/status" && req.method === "GET") {
    try {
      sendJson(res, 200, await network.getStatus());
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }
  if (urlPath === "/api/network/scan" && req.method === "GET") {
    try {
      sendJson(res, 200, await network.scan());
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }
  if (urlPath === "/api/network/saved" && req.method === "GET") {
    try {
      sendJson(res, 200, await network.listSaved());
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }
  const networkForgetMatch = urlPath.match(/^\/api\/network\/saved\/([^/]+)$/);
  if (networkForgetMatch && req.method === "DELETE") {
    try {
      await network.forget(decodeURIComponent(networkForgetMatch[1]));
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }
  if (urlPath === "/api/network/mode" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      await network.setMode(body && body.mode);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }
  if (urlPath === "/api/network/connect" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (body && body.name) {
        await network.connectExisting(body.name);
      } else if (body && body.ssid) {
        await network.connectNew(body.ssid, body.password || "");
      } else {
        throw new Error("provide name or ssid");
      }
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }
  if (urlPath === "/api/network/hotspot" && req.method === "GET") {
    try {
      sendJson(res, 200, await network.getHotspotConfig());
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }
  if (urlPath === "/api/network/hotspot" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      await network.setHotspotConfig(body || {});
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/maintenance/calibrate-save" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const slot = Number(body.slot);
      const ozPerSec = Number(body.ozPerSec);
      sendJson(res, 200, await saveCalibrationResult(slot, ozPerSec));
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);

  if (urlPath.startsWith("/api/")) {
    const handled = await handleApi(req, res, urlPath);
    if (!handled) sendJson(res, 404, { error: "not found" });
    return;
  }

  // /welcome is the captive-portal interstitial — shown to phones that just
  // joined the AP, separate from the kiosk so the captive sandbox never has
  // to render the full UI (where WebSockets are flaky). See welcome.html.
  const resolvedPath =
    urlPath === "/" ? "/index.html" :
    urlPath === "/welcome" ? "/welcome.html" :
    urlPath;
  const filePath = normalize(join(SRC_DIR, resolvedPath));
  if (!filePath.startsWith(SRC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (CAPTIVE_PROBE_PATHS.has(urlPath)) {
      if (signedInIPs.has(clientIp(req))) {
        // Tell the OS the network is healthy. Captive flag clears, sandbox
        // dismisses, the user's regular browser tab finishes loading.
        if (APPLE_PROBE_PATHS.has(urlPath)) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(APPLE_SUCCESS_HTML);
        } else {
          res.writeHead(204);
          res.end();
        }
        return;
      }
      // First probe from this device — pop the captive browser at the
      // welcome interstitial, not the kiosk itself. The interstitial bounces
      // the user out to a regular browser (Chrome via intent on Android,
      // Safari via NFC-queued tab on iOS).
      res.writeHead(302, { Location: "/welcome" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Successful asset serve — mark this device as having loaded the kiosk so
  // its OS-level probes will start succeeding. Covers index.html, app.js,
  // styles.css, drink images: anything that means a phone is actually using
  // us rather than just being probed.
  signedInIPs.add(clientIp(req));

  const mime = MIME[extname(filePath)] || "application/octet-stream";
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
  res.end(body);
});

const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(event) {
  const json = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(json);
  }
}

// Mirror machine-state changes to every connected client. The store guards
// against double-emits so we don't need to dedupe here.
subscribeMachine(() => broadcast(machineStateMessage()));

wss.on("connection", (ws) => {
  // Hand the new client the current state immediately, otherwise its header
  // sits at "Ready" through the first transition no matter what's actually
  // happening.
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(machineStateMessage()));

  // Only the connection that started a pour can cancel it (cancel UI only
  // exists on its own pouring screen). releasePour is the machine-state
  // release callback for the active pour, separate from the pour driver's
  // own cancel handle.
  let cancelPour = null;
  let releasePour = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === "POUR") {
      // Reject if anything else is running — including a maintenance routine
      // kicked off via HTTP from another tablet. The client navigates back
      // to detail on POUR_REJECTED.
      const release = acquireMachine({ kind: "pour", drinkId: msg.drinkId });
      if (!release) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "POUR_REJECTED", reason: "busy" }));
        }
        return;
      }
      releasePour = release;
      cancelPour = pour(msg, (event) => {
        // Pour progress reaches the originating tablet (drives its progress
        // bar) AND the shared machine-state job (drives every other tablet's
        // header). Terminal events release the lock.
        if (event.type === "POUR_PROGRESS") {
          updateMachineJob({ progress: event.pct, step: event.step });
        }
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
        if (
          event.type === "POUR_COMPLETE" ||
          event.type === "POUR_CANCELLED" ||
          event.type === "POUR_ERROR"
        ) {
          if (releasePour) {
            releasePour();
            releasePour = null;
          }
          cancelPour = null;
        }
      });
    } else if (msg.type === "POUR_CANCEL") {
      if (cancelPour) {
        cancelPour();
        cancelPour = null;
      }
    }
  });

  ws.on("close", () => {
    if (cancelPour) cancelPour();
    cancelPour = null;
    // The pour driver normally releases via the terminal event above, but if
    // the socket dies mid-pour the cancel() may emit POUR_CANCELLED to a
    // closed socket — release here too as a backstop. Idempotent.
    if (releasePour) {
      releasePour();
      releasePour = null;
    }
  });
});

// Hydrate the backend's drinks.js module from the persisted JSON before
// accepting pour requests — otherwise a freshly-started server would fall
// back to SEED_DRINKS until the first /api/drinks fetch arrives.
await drinksStore.load();

// SERIAL_PORT=COM3 (Windows) or /dev/ttyUSB0 (Pi) flips us into real-pour
// mode. Without it, mockPour keeps laptop dev fully functional.
if (process.env.SERIAL_PORT) {
  await openSerial(process.env.SERIAL_PORT);
  pour = serialPour;
  console.log(`Serial pour enabled on ${process.env.SERIAL_PORT}`);
} else {
  console.log("Mock pour enabled (set SERIAL_PORT to use real hardware)");
}

server.listen(PORT, () => {
  console.log(`Bartender kiosk running at http://localhost:${PORT}`);
});
