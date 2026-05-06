// Frontend mirror of the server's machine-state. Updated by MACHINE_STATE
// broadcasts; everything that needs to know "is the machine busy?" reads from
// here. Default is idle — same shape the server emits — so callers don't
// have to special-case the brief window before the first message arrives.

import { on } from "./ws.js";

let current = { status: "idle", job: null };
const listeners = new Set();

on("MACHINE_STATE", (msg) => {
  if (!msg.state) return;
  current = msg.state;
  for (const l of listeners) {
    try {
      l(current);
    } catch (e) {
      console.error("machine-status listener:", e);
    }
  }
});

export function getMachineStatus() {
  return current;
}

export function isMachineIdle() {
  return current.status === "idle";
}

export function onMachineStatus(handler) {
  listeners.add(handler);
  // Fire immediately so subscribers don't have to read getMachineStatus()
  // separately to render their first state.
  handler(current);
  return () => listeners.delete(handler);
}
