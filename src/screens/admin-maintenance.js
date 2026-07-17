import { ingredientName } from "../ingredients.js";
import { getJSON, postJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { getMachineStatus, onMachineStatus } from "../machine-status.js";
import { actionBtn, sectionHead, formatRate } from "../components/maint-ui.js";
import { openCalibrate } from "../components/calibrate-modal.js";
import {
  openScaleCalibrateModal,
  openScaleVisualizationModal,
} from "../components/scale-modals.js";
import { createBackupSection } from "./admin-backup.js";

// Maintenance view for the admin tab shell. Three groups of canned routines:
//
//   Quick actions   → "Prime all" / "Flush all" run a short pulse on every
//                     loaded slot. Cheap recovery moves after a power cycle
//                     or a long idle.
//
//   Per-slot        → A row per inventory slot with Prime / Flush / Calibrate
//                     buttons. Calibrate kicks the user into a two-step
//                     "pour ~1.5 oz, tell me what came out" flow that
//                     updates the slot's flow rate in calibration.json.
//
//   Reference rate  → The default rate used for slots without their own
//                     measurement. Editable but rarely touched.
//
// Scale calibration, the slot-calibration flow, and backup/restore each live in
// their own modules (scale-modals.js, calibrate-modal.js, admin-backup.js);
// this file owns the core layout, the busy-lock state, and data loading.
//
// Calibration directly affects the pour-time estimates shown on the detail
// and shot screens — see drinks.js#estimatePourSeconds.

const PRIME_DURATION_SEC = 6;
const FLUSH_DURATION_SEC = 15;

function row(label, valueEl) {
  const wrap = document.createElement("div");
  wrap.className = "maint-meta";
  const l = document.createElement("span");
  l.className = "maint-meta__label";
  l.textContent = label;
  wrap.append(l, valueEl);
  return wrap;
}

export function adminMaintenanceView({ host, setMeta }) {
  const element = document.createElement("div");
  element.className = "admin-body admin-body--maintenance";

  let inventory = null;
  let calibration = null;
  let busy = false;
  let calibrateModalEl = null;
  let unsubMachine = null;

  // The local `busy` flag covers in-flight admin requests from this tablet;
  // server-side status covers anyone else (a pour from a kiosk tablet or a
  // second admin session). Either disables the maintenance controls.
  function isLocked() {
    return busy || getMachineStatus().status !== "idle";
  }

  function refreshDisabled() {
    const locked = isLocked();
    element.classList.toggle("is-busy", locked);
    for (const b of element.querySelectorAll(".maint-btn")) {
      if (b.dataset.alwaysEnabled) continue;
      if (b.dataset.alwaysDisabled) {
        b.disabled = true;
        continue;
      }
      b.disabled = locked;
    }
  }

  function setBusy(v) {
    busy = v;
    refreshDisabled();
  }

  // Owns the on-device backup list; re-renders the whole view when it changes.
  const backup = createBackupSection({ isLocked, setBusy, onChange: () => render() });

  async function load() {
    setMeta("Loading…");
    try {
      const [inv, cal] = await Promise.all([
        getJSON("/api/inventory"),
        getJSON("/api/calibration"),
      ]);
      inventory = inv;
      calibration = cal;
      render();
      // Fetched separately and non-fatally: a backups-list hiccup shouldn't
      // blank the whole maintenance screen. The list re-renders when it lands.
      backup.load();
    } catch (e) {
      console.error(e);
      setMeta("Failed to load maintenance");
      showToast(`Couldn't load maintenance — ${e.message}`);
    }
  }

  function updateMeta() {
    const calibrated = Object.keys(calibration?.flowRateBySlot || {}).length;
    const loaded = inventory.slots.filter((s) => s.ingredientId).length;
    setMeta(`${loaded} loaded · ${calibrated} calibrated`);
  }

  async function runEndpoint(url, body, { successMsg, refreshInventory = false }) {
    if (isLocked()) return;
    setBusy(true);
    try {
      await postJSON(url, body);
      if (refreshInventory) {
        // Prime/clean/calibrate all dispense liquid; pull our local snapshot
        // back in sync. Other tablets' shared caches refresh via the
        // INVENTORY_UPDATED WS broadcast the server emits on consume().
        inventory = await getJSON("/api/inventory");
      }
      if (successMsg) showToast(successMsg, { variant: "success", duration: 2500 });
    } catch (e) {
      console.error(e);
      showToast(`Failed — ${e.message}`);
    } finally {
      setBusy(false);
      render();
    }
  }

  function loadedSlots() {
    return (inventory?.slots || []).filter((s) => s.ingredientId);
  }

  async function runAll(mode) {
    const slots = loadedSlots();
    if (slots.length === 0) {
      showToast("No bottles loaded");
      return;
    }
    if (isLocked()) return;
    setBusy(true);
    const durationSec = mode === "clean" ? FLUSH_DURATION_SEC : PRIME_DURATION_SEC;
    let failures = 0;
    for (const s of slots) {
      try {
        await postJSON("/api/maintenance/run", {
          slot: s.slot,
          durationSec,
          mode,
        });
      } catch (e) {
        failures++;
        console.error(`${mode} slot ${s.slot} failed:`, e);
      }
    }
    try {
      inventory = await getJSON("/api/inventory");
    } catch {}
    setBusy(false);
    if (failures === 0) {
      showToast(
        mode === "clean"
          ? `Flushed ${slots.length} slot${slots.length === 1 ? "" : "s"}`
          : `Primed ${slots.length} slot${slots.length === 1 ? "" : "s"}`,
        { variant: "success", duration: 2500 }
      );
    } else {
      showToast(`${failures} of ${slots.length} runs failed`);
    }
    render();
  }

  function renderScaleCalibration() {
    const card = document.createElement("section");
    card.className = "maint-card";
    card.appendChild(
      sectionHead("Scale calibration", "Tare and calibrate the on-board load cell")
    );

    const buttons = document.createElement("div");
    buttons.className = "maint-quick";
    buttons.style.gridTemplateColumns = "repeat(3, 1fr)";

    const tare = actionBtn("Tare scale");
    tare.addEventListener("click", () =>
      runEndpoint("/api/maintenance/scale-tare", {}, { successMsg: "Scale tared to 0" })
    );
    buttons.appendChild(tare);

    const read = actionBtn("Read scale");
    read.addEventListener("click", () => openScaleVisualizationModal({ host }));
    buttons.appendChild(read);

    const calibrate = actionBtn("Calibrate scale", { tone: "primary" });
    calibrate.addEventListener("click", openScaleCalibrate);
    buttons.appendChild(calibrate);

    card.appendChild(buttons);

    const note = document.createElement("p");
    note.className = "maint-note";
    note.textContent =
      "Tare: zeroes out the current reading. Calibrate: uses a known weight to calculate the scale factor.";
    card.appendChild(note);

    return card;
  }

  function renderQuickActions() {
    const card = document.createElement("section");
    card.className = "maint-card";
    card.appendChild(
      sectionHead("Quick actions", "Runs every loaded slot")
    );

    const buttons = document.createElement("div");
    buttons.className = "maint-quick";

    const prime = actionBtn(`Prime all · ${PRIME_DURATION_SEC}s each`);
    prime.addEventListener("click", () => runAll("prime"));
    buttons.appendChild(prime);

    const clean = actionBtn(`Flush all · ${FLUSH_DURATION_SEC}s each`, {
      tone: "warn",
    });
    clean.addEventListener("click", () => runAll("clean"));
    buttons.appendChild(clean);

    card.appendChild(buttons);

    const note = document.createElement("p");
    note.className = "maint-note";
    note.textContent =
      "Prime: pulls liquid through air-filled tubing after a bottle swap. Flush: longer run; load water bottles in slots first.";
    card.appendChild(note);

    return card;
  }

  function renderSlotRow(slot) {
    const slotRow = document.createElement("div");
    slotRow.className = "maint-slot";
    if (!slot.ingredientId) slotRow.classList.add("is-empty");

    const num = document.createElement("span");
    num.className = "maint-slot__num";
    num.textContent = String(slot.slot).padStart(2, "0");
    slotRow.appendChild(num);

    const info = document.createElement("div");
    info.className = "maint-slot__info";

    const name = document.createElement("div");
    name.className = "maint-slot__name";
    name.textContent = slot.ingredientId
      ? ingredientName(slot.ingredientId)
      : "Empty";
    info.appendChild(name);

    const rate = calibration?.flowRateBySlot?.[slot.slot];
    const calibrated = Number.isFinite(rate);
    const meta = document.createElement("div");
    meta.className = "maint-slot__meta";
    if (calibrated) {
      meta.innerHTML = `<span class="maint-slot__rate">${formatRate(rate)}</span>`;
    } else {
      meta.innerHTML = `<span class="maint-slot__rate is-default">${formatRate(
        calibration?.defaultFlowOzPerSec
      )} · default</span>`;
    }
    info.appendChild(meta);

    slotRow.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "maint-slot__actions";

    const prime = actionBtn("Prime");
    if (!slot.ingredientId) {
      prime.disabled = true;
      prime.dataset.alwaysDisabled = "1";
    }
    prime.addEventListener("click", () =>
      runEndpoint(
        "/api/maintenance/run",
        { slot: slot.slot, durationSec: PRIME_DURATION_SEC, mode: "prime" },
        { successMsg: `Primed slot ${slot.slot}`, refreshInventory: true }
      )
    );
    actions.appendChild(prime);

    const flush = actionBtn("Flush", { tone: "warn" });
    if (!slot.ingredientId) {
      flush.disabled = true;
      flush.dataset.alwaysDisabled = "1";
    }
    flush.addEventListener("click", () =>
      runEndpoint(
        "/api/maintenance/run",
        { slot: slot.slot, durationSec: FLUSH_DURATION_SEC, mode: "clean" },
        { successMsg: `Flushed slot ${slot.slot}`, refreshInventory: true }
      )
    );
    actions.appendChild(flush);

    const calBtn = actionBtn(calibrated ? "Recalibrate" : "Calibrate", {
      tone: "primary",
    });
    if (!slot.ingredientId) {
      calBtn.disabled = true;
      calBtn.dataset.alwaysDisabled = "1";
    }
    calBtn.addEventListener("click", () => openSlotCalibrate(slot));
    actions.appendChild(calBtn);

    slotRow.appendChild(actions);
    return slotRow;
  }

  function renderSlotList() {
    const card = document.createElement("section");
    card.className = "maint-card";
    card.appendChild(
      sectionHead("Per slot", "Prime, flush, or calibrate one bottle")
    );
    const list = document.createElement("div");
    list.className = "maint-slot-list";
    for (const slot of inventory.slots) list.appendChild(renderSlotRow(slot));
    card.appendChild(list);
    return card;
  }

  function renderReference() {
    const card = document.createElement("section");
    card.className = "maint-card";
    card.appendChild(
      sectionHead(
        "Default flow rate",
        "Used when a slot hasn't been calibrated yet"
      )
    );
    const valueEl = document.createElement("span");
    valueEl.className = "maint-meta__value";
    valueEl.textContent = formatRate(calibration?.defaultFlowOzPerSec);
    card.appendChild(row("Reference", valueEl));
    return card;
  }

  function renderLedTest() {
    const card = document.createElement("section");
    card.className = "maint-card";
    card.appendChild(
      sectionHead("LED strip", "Cycle the light patterns to check wiring")
    );

    const buttons = document.createElement("div");
    buttons.className = "maint-quick";

    const test = actionBtn("Test LED strip", { tone: "primary" });
    test.addEventListener("click", () =>
      runEndpoint("/api/maintenance/led-test", {}, { successMsg: "LED test complete" })
    );
    buttons.appendChild(test);

    card.appendChild(buttons);

    const note = document.createElement("p");
    note.className = "maint-note";
    note.textContent =
      "Runs a ~7-second sequence — waiting pulse, progress bar, celebration, then error — and returns to idle. If the strip stays dark, the backend is in mock mode (check LED_STRIP is set and that it runs as root).";
    card.appendChild(note);

    return card;
  }

  function render() {
    element.innerHTML = "";
    if (!inventory || !calibration) return;
    element.appendChild(renderScaleCalibration());
    element.appendChild(renderQuickActions());
    element.appendChild(renderSlotList());
    element.appendChild(renderReference());
    element.appendChild(renderLedTest());
    element.appendChild(backup.renderExport());
    element.appendChild(backup.renderSaved());
    updateMeta();
    // Apply lock state to the freshly-rendered buttons; otherwise a re-render
    // during a remote pour would briefly enable everything until the next
    // status event arrives.
    refreshDisabled();
  }

  // --- Modals ---
  // Each modal module appends its overlay to `host` and returns it; we track
  // the active one in calibrateModalEl so opening another (or unmounting the
  // screen) tears down the previous. The live-read modal manages its own
  // lifetime (it also holds a server-side scale session) and isn't tracked.

  function openSlotCalibrate(slot) {
    if (calibrateModalEl) calibrateModalEl.remove();
    calibrateModalEl = openCalibrate({
      host,
      slot,
      setBusy,
      refreshInventory: async () => {
        try {
          inventory = await getJSON("/api/inventory");
        } catch {}
      },
      onSaved: async () => {
        calibration = await getJSON("/api/calibration");
        render();
      },
      onClose: () => {
        calibrateModalEl = null;
      },
    });
  }

  function openScaleCalibrate() {
    if (calibrateModalEl) calibrateModalEl.remove();
    calibrateModalEl = openScaleCalibrateModal({
      host,
      setBusy,
      isLocked,
      onClose: () => {
        calibrateModalEl = null;
      },
    });
  }

  function mount() {
    load();
    let lastStatus = getMachineStatus().status;
    unsubMachine = onMachineStatus((s) => {
      if (s.status === lastStatus) return;
      lastStatus = s.status;
      refreshDisabled();
    });
  }

  function unmount() {
    if (calibrateModalEl) {
      calibrateModalEl.remove();
      calibrateModalEl = null;
    }
    if (unsubMachine) {
      unsubMachine();
      unsubMachine = null;
    }
  }

  return { element, mount, unmount };
}
