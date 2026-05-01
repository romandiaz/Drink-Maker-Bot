// Minimal WebSocket client. Auto-reconnects with backoff. Queues sends
// while disconnected so screens can call send() without checking state.

const handlers = new Map(); // type -> Set<handler>
const sendQueue = [];
let socket = null;
let reconnectDelay = 500;

// Connection status: 'connecting' | 'connected' | 'disconnected'.
// 'disconnected' is only emitted after the first successful connect — so a static
// dev server (no WS backend) doesn't trigger a permanent "Reconnecting" overlay.
const statusHandlers = new Set();
let hasEverConnected = false;
let currentStatus = "connecting";

function emitStatus(s) {
  if (currentStatus === s) return;
  currentStatus = s;
  for (const h of statusHandlers) h(s);
}

export function onStatusChange(handler) {
  statusHandlers.add(handler);
  handler(currentStatus);
  return () => statusHandlers.delete(handler);
}

function dispatch(msg) {
  const set = handlers.get(msg.type);
  if (set) for (const h of set) h(msg);
}

function flush() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  while (sendQueue.length) socket.send(JSON.stringify(sendQueue.shift()));
}

function connect() {
  if (!location.host) return; // Served over file:// — no server to talk to.
  let s;
  try {
    s = new WebSocket(`ws://${location.host}/ws`);
  } catch {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
    return;
  }
  socket = s;
  s.addEventListener("open", () => {
    reconnectDelay = 500;
    hasEverConnected = true;
    emitStatus("connected");
    flush();
  });
  s.addEventListener("message", (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    dispatch(msg);
  });
  s.addEventListener("close", () => {
    socket = null;
    if (hasEverConnected) emitStatus("disconnected");
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });
}

export function startWS() {
  if (socket) return;
  connect();
}

export function send(msg) {
  sendQueue.push(msg);
  flush();
}

// Subscribe to a message type. Returns an unsubscribe function.
export function on(type, handler) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(handler);
  return () => handlers.get(type).delete(handler);
}
