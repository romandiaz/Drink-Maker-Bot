// Client-side mirror of the server's shared drink queue (src/server/queue.js).
// The queue lives on the server so every device — the kiosk and any phones on
// the AP — sees the same thing; this module just reflects the QUEUE_STATE
// broadcast and sends QUEUE_* actions. The server is authoritative: it owns
// pour order, the between-pours pause, and cancellation.

import { on, send } from "./ws.js";
import { getMachineStatus } from "./machine-status.js";

// Mirror of the server's MAX_QUEUE — only used here for the "Queue full"
// button label; the server enforces the real limit.
export const MAX_QUEUE = 10;

// { entries: [{ id, order }], awaitingContinue }. `entries` are the drinks
// WAITING — the drink currently pouring rides on the machine state, not here.
let state = { entries: [], awaitingContinue: false };
const listeners = new Set();

on("QUEUE_STATE", (msg) => {
  if (!msg.state) return;
  state = msg.state;
  for (const l of listeners) {
    try {
      l(state);
    } catch (e) {
      console.error("queue listener:", e);
    }
  }
});

export function getQueue() {
  return state;
}

export function onQueueChange(handler) {
  listeners.add(handler);
  handler(state);
  return () => listeners.delete(handler);
}

export function isQueueFull() {
  return state.entries.length >= MAX_QUEUE;
}

// True when a drink would pour immediately rather than wait: the machine is
// idle, nothing is queued, and we're not parked between pours. Screens use
// this to label their button "Pour" vs "Add to queue".
export function canPourNow() {
  return (
    getMachineStatus().status === "idle" &&
    state.entries.length === 0 &&
    !state.awaitingContinue
  );
}

// Add a drink to the shared queue. Resolves with the server's routing
// decision: `pouringNow` means the machine was free and this drink started
// pouring immediately; otherwise it's waiting at `position` in line.
// `rejected` means the queue was full. `clientId` is the optional mobile-UI
// identifier the server stores so the same phone can later pull its drink;
// the kiosk omits it (it's privileged by loopback).
let nextReqId = 1;
export function addToQueue(order, clientId = null) {
  const reqId = nextReqId++;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      off();
      resolve(result);
    };
    const off = on("QUEUE_ADDED", (msg) => {
      if (msg.reqId !== reqId) return;
      finish({
        pouringNow: !!msg.pouringNow,
        position: msg.position ?? null,
        rejected: !!msg.rejected,
      });
    });
    // Fallback so the UI never hangs if the reply is lost.
    setTimeout(() => finish({ pouringNow: false, position: null, rejected: false }), 4000);
    send({ type: "QUEUE_ADD", reqId, order, clientId });
  });
}

// Toast text confirming a drink joined the waiting queue. `position` is its
// 1-based spot in line (1 = pours next); null when the server reply was lost.
function queuePositionMessage(position) {
  if (!position) return "Added to the queue";
  if (position === 1) return "Added to the queue — you're next";
  return `Added to the queue — #${position} in line`;
}

// Single source of truth for queue-event toasts. Pair with showQueueToast()
// from components/toast.js — both the kiosk and the mobile order page emit
// these, and centralizing the variant + wording keeps them visually
// consistent and editable in one place.
export const queueToasts = {
  full: () => ({
    message: "The queue is full — try again in a bit",
    variant: "error",
  }),
  added: (position) => ({
    message: queuePositionMessage(position),
    variant: "success",
  }),
  pouringNow: (drinkName) => ({
    message: `Pouring your ${drinkName} now`,
    variant: "success",
  }),
  removed: () => ({
    message: "Removed from queue",
    variant: "info",
  }),
  pouringNext: () => ({
    message: "Pouring next drink",
    variant: "success",
  }),
};

// Advance the queue past the between-pours pause — pours the next drink.
export function continueQueue() {
  send({ type: "QUEUE_CONTINUE" });
}

// Remove one waiting drink from the queue (by entry id). The kiosk calls this
// with no clientId — its loopback connection bypasses the ownership check.
// The mobile UI passes its persisted clientId so the server can verify the
// caller actually owns the entry it's trying to drop.
export function removeFromQueue(id, clientId = null) {
  send({ type: "QUEUE_REMOVE", id, clientId });
}

// Empty the waiting queue — the recovery path for an abandoned round.
export function clearQueue() {
  send({ type: "QUEUE_CLEAR" });
}

// Cancel whatever is pouring right now. The queue keeps running — the server
// parks for the next drink once the cancel lands.
export function cancelPour() {
  send({ type: "POUR_CANCEL" });
}
