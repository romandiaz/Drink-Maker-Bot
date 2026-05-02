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
import { stats as pourStats } from "./pour-history.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, "..");

// Default to mockPour; flipped to serialPour below if SERIAL_PORT is set.
// Declared up here so the wss handler closure references the same binding
// without any temporal-dead-zone fragility.
let pour = mockPour;

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

  if (urlPath === "/api/stats" && req.method === "GET") {
    sendJson(res, 200, await pourStats());
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

  const resolvedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = normalize(join(SRC_DIR, resolvedPath));
  if (!filePath.startsWith(SRC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const mime = MIME[extname(filePath)] || "application/octet-stream";
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
  res.end(body);
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  let cancelPour = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === "POUR") {
      if (cancelPour) cancelPour();
      cancelPour = pour(msg, (event) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
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
