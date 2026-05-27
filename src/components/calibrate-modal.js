// Slot pump-calibration modal. Run the pump for a fixed time, let the on-board
// scale weigh the result, and persist (grams / seconds) → oz/sec. The admin
// doesn't enter a number; they place a cup on the platform and confirm.
//
// Wiring back to the maintenance view is via callbacks:
//   refreshInventory()  pull the local inventory snapshot after a measure pour
//   onSaved()           refresh calibration + re-render the view after a save
//   onClose()           let the view drop its modal-singleton reference
// The factory appends the overlay to `host` and returns it so the view can
// track / remove it.

import { ingredientName } from "../ingredients.js";
import { postJSON } from "../api.js";
import { showToast } from "./toast.js";
import { actionBtn, formatRate } from "./maint-ui.js";

// Long enough to dampen pump start-up jitter (first ~1s flow rate is uneven
// while the line repressurises) but short enough that an admin doesn't lose
// patience and the cup doesn't overflow at fast pump rates. ~60g at the
// default rate ≈ 2 oz, which fits a standard shot glass.
const CALIBRATE_DURATION_SEC = 8;

export function openCalibrate({ host, slot, setBusy, refreshInventory, onSaved, onClose }) {
  let phase = "ready"; // ready → running → result

  const overlay = document.createElement("div");
  overlay.className = "admin-picker";

  const panel = document.createElement("div");
  panel.className = "maint-cal__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  const title = document.createElement("div");
  title.className = "admin-picker__title";
  title.textContent = `Calibrate slot ${String(slot.slot).padStart(2, "0")} · ${ingredientName(slot.ingredientId)}`;
  panel.appendChild(title);

  const body = document.createElement("div");
  body.className = "maint-cal__body";
  panel.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "maint-cal__actions";
  panel.appendChild(actions);

  overlay.appendChild(panel);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && phase !== "running") close();
  });

  function close() {
    overlay.remove();
    onClose();
  }

  function renderReady() {
    phase = "ready";
    body.innerHTML = "";
    const p1 = document.createElement("p");
    p1.className = "maint-cal__copy";
    p1.textContent = `Place an empty cup on the platform under slot ${slot.slot}. We'll run the pump for ${CALIBRATE_DURATION_SEC} seconds and weigh what comes out.`;
    body.appendChild(p1);

    actions.innerHTML = "";
    const cancel = actionBtn("Cancel");
    cancel.dataset.alwaysEnabled = "1";
    cancel.addEventListener("click", close);
    const start = actionBtn("Start pour", { tone: "primary" });
    start.dataset.alwaysEnabled = "1";
    start.addEventListener("click", runPour);
    actions.append(cancel, start);
  }

  async function runPour() {
    phase = "running";
    body.innerHTML = "";
    const status = document.createElement("p");
    status.className = "maint-cal__copy";
    status.textContent = `Pouring for ${CALIBRATE_DURATION_SEC} seconds… don't touch the cup.`;
    body.appendChild(status);
    actions.innerHTML = "";
    const wait = actionBtn("Pouring…");
    wait.disabled = true;
    wait.dataset.alwaysEnabled = "1";
    actions.appendChild(wait);

    // Lock the underlying maintenance card too — a stray prime tap during
    // the calibration pour would jog the platform and skew the weight.
    setBusy(true);
    try {
      const result = await postJSON("/api/maintenance/calibrate-measure", {
        slot: slot.slot,
        durationSec: CALIBRATE_DURATION_SEC,
      });
      await refreshInventory();
      setBusy(false);
      renderResult(result);
    } catch (e) {
      console.error(e);
      setBusy(false);
      showToast(`Calibration failed — ${e.message}`);
      close();
    }
  }

  function renderResult(result) {
    phase = "result";
    body.innerHTML = "";
    const copy = document.createElement("p");
    copy.className = "maint-cal__copy";
    copy.textContent = `Dispensed ${result.grams.toFixed(1)} g in ${result.durationSec} s.`;
    body.appendChild(copy);

    const rate = document.createElement("div");
    rate.className = "maint-cal__rate";
    rate.textContent = formatRate(result.ozPerSec);
    body.appendChild(rate);

    actions.innerHTML = "";
    const repour = actionBtn("Re-run");
    repour.dataset.alwaysEnabled = "1";
    repour.addEventListener("click", runPour);
    const save = actionBtn("Save calibration", { tone: "primary" });
    save.dataset.alwaysEnabled = "1";
    save.addEventListener("click", async () => {
      try {
        await postJSON("/api/maintenance/calibrate-save", {
          slot: slot.slot,
          ozPerSec: result.ozPerSec,
        });
        showToast(`Slot ${slot.slot} calibrated`, {
          variant: "success",
          duration: 2500,
        });
        close();
        await onSaved();
      } catch (e) {
        console.error(e);
        showToast(`Save failed — ${e.message}`);
      }
    });
    actions.append(repour, save);
  }

  renderReady();
  host.appendChild(overlay);
  return overlay;
}
