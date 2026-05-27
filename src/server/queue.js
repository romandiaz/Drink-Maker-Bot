// Server-side shared drink queue. Any connected client — the kiosk or a phone
// on the AP — can add a drink; the queue is broadcast to every device so they
// all see the same thing. index.js orchestrates: it pours queued drinks one
// at a time, parking between each for a manual "Continue" (glass swap).
//
// This module is just the data structure + change notification. The pour
// lock and ordering live in machine-state.js / index.js.

// entries: [{ id, order, clientId }] — drinks WAITING to pour (not the live one).
// `clientId` is the random ID the phone UI stashes in localStorage; the kiosk
// doesn't set one (its WS connection is recognised by loopback IP instead).
// Used by index.js to enforce that a phone can only remove its OWN drinks.
let entries = [];
let awaitingContinue = false; // parked after a pour, waiting for a Continue tap
let nextId = 1;
const listeners = new Set();

// Immutable snapshot for broadcasting / callers.
export function getQueue() {
  return {
    entries: entries.map((e) => ({ id: e.id, order: e.order, clientId: e.clientId })),
    awaitingContinue,
  };
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  const snapshot = getQueue();
  for (const l of listeners) {
    try {
      l(snapshot);
    } catch (e) {
      console.error("queue listener error:", e);
    }
  }
}

export function length() {
  return entries.length;
}

export function isAwaitingContinue() {
  return awaitingContinue;
}

// Append a drink. Returns the created entry so the caller can report its
// position back to whoever added it. `clientId` is optional — phones supply
// theirs so the remove-own-drink check can match; the kiosk omits it.
export function enqueue(order, clientId = null) {
  const entry = { id: nextId++, order, clientId };
  entries.push(entry);
  emit();
  return entry;
}

// Look up an entry by id without removing it — used by the remove handler to
// check ownership before deleting.
export function getEntry(id) {
  return entries.find((e) => e.id === id) || null;
}

// Remove and return the head entry (the next drink to pour), or null.
export function dequeue() {
  const entry = entries.shift() || null;
  if (entry) {
    if (entries.length === 0) awaitingContinue = false;
    emit();
  }
  return entry;
}

// Put an entry back at the head — used when a pour fails to acquire the lock.
export function requeueFront(entry) {
  entries.unshift(entry);
  emit();
}

// Drop one waiting drink by id (a guest removed it from the queue view).
export function removeEntry(id) {
  const before = entries.length;
  entries = entries.filter((e) => e.id !== id);
  if (entries.length === before) return;
  if (entries.length === 0) awaitingContinue = false;
  emit();
}

// Drop every waiting drink — the queue view's "Clear queue". The drink
// currently pouring is unaffected (it's on the machine, not in `entries`).
export function clearEntries() {
  if (entries.length === 0) return;
  entries = [];
  awaitingContinue = false;
  emit();
}

// Park / un-park the queue between pours. Never parks with an empty queue.
export function setAwaitingContinue(v) {
  const next = !!v && entries.length > 0;
  if (awaitingContinue === next) return;
  awaitingContinue = next;
  emit();
}

// 1-based position of an entry among the waiting drinks, or null if it isn't
// waiting (e.g. it was just dequeued and is pouring now).
export function positionOf(id) {
  const i = entries.findIndex((e) => e.id === id);
  return i < 0 ? null : i + 1;
}

export function queueMessage() {
  return { type: "QUEUE_STATE", state: getQueue() };
}
