// Turns the firmware's hardware-health reports into user-visible signals.
//
// serial.js emits a health report (via onHealthReport) both on connect — from
// the unsolicited boot "STATUS scale=..." line — and on every HEALTH heartbeat.
// We debounce those into edges and, on a change: (1) fold the state into
// machine-state so the existing MACHINE_STATE broadcast carries it to every
// client, and (2) log a notification so the admin Notifications tab records the
// fault even if no one was watching the kiosk when it happened.
//
// Only the load cell ("scale") is reported today; the per-subsystem shape
// leaves room for more without adding another WS message.

import { onHealthReport } from "./serial.js";
import { setHardwareHealth } from "./machine-state.js";
import * as notifications from "./notifications.js";

// Notification copy per subsystem and edge. Absence of a key = no notification
// for that transition (we still update machine-state).
const MESSAGES = {
  scale: {
    fault: "Load cell not responding — pours can't measure fill weight.",
    ok: "Load cell is responding again.",
  },
};

// subsystem -> last reported value, for edge detection so we notify (and log)
// once per transition, not on every heartbeat.
const last = {};

export function startHardwareHealthMonitor({ broadcast }) {
  onHealthReport((report) => {
    for (const [subsystem, value] of Object.entries(report)) {
      const prev = last[subsystem];
      if (value === prev) continue;
      last[subsystem] = value;

      // Fold into machine-state → triggers the MACHINE_STATE broadcast.
      setHardwareHealth({ [subsystem]: value });

      const copy = MESSAGES[subsystem];
      if (!copy) continue;
      // Log on entering a fault, and on recovering from a prior fault. A
      // healthy first report (prev === undefined) posts nothing — we don't
      // want a "recovered" toast on every clean boot.
      if (value === "fault" && copy.fault) {
        notifications
          .record({ message: copy.fault, variant: "error" })
          .catch(() => {});
        broadcast({ type: "NOTIFICATION_ADDED" });
      } else if (value === "ok" && prev === "fault" && copy.ok) {
        notifications
          .record({ message: copy.ok, variant: "info" })
          .catch(() => {});
        broadcast({ type: "NOTIFICATION_ADDED" });
      }
    }
  });
}
