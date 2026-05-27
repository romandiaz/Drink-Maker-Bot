// Load-cell modals for the maintenance view:
//   openScaleCalibrateModal — keypad entry of a known mass, then CAL the scale
//   openScaleVisualizationModal — live SCALE_READING stream with a Tare button
//
// Both ride on the shared pin-modal shell. The calibrate modal is tracked by
// the view's modal singleton (via onClose); the live-read modal manages its own
// lifetime since it also has to open/close a server-side scale session.

import { postJSON } from "../api.js";
import { showToast } from "./toast.js";
import { on as onWS, send as sendWS } from "../ws.js";

// Overlay + panel + heading + display, shared by both scale modals. The caller
// fills the display and appends its own keypad / actions to `panel`.
function scaleModalShell(headingText) {
  const overlay = document.createElement("div");
  overlay.className = "pin-modal";

  const panel = document.createElement("div");
  panel.className = "pin-modal__panel scale-cal-modal";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  const heading = document.createElement("div");
  heading.className = "pin-modal__label";
  heading.textContent = headingText;
  panel.appendChild(heading);

  const display = document.createElement("div");
  display.className = "scale-cal-modal__display";
  panel.appendChild(display);

  overlay.appendChild(panel);
  return { overlay, panel, display };
}

export function openScaleCalibrateModal({ host, setBusy, isLocked, onClose }) {
  let value = "100";

  const { overlay, panel, display } = scaleModalShell("Calibrate Load Cell");
  function paint() {
    display.textContent = value ? `${value} g` : "—";
  }
  paint();

  // 3×4 keypad: digits, decimal point, backspace
  const keypad = document.createElement("div");
  keypad.className = "pin-modal__keypad";
  const layout = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
  for (const k of layout) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pin-modal__key tappable";
    if (k === "back") {
      btn.classList.add("pin-modal__key--back");
      btn.setAttribute("aria-label", "Backspace");
      btn.innerHTML = `
        <svg viewBox="0 0 20 16" aria-hidden="true" focusable="false">
          <path d="M6 1H17C18.1 1 19 1.9 19 3V13C19 14.1 18.1 15 17 15H6L1 8L6 1Z"
            fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M9 5L14 11 M14 5L9 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      `;
      btn.addEventListener("click", () => { value = value.slice(0, -1); paint(); });
    } else if (k === ".") {
      btn.textContent = ".";
      btn.addEventListener("click", () => {
        if (value.includes(".")) return;
        value += ".";
        paint();
      });
    } else {
      btn.textContent = k;
      btn.addEventListener("click", () => { value += k; paint(); });
    }
    keypad.appendChild(btn);
  }
  panel.appendChild(keypad);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "scale-cal-modal__actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "pin-modal__cancel tappable";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);

  const start = document.createElement("button");
  start.type = "button";
  start.className = "maint-btn maint-btn--primary tappable";
  start.textContent = "Calibrate";
  start.addEventListener("click", async () => {
    const knownGrams = parseFloat(value);
    if (!Number.isFinite(knownGrams) || knownGrams <= 0) {
      showToast("Enter a valid weight in grams");
      return;
    }

    setBusy(true);
    start.disabled = true;
    start.textContent = "Calibrating…";
    cancel.disabled = true;

    try {
      const result = await postJSON("/api/maintenance/scale-calibrate", { knownGrams });
      showToast(`Scale calibrated (factor: ${result.factor.toFixed(4)})`, {
        variant: "success",
        duration: 3000,
      });
      close();
    } catch (e) {
      console.error(e);
      showToast(`Calibration failed — ${e.message}`);
      start.disabled = false;
      start.textContent = "Calibrate";
      cancel.disabled = false;
    } finally {
      setBusy(false);
    }
  });

  actions.append(cancel, start);
  panel.appendChild(actions);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !isLocked()) close();
  });

  function close() {
    overlay.remove();
    onClose();
  }

  host.appendChild(overlay);
  return overlay;
}

export function openScaleVisualizationModal({ host }) {
  const { overlay, panel, display } = scaleModalShell("Live Scale Reading");
  display.textContent = "— g";

  const actions = document.createElement("div");
  actions.className = "scale-cal-modal__actions";

  const tareBtn = document.createElement("button");
  tareBtn.type = "button";
  tareBtn.className = "maint-btn tappable";
  tareBtn.textContent = "Tare";
  tareBtn.addEventListener("click", () => {
    sendWS({ type: "SCALE_SESSION_TARE" });
    showToast("Scale tared to 0", { variant: "success" });
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "maint-btn maint-btn--primary tappable";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", close);

  actions.appendChild(tareBtn);
  actions.appendChild(closeBtn);
  panel.appendChild(actions);

  host.appendChild(overlay);

  // Holds the maintenance lock server-side for the modal's lifetime — the
  // server drives the read cadence and streams SCALE_READING events, so
  // the global status indicator stays steady at "Maintenance" instead of
  // flashing as it did when each poll did its own acquire/release.
  const unsubReading = onWS("SCALE_READING", (msg) => {
    if (typeof msg.grams === "number") {
      display.textContent = `${msg.grams.toFixed(1)} g`;
    }
  });
  const unsubReject = onWS("SCALE_SESSION_REJECTED", () => {
    display.textContent = "Busy";
    tareBtn.disabled = true;
  });
  sendWS({ type: "SCALE_SESSION_START" });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  function close() {
    sendWS({ type: "SCALE_SESSION_END" });
    unsubReading();
    unsubReject();
    overlay.remove();
  }

  return overlay;
}
