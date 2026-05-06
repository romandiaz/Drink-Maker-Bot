import { ingredientName } from "../ingredients.js";
import { getJSON, postJSON } from "../api.js";
import {
  reloadInventory,
  reloadCalibration,
} from "../app.js";
import { showToast } from "../components/toast.js";
import { getMachineStatus, onMachineStatus } from "../machine-status.js";

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
// Calibration directly affects the pour-time estimates shown on the detail
// and shot screens — see drinks.js#estimatePourSeconds.

const PRIME_DURATION_SEC = 6;
const FLUSH_DURATION_SEC = 15;
// Long enough to dampen pump start-up jitter (first ~1s flow rate is uneven
// while the line repressurises) but short enough that an admin doesn't lose
// patience and the cup doesn't overflow at fast pump rates. ~60g at the
// default rate ≈ 2 oz, which fits a standard shot glass.
const CALIBRATE_DURATION_SEC = 8;

function formatRate(ozPerSec) {
  if (!Number.isFinite(ozPerSec) || ozPerSec <= 0) return "—";
  // Display as seconds-per-ounce — easier to reason about for a person
  // watching a stream than a fractional oz/sec figure.
  return `${(1 / ozPerSec).toFixed(1)} s/oz`;
}

function row(label, valueEl) {
  const wrap = document.createElement("div");
  wrap.className = "maint-meta";
  const l = document.createElement("span");
  l.className = "maint-meta__label";
  l.textContent = label;
  wrap.append(l, valueEl);
  return wrap;
}

function sectionHead(title, subtitle) {
  const head = document.createElement("div");
  head.className = "maint-section-head";
  const t = document.createElement("div");
  t.className = "maint-section-head__title";
  t.textContent = title;
  head.appendChild(t);
  if (subtitle) {
    const s = document.createElement("div");
    s.className = "maint-section-head__sub";
    s.textContent = subtitle;
    head.appendChild(s);
  }
  return head;
}

function actionBtn(label, opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `maint-btn tappable${opts.tone ? ` maint-btn--${opts.tone}` : ""}`;
  btn.textContent = label;
  if (opts.disabled) btn.disabled = true;
  return btn;
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
        // Prime/clean/calibrate all dispense liquid, so the bottle level
        // shown elsewhere should reflect the run.
        const inv = await getJSON("/api/inventory");
        inventory = inv;
        await reloadInventory();
      }
      if (successMsg) showToast(successMsg, { variant: "info", duration: 2500 });
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
      const inv = await getJSON("/api/inventory");
      inventory = inv;
      await reloadInventory();
    } catch {}
    setBusy(false);
    if (failures === 0) {
      showToast(
        mode === "clean"
          ? `Flushed ${slots.length} slot${slots.length === 1 ? "" : "s"}`
          : `Primed ${slots.length} slot${slots.length === 1 ? "" : "s"}`,
        { variant: "info", duration: 2500 }
      );
    } else {
      showToast(`${failures} of ${slots.length} runs failed`);
    }
    render();
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
    const row = document.createElement("div");
    row.className = "maint-slot";
    if (!slot.ingredientId) row.classList.add("is-empty");

    const num = document.createElement("span");
    num.className = "maint-slot__num";
    num.textContent = String(slot.slot).padStart(2, "0");
    row.appendChild(num);

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

    row.appendChild(info);

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
    calBtn.addEventListener("click", () => openCalibrate(slot));
    actions.appendChild(calBtn);

    row.appendChild(actions);
    return row;
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

  function render() {
    element.innerHTML = "";
    if (!inventory || !calibration) return;
    element.appendChild(renderQuickActions());
    element.appendChild(renderSlotList());
    element.appendChild(renderReference());
    updateMeta();
    // Apply lock state to the freshly-rendered buttons; otherwise a re-render
    // during a remote pour would briefly enable everything until the next
    // status event arrives.
    refreshDisabled();
  }

  // --- Calibration modal ---
  // Run the pump for a fixed time, let the on-board scale weigh the result,
  // and persist (grams / seconds) → oz/sec. The admin doesn't enter a
  // number; they just place a cup on the platform and confirm the result.

  function openCalibrate(slot) {
    if (calibrateModalEl) calibrateModalEl.remove();
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
      if (calibrateModalEl === overlay) calibrateModalEl = null;
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
        try {
          inventory = await getJSON("/api/inventory");
          await reloadInventory();
        } catch {}
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
          calibration = await getJSON("/api/calibration");
          await reloadCalibration();
          showToast(`Slot ${slot.slot} calibrated`, {
            variant: "info",
            duration: 2500,
          });
          close();
          render();
        } catch (e) {
          console.error(e);
          showToast(`Save failed — ${e.message}`);
        }
      });
      actions.append(repour, save);
    }

    renderReady();
    host.appendChild(overlay);
    calibrateModalEl = overlay;
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
