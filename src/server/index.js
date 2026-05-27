import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { mockPour } from "./pour.js";
import { serialPour } from "./serialPour.js";
import { openSerial } from "./serial.js";
import { startGlassWatcher } from "./glass-watch.js";
import { subscribe as subscribeInventory } from "./inventory.js";
import * as drinksStore from "./drinks-store.js";
import * as ingredientsStore from "./ingredients-store.js";
import { subscribe as subscribeCalibration } from "./calibration.js";
// tareScale + readScale drive the live scale-reading WS session below; the rest
// of the maintenance primitives are reached through the maintenance routes.
import { tareScale, readScale } from "./maintenance.js";
import {
  acquire as acquireMachine,
  updateJob as updateMachineJob,
  subscribe as subscribeMachine,
  stateMessage as machineStateMessage,
  getState as getMachineState,
} from "./machine-state.js";
import * as queue from "./queue.js";
import { handleCaptivePortal, markDeviceSignedIn } from "./captive-portal.js";
import { sendJson } from "./http-util.js";
// REST route groups. handleApi just walks this list; each module claims the
// requests it recognises and returns true, otherwise false to fall through.
import { inventoryRoutes } from "./routes/inventory.js";
import { catalogRoutes } from "./routes/catalog.js";
import { submissionRoutes } from "./routes/submissions.js";
import { historyRoutes } from "./routes/history.js";
import { notificationRoutes } from "./routes/notifications.js";
import { maintenanceRoutes } from "./routes/maintenance.js";
import { authRoutes } from "./routes/auth.js";
import { networkRoutes } from "./routes/network.js";
import { backupRoutes } from "./routes/backup.js";
import { systemRoutes } from "./routes/system.js";

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

// Ordered list of route groups. Top-level path prefixes are disjoint across
// modules, so order only matters within a module (most-specific patterns
// first), not between them.
const API_ROUTES = [
  inventoryRoutes,
  catalogRoutes,
  submissionRoutes,
  historyRoutes,
  notificationRoutes,
  maintenanceRoutes,
  authRoutes,
  networkRoutes,
  backupRoutes,
  systemRoutes,
];

// `ctx` carries the shared runtime handles a route can't import without a
// cycle — currently just broadcast (used by the notifications POST).
async function handleApi(req, res, urlPath, ctx) {
  for (const route of API_ROUTES) {
    if (await route(req, res, urlPath, ctx)) return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);

  if (urlPath.startsWith("/api/")) {
    const handled = await handleApi(req, res, urlPath, { broadcast });
    if (!handled) sendJson(res, 404, { error: "not found" });
    return;
  }

  // /welcome is the captive-portal interstitial — shown to phones that just
  // joined the AP, separate from the kiosk so the captive sandbox never has
  // to render the full UI (where WebSockets are flaky). See welcome.html.
  // /order is the mobile ordering UI guests are bounced to from welcome.html;
  // the kiosk's Chromium still loads `/` directly, so `/` keeps the kiosk UI.
  const resolvedPath =
    urlPath === "/" ? "/index.html" :
    urlPath === "/welcome" ? "/welcome.html" :
    urlPath === "/order" ? "/order.html" :
    urlPath;
  const filePath = normalize(join(SRC_DIR, resolvedPath));
  if (!filePath.startsWith(SRC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (handleCaptivePortal(req, res, urlPath)) {
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
  //
  // Exception: the /welcome interstitial. Signing in on its load races the
  // user's tap — the OS's next probe would succeed and auto-dismiss the CNA
  // before they hit "Open the bar". Defer to /order (or any kiosk asset),
  // which is only loaded once the user commits, so the interstitial stays put.
  if (urlPath !== "/welcome") {
    markDeviceSignedIn(req);
  }

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

// Same pattern for inventory and calibration: every mutation (admin edit,
// pour consume, maintenance run) emits, we broadcast a bare event, and each
// tablet's frontend store reloads its cache. No payload — clients GET the
// fresh data themselves so the broadcast stays cheap.
subscribeInventory(() => broadcast({ type: "INVENTORY_UPDATED" }));
subscribeCalibration(() => broadcast({ type: "CALIBRATION_UPDATED" }));
ingredientsStore.subscribe(() => broadcast({ type: "INGREDIENTS_UPDATED" }));

// --- Round queue orchestration --------------------------------------------
// The server owns the shared drink queue: it pours entries one at a time and
// parks between each for a manual Continue (so a guest can swap the glass).
// Any device can add, continue, or cancel — the server is the single
// authority, which keeps multi-device use race-free.
const MAX_QUEUE = 10;
let activeQueuePour = null; // cancel handle for the pour currently running

// Broadcast queue changes to every connected client.
queue.subscribe(() => broadcast(queue.queueMessage()));

function startQueuedPour(entry) {
  const release = acquireMachine({
    kind: "pour",
    drinkId: entry.order.drinkId,
    order: entry.order,
    // Carry the ordering phone's id onto the live job so that phone can show
    // its own finish-by-hand reminder while the drink pours — the phone has no
    // complete screen, and an immediate pour never enters the queue's "You're
    // up" state where the tray reminder lives. Null for kiosk-placed pours.
    clientId: entry.clientId,
  });
  if (!release) {
    // Lost a race for the machine — put the drink back at the head.
    queue.requeueFront(entry);
    return;
  }
  // The pour driver wants skipIngredients (names); derive it from the order's
  // by-hand list so the frontend only carries one shape.
  const pourOrder = {
    ...entry.order,
    skipIngredients: (entry.order.missingByHand || []).map((i) => i.name),
  };
  let finished = false;
  // Runs exactly once on a terminal event. In a `finally` so that even if a
  // broadcast throws, the machine lock is still released — otherwise one bad
  // client.send() could leave the machine stuck "pouring" forever.
  function finishPour(event) {
    if (finished) return;
    finished = true;
    activeQueuePour = null;
    // Park for a glass swap if more drinks wait. Set this BEFORE release() so
    // the QUEUE_STATE broadcast lands before MACHINE_STATE goes idle — clients
    // then see 'awaitingContinue' the instant the machine frees.
    if (queue.length() > 0) queue.setAwaitingContinue(true);
    release(event);
  }
  const cancel = pour(pourOrder, (event) => {
    const terminal =
      event.type === "POUR_COMPLETE" ||
      event.type === "POUR_CANCELLED" ||
      event.type === "POUR_ERROR";
    try {
      if (event.type === "POUR_PROGRESS") {
        updateMachineJob({
          progress: event.pct,
          step: event.step,
          stepIndex: event.stepIndex,
        });
      }
      // Broadcast (not unicast) so whichever device is on the pouring screen —
      // kiosk or phone — follows the pour.
      broadcast(event);
    } finally {
      if (terminal) finishPour(event);
    }
  });
  // If the driver fired a terminal event synchronously (e.g. unknown drink),
  // the pour is already done — don't overwrite activeQueuePour with the now-
  // stale cancel handle.
  activeQueuePour = finished ? null : cancel;
}

// Pour the next queued drink if the machine is free and not parked.
function tryPourNext() {
  if (getMachineState().status !== "idle") return;
  if (queue.isAwaitingContinue()) return;
  if (queue.length() === 0) return;
  const entry = queue.dequeue();
  if (entry) startQueuedPour(entry);
}

// If the machine frees from a non-pour job (maintenance) with drinks still
// queued, park them so the queue screen surfaces a Continue prompt.
subscribeMachine((s) => {
  if (
    s.status === "idle" &&
    !activeQueuePour &&
    queue.length() > 0 &&
    !queue.isAwaitingContinue()
  ) {
    queue.setAwaitingContinue(true);
  }
});

wss.on("connection", (ws, req) => {
  // Loopback connections (the kiosk running on the Pi itself) bypass the
  // ownership check on queue mutations — the kiosk is the host control surface
  // and can remove or clear any drink. Phones come in over the LAN and must
  // supply the clientId that matches the entry they want to drop.
  const rawIp = req.socket.remoteAddress || "";
  const ip = rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
  const isLocal = ip === "127.0.0.1" || ip === "::1";

  // Hand the new client the current state immediately, otherwise its header
  // sits at "Ready" through the first transition no matter what's actually
  // happening.
  // Sync the new client to current machine + queue state immediately, so its
  // header and pour button reflect what's actually happening.
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(machineStateMessage()));
    ws.send(JSON.stringify(queue.queueMessage()));
  }

  // Live scale-reading session for the admin "Read scale" modal. Holds the
  // maintenance lock for the modal's lifetime so the global status indicator
  // sits steady at "Maintenance" instead of flashing on every poll. The
  // server drives the read cadence and streams SCALE_READING events to this
  // connection; ws-close releases the lock as a backstop if the tablet
  // disconnects without an explicit SCALE_SESSION_END.
  let scaleSession = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === "QUEUE_ADD") {
      // Any device adds to the shared queue. If the machine is free the
      // server pours it straight away; otherwise it waits its turn.
      const order = msg.order;
      if (!order || !order.drinkId) return;
      if (queue.length() >= MAX_QUEUE) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "QUEUE_ADDED", reqId: msg.reqId, rejected: true }));
        }
        return;
      }
      // Phones tag the order with a localStorage-persisted clientId so they
      // can later remove their own waiting drinks. The kiosk doesn't set one
      // (it's privileged by loopback). Non-string values get coerced to null
      // to keep the stored shape predictable.
      const clientId = typeof msg.clientId === "string" ? msg.clientId : null;
      const entry = queue.enqueue(order, clientId);
      tryPourNext();
      // positionOf is null once an entry has been dequeued to pour — that's
      // how the client knows whether to show the pour screen or a toast.
      const position = queue.positionOf(entry.id);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: "QUEUE_ADDED",
          reqId: msg.reqId,
          pouringNow: position === null,
          position,
        }));
      }
    } else if (msg.type === "QUEUE_CONTINUE") {
      // Any device can advance the queue past the between-pours pause.
      queue.setAwaitingContinue(false);
      tryPourNext();
    } else if (msg.type === "QUEUE_REMOVE") {
      // Drop one waiting drink. The kiosk (loopback) can remove any entry;
      // phones can only remove entries whose clientId matches theirs, so a
      // guest can't pull someone else's drink off the queue.
      if (typeof msg.id !== "number") return;
      if (!isLocal) {
        const entry = queue.getEntry(msg.id);
        if (!entry) return;
        if (
          !entry.clientId ||
          typeof msg.clientId !== "string" ||
          entry.clientId !== msg.clientId
        ) {
          return;
        }
      }
      queue.removeEntry(msg.id);
    } else if (msg.type === "QUEUE_CLEAR") {
      // Empty the waiting queue — the recovery path for an abandoned round.
      // Restricted to the kiosk so one guest can't wipe everyone else's round.
      if (!isLocal) return;
      queue.clearEntries();
    } else if (msg.type === "POUR_CANCEL") {
      // Cancels whatever is pouring. Restricted to the kiosk (loopback): a
      // guest with the order page open shouldn't be able to abort someone
      // else's drink mid-pour. The pour's terminal event then parks the queue
      // for the next drink — a cancel skips the current drink, it doesn't
      // wipe the rest of the queue.
      if (!isLocal) return;
      if (activeQueuePour) {
        activeQueuePour();
        activeQueuePour = null;
      }
    } else if (msg.type === "SCALE_SESSION_START") {
      if (scaleSession) return; // idempotent — same connection already owns one
      const release = acquireMachine({ kind: "maintenance", mode: "scale-session" });
      if (!release) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "SCALE_SESSION_REJECTED", reason: "busy" }));
        }
        return;
      }
      const session = { release, tareRequested: false, stopped: false };
      scaleSession = session;
      (async function loop() {
        while (!session.stopped && ws.readyState === ws.OPEN) {
          if (session.tareRequested) {
            session.tareRequested = false;
            try { await tareScale(); } catch {}
            if (session.stopped) break;
          }
          try {
            const result = await readScale();
            if (!session.stopped && ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "SCALE_READING", grams: result.grams }));
            }
          } catch {
            // Transient serial blip — keep streaming; next read may succeed.
          }
          await new Promise((res) => setTimeout(res, 250));
        }
      })();
    } else if (msg.type === "SCALE_SESSION_TARE") {
      // Honored by the stream loop before its next read so TARE and READ
      // can't collide on the serial line.
      if (scaleSession) scaleSession.tareRequested = true;
    } else if (msg.type === "SCALE_SESSION_END") {
      if (scaleSession) {
        scaleSession.stopped = true;
        scaleSession.release();
        scaleSession = null;
      }
    }
  });

  ws.on("close", () => {
    // A pour is server-owned now — a client disconnecting does NOT cancel it
    // (other devices may be watching, and the queue keeps running). Only the
    // scale session is tied to this connection; release it as a backstop so
    // a tablet that closes its browser mid-modal doesn't leak the lock.
    if (scaleSession) {
      scaleSession.stopped = true;
      scaleSession.release();
      scaleSession = null;
    }
  });
});

// Load the ingredient-attribute store before anything touches inventory.js:
// on an upgrade it migrates the legacy per-slot capacity/cost out of
// inventory.json, which inventory.js strips the first time it loads the file.
await ingredientsStore.load();

// Hydrate the backend's drinks.js module from the persisted JSON before
// accepting pour requests — otherwise a freshly-started server would fall
// back to SEED_DRINKS until the first /api/drinks fetch arrives.
await drinksStore.load();

// SERIAL_PORT=COM3 (Windows) or /dev/ttyUSB0 (Pi) flips us into real-pour
// mode. SERIAL_PORT=auto picks the first USB device matching a known
// Arduino/CH340/FTDI/CP210x VID, which is more robust than a fixed path
// across re-enumerations. Without the env var, mockPour keeps laptop dev
// fully functional. openSerial no longer throws on a missing device — it
// schedules retries — so the backend boots even if the Arduino is
// unplugged; pours just reject until the link comes up.
if (process.env.SERIAL_PORT) {
  await openSerial(process.env.SERIAL_PORT);
  pour = serialPour;
  console.log(`Serial pour enabled (target: ${process.env.SERIAL_PORT})`);
  // Ambient glass-presence detection. Only meaningful with real hardware;
  // mock mode has no scale to read, so the watcher would just churn.
  startGlassWatcher();
} else {
  console.log("Mock pour enabled (set SERIAL_PORT to use real hardware)");
}

server.listen(PORT, () => {
  console.log(`Bartender kiosk running at http://localhost:${PORT}`);
});
