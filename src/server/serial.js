// Singleton serial port to the Arduino. One open port per backend process,
// shared by every pour. Commands are tagged with a sequence ID ("#<n>")
// and the firmware echoes the same ID at the end of its response, so we
// match request/response pairs by ID rather than FIFO order — a stray
// or duplicate response can no longer resolve the wrong command.
//
// STOP is the one exception: it's sent out-of-band (sendRaw, no queue
// entry) because it must reach the Arduino while a long POUR is still
// in flight. The firmware responds with two lines — "OK STOP" (no ID,
// dropped here) and "ERR aborted #<pour-id>" which matches the queued
// POUR by ID and fails it cleanly.

import { SerialPort, ReadlineParser } from "serialport";

let port = null;
let parser = null;
let ready = false;
let savedPath = null;
let reconnectTimer = null;
let nextSeqId = 1;
const queue = [];

// USB vendor IDs accepted when SERIAL_PORT is "auto": Arduino's own VID,
// the newer Arduino LLC VID, and the common clone USB-serial bridges
// (CH340, FTDI, CP210x). If your board doesn't match, set SERIAL_PORT to
// its explicit device path instead of "auto".
const ARDUINO_VIDS = new Set(["2341", "2a03", "1a86", "0403", "10c4"]);

const READY_TIMEOUT_MS = 5000;
// Generous per-command ceiling. A single-ingredient POUR is the longest
// thing we send; at typical pump flow rates a 6oz pour finishes well
// under 30s. Anything longer means the Arduino is hung or the line was
// garbled — fail fast so the pour state machine can surface an error
// instead of leaving the UI frozen on the pouring screen.
const COMMAND_TIMEOUT_MS = 30_000;
const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 5000;
// Heartbeat: ping the Arduino while the queue is idle so we notice a
// hung firmware before the next user pour does. Two consecutive misses
// force-close the port, which trips the reconnect loop.
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 1500;
const HEARTBEAT_MISS_LIMIT = 2;
let heartbeatTimer = null;
let heartbeatMisses = 0;

// Listeners notified when the Arduino resets mid-session (READY received
// while we thought it was already up). The glass watcher subscribes so it
// can drop its software baseline — the firmware re-tares in setup() on
// reset, which silently shifts the raw-grams zero the watcher measures
// against. Registration pattern (not a direct import) keeps the dependency
// one-way: glass-watch -> serial, no cycle.
const resetListeners = new Set();

export function onArduinoReset(listener) {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

function newSeqId() {
  const id = nextSeqId;
  // Wrap before the number gets uncomfortably long in logs. 1M is plenty
  // of distinct IDs to avoid collisions with anything still in flight.
  nextSeqId = (nextSeqId + 1) % 1_000_000;
  if (nextSeqId === 0) nextSeqId = 1;
  return id;
}

export function isSerialReady() {
  return ready;
}

export async function openSerial(portPath) {
  if (port) throw new Error("serial port already open");
  // Empty / unset / "auto" all mean "find the Arduino by USB VID:PID at
  // connect time" — this also covers re-enumeration order changes (the
  // board reappearing as ttyACM1 after a replug, or under a different
  // driver) without an install-script rerun.
  savedPath = portPath || "auto";
  // The initial open is no longer fatal: if the Arduino hasn't enumerated
  // yet at cold boot, or the cable is flaky, funnel the failure into the
  // same reconnect loop the close handler uses. Returning successfully
  // either way means the backend stays up and the rest of the kiosk UI
  // works; pours just reject with "serial not ready" until the link
  // comes back.
  try {
    await connectOnce();
  } catch (err) {
    console.error(`serial open failed: ${err.message}; will keep retrying`);
    scheduleReconnect(RECONNECT_INITIAL_MS);
  }
}

async function resolveSerialPath(preferred) {
  const ports = await SerialPort.list();
  if (preferred && preferred !== "auto") {
    // Preferred path wins when it's actually enumerated. If it's missing
    // (kernel re-enumerated ttyACM0 → ttyACM1, USB driver swap, replug
    // race) fall through to the VID scan rather than looping forever on
    // a path that will never appear.
    if (ports.some((p) => p.path === preferred)) return preferred;
  }
  const match = ports.find((p) => ARDUINO_VIDS.has((p.vendorId || "").toLowerCase()));
  return match ? match.path : null;
}

async function connectOnce() {
  const path = await resolveSerialPath(savedPath);
  if (!path) {
    throw new Error(
      savedPath === "auto"
        ? "no Arduino-like USB serial device detected"
        : `device not present: ${savedPath}`
    );
  }
  await new Promise((resolveOpen, rejectOpen) => {
    port = new SerialPort({ path, baudRate: 115200 }, (err) => {
      if (err) {
        // Reset state so a retry can re-open cleanly.
        port = null;
        rejectOpen(err);
      }
    });
    port.once("open", resolveOpen);
  });

  // Discard stale bytes from a prior session before the parser sees them —
  // a partial line from a previous backend run can otherwise show up as
  // garbage in front of the first READY.
  await new Promise((res, rej) =>
    port.flush((err) => (err ? rej(err) : res()))
  );

  port.on("error", (err) => {
    console.error(`serial error: ${err.message}`);
  });

  parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
  parser.on("data", (line) => {
    const clean = line.replace(/\r$/, "");
    if (clean === "READY") {
      // Mid-session READY = Arduino reset (USB jiggle, brown-out from a
      // pump, watchdog). Any in-flight command will never get a reply, so
      // reject the queue rather than let promises hang forever.
      if (ready || queue.length > 0) {
        console.error(
          `Arduino reset detected (READY mid-session); rejecting ${queue.length} queued command(s)`
        );
        while (queue.length) {
          const entry = queue.shift();
          clearTimeout(entry.timer);
          entry.reject(new Error("Arduino reset (READY received mid-session)"));
        }
        // The firmware just re-tared in setup(); tell anyone holding a
        // software baseline against the old zero to re-seed.
        for (const l of resetListeners) {
          try {
            l();
          } catch (e) {
            console.error("Arduino-reset listener error:", e);
          }
        }
      }
      ready = true;
      return;
    }
    // Match the response to its queued command by trailing "#<id>". A line
    // without an ID is a fire-and-forget ack ("OK STOP") or pre-handshake
    // noise — drop it. A line with an ID that isn't in the queue is a late
    // arrival (after our timeout fired) — also drop.
    const m = clean.match(/^(.*)\s+#(\d+)$/);
    if (!m) return;
    const body = m[1];
    const id = parseInt(m[2], 10);
    const entry = queue.find((e) => e.id === id);
    if (!entry) return;

    if (body.startsWith("PROGRESS")) {
      // Non-terminal status line. Reset the per-command timeout (PROGRESS
      // proves the firmware is alive and pouring) and notify the caller —
      // a long but actively progressing pour shouldn't get killed for
      // taking longer than the host's idle timeout.
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        const idx = queue.indexOf(entry);
        if (idx !== -1) {
          queue.splice(idx, 1);
          entry.reject(new Error(`serial command stalled (no progress in ${entry.timeoutMs}ms): ${entry.cmd} #${entry.id}`));
        }
      }, entry.timeoutMs);
      if (entry.onProgress) entry.onProgress(body);
      return;
    }

    // Terminal response — resolve and remove.
    const idx = queue.indexOf(entry);
    queue.splice(idx, 1);
    clearTimeout(entry.timer);
    entry.resolve(body);
  });

  try {
    await new Promise((res, rej) => {
      if (ready) return res();
      const start = Date.now();
      const tick = setInterval(() => {
        if (ready) { clearInterval(tick); res(); return; }
        if (Date.now() - start > READY_TIMEOUT_MS) {
          clearInterval(tick);
          rej(new Error(`Arduino did not send READY within ${READY_TIMEOUT_MS}ms`));
        }
      }, 50);
    });
  } catch (err) {
    if (port) {
      try { port.close(); } catch {}
    }
    port = null;
    parser = null;
    throw err;
  }

  console.log(`serial port connected on ${path}`);

  // Only attach the close handler after a successful handshake — the
  // pre-handshake error path above already cleans up `port` and rethrows,
  // which openSerial / scheduleReconnect catch to schedule the next retry.
  port.on("close", () => {
    console.error("serial port closed; will attempt to reconnect");
    ready = false;
    port = null;
    parser = null;
    stopHeartbeat();
    while (queue.length) {
      const entry = queue.shift();
      clearTimeout(entry.timer);
      entry.reject(new Error("serial port closed"));
    }
    scheduleReconnect(RECONNECT_INITIAL_MS);
  });

  startHeartbeat();
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    // Skip when something else is already in flight: an in-flight POUR
    // means the firmware isn't reading new commands, and any non-POUR
    // queued command is itself proof the link is alive.
    if (!ready || queue.length > 0) return;
    try {
      await sendCommand("PING", { timeoutMs: HEARTBEAT_TIMEOUT_MS });
      heartbeatMisses = 0;
    } catch (err) {
      heartbeatMisses++;
      console.error(
        `heartbeat miss ${heartbeatMisses}/${HEARTBEAT_MISS_LIMIT}: ${err.message}`
      );
      if (heartbeatMisses >= HEARTBEAT_MISS_LIMIT && port) {
        console.error("Arduino unresponsive; forcing reconnect");
        try { port.close(); } catch {}
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatMisses = 0;
}

function scheduleReconnect(delay) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connectOnce();
      console.error("serial port reconnected");
    } catch (err) {
      const next = Math.min(delay * 2, RECONNECT_MAX_MS);
      console.error(`serial reconnect failed: ${err.message}; retrying in ${next}ms`);
      scheduleReconnect(next);
    }
  }, delay);
}

export function sendCommand(cmd, opts = {}) {
  if (!port || !ready) {
    return Promise.reject(new Error("serial not ready"));
  }
  const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const onProgress = opts.onProgress;
  return new Promise((resolve, reject) => {
    const id = newSeqId();
    // cmd and timeoutMs are stored on the entry so the parser can rebuild
    // an informative error and re-arm the timer when PROGRESS arrives.
    const entry = { id, resolve, reject, onProgress, timeoutMs, cmd };
    entry.timer = setTimeout(() => {
      const idx = queue.indexOf(entry);
      if (idx !== -1) {
        queue.splice(idx, 1);
        reject(new Error(`serial command timed out after ${timeoutMs}ms: ${cmd} #${id}`));
      }
    }, timeoutMs);
    queue.push(entry);
    port.write(`${cmd} #${id}\n`);
  });
}

export function sendRaw(line) {
  if (!port) return;
  port.write(line + "\n");
}
