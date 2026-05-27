import { navigate, replaceWith } from "../app.js";
import { drinks, getDrinkById, estimatePourSeconds } from "../drinks.js";
import { header } from "../components/header.js";
import { glass, layeredGlass } from "../components/glass.js";
import { on } from "../ws.js";
import { formatIngredient as formatStepName } from "../format.js";
import { showToast } from "../components/toast.js";
import { flowRateForIngredient, defaultFlowOzPerSec } from "../calibration-store.js";
import { PLUS_SVG } from "../icons.js";
import { getMachineStatus, onMachineStatus } from "../machine-status.js";
import { getQueue, cancelPour } from "../queue-store.js";

// Map a backend POUR_ERROR payload to display copy. Codes come from
// src/server/serialPour.js and src/server/pour.js. The default branch
// preserves the raw firmware reason and any attached message so the
// Notifications tab carries enough info to debug what actually happened —
// otherwise every unknown failure looked identical to "Pour failed at X".
function pourErrorMessage(msg) {
  const ing = msg.ingredient ? formatStepName(msg.ingredient) : null;
  const where = ing ? ` at ${ing}` : "";
  const stepName = ing || "step";
  switch (msg.code) {
    case "INGREDIENT_NOT_LOADED":
      return ing ? `No ${ing} loaded — check inventory` : "Ingredient not loaded";
    case "OUT_OF_INGREDIENT":
      return ing ? `Out of ${ing}` : "Out of an ingredient";
    case "UNKNOWN_DRINK":
      return "Drink not found";
    case "NO_GLASS":
      return "No glass detected — place a glass on the tray and try again";
    case "SERIAL_ERROR":
      return msg.message
        ? `Hardware error${where}: ${msg.message}`
        : `Hardware error${where} — try again`;
    default: {
      // Firmware terminal lines documented in firmware/bartender/bartender.ino:
      //   ERR pour-timeout <grams>   60s elapsed before reaching target
      //   ERR no-flow <grams>        5s without measurable progress (empty/clog)
      //   ERR scale-timeout <grams>  HX711 stopped responding
      //   ERR glass-removed <grams>  glass lifted mid-pour
      //   ERR aborted                STOP received mid-pour
      // The trailing number is GRAMS the load cell measured, not seconds —
      // surfacing it with units prevents the "98.40s vs 122s estimate"
      // confusion the raw form caused.
      const raw = typeof msg.code === "string" ? msg.code : "";
      const errMatch = raw.match(/^ERR\s+([\w-]+)\s*(.*)$/);
      if (errMatch) {
        const kind = errMatch[1];
        const grams = parseFloat(errMatch[2]);
        const gramsLabel = Number.isFinite(grams)
          ? ` (${grams.toFixed(1)}g delivered)`
          : "";
        switch (kind) {
          case "pour-timeout":
            return `Pump timeout at ${stepName} — 60s elapsed${gramsLabel}. Flow slower than calibration; check pump or recalibrate.`;
          case "no-flow":
            return `No flow at ${stepName}${gramsLabel}. Out of bottle, or clogged tube.`;
          case "scale-timeout":
            return `Scale stopped responding at ${stepName}${gramsLabel}.`;
          case "glass-removed":
            return `Glass was removed during pour${gramsLabel}. Place a glass and try again.`;
          case "aborted":
            return `Pour aborted${where}`;
        }
      }
      // Unknown ERR or non-ERR code — preserve verbatim so something useful
      // makes it to the Notifications log.
      const reason = raw.startsWith("ERR")
        ? raw.slice(3).trim().replace(/_/g, " ")
        : raw;
      const detail = msg.message ? ` (${msg.message})` : "";
      if (reason) return `Pour failed${where}: ${reason}${detail}`;
      return `Pour failed${where}${detail}`;
    }
  }
}

// The pouring screen is a passive view of a server-orchestrated pour. The pour
// runs server-side regardless of frontend navigation — leaving this screen
// (e.g. to queue another drink) does not interrupt it. The current order
// rides on the shared machine job.
export function pouring(props = {}) {
  const job = getMachineStatus().job;
  const order =
    job?.order ||
    props.order || {
      drinkId: props.drinkId || drinks[0].id,
      strength: "regular",
      amount: 1.0,
    };
  const drink = order.customDrink || getDrinkById(order.drinkId);
  // Ingredients the user pours by hand after the machine finishes — excluded
  // from the progress dots so the backend isn't expected to dispense them.
  const skipNames = new Set((order.missingByHand || []).map((i) => i.name));
  const pouredIngredients = drink.ingredients.filter((i) => !skipNames.has(i.name));

  const element = document.createElement("section");
  element.className = "screen screen--pouring";
  element.dataset.screen = "pouring";

  // Back button is allowed — the pour continues server-side, so leaving to
  // browse or queue another drink is safe. The status pill shows "Pouring · N"
  // and taps through to the queue.
  element.appendChild(
    header({
      back: true,
      eyebrow: "Now pouring",
      title: drink.name,
      right: "ready",
    })
  );

  const main = document.createElement("div");
  main.className = "pouring-main";

  const glassCol = document.createElement("div");
  glassCol.className = "pouring-glass";
  const renderGlass = drink.isCustom ? layeredGlass : glass;
  glassCol.appendChild(renderGlass(drink, { width: 240 }));
  main.appendChild(glassCol);

  const progressCol = document.createElement("div");
  progressCol.className = "pouring-progress";

  const stepRow = document.createElement("div");
  stepRow.className = "pouring-step-row";

  const stepLabel = document.createElement("div");
  stepLabel.className = "pouring-step-label";
  stepLabel.setAttribute("aria-live", "polite");
  stepLabel.textContent = "Starting…";
  stepRow.appendChild(stepLabel);

  // Estimated time remaining, paired with the step label. Counts down once
  // pouring begins; re-anchored to actual progress on every POUR_PROGRESS.
  const timerEl = document.createElement("div");
  timerEl.className = "pouring-timer";
  stepRow.appendChild(timerEl);

  progressCol.appendChild(stepRow);

  const bar = document.createElement("div");
  bar.className = "pouring-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", "0");
  const fill = document.createElement("div");
  fill.className = "pouring-bar__fill";
  bar.appendChild(fill);
  progressCol.appendChild(bar);

  const dots = document.createElement("div");
  dots.className = "pouring-dots";
  pouredIngredients.forEach((ing) => {
    const dot = document.createElement("div");
    dot.className = "pouring-dot";
    const mark = document.createElement("span");
    mark.className = "pouring-dot__mark";
    const lbl = document.createElement("span");
    lbl.className = "pouring-dot__label";
    lbl.textContent = formatStepName(ing.name);
    dot.append(mark, lbl);
    dots.appendChild(dot);
  });
  progressCol.appendChild(dots);

  main.appendChild(progressCol);
  element.appendChild(main);

  // Footer: "Add drink" (browse the menu to queue another — the pour keeps
  // running) + hold-to-cancel. Wrapped in .pour-stage-footer so the reserved
  // height matches the complete screen's and the glass holds its Y position.
  const footer = document.createElement("div");
  footer.className = "pour-stage-footer";
  const actions = document.createElement("div");
  actions.className = "pour-actions";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "round-add-btn tappable";
  addBtn.innerHTML = `${PLUS_SVG}<span>Add drink</span>`;
  addBtn.addEventListener("click", () => navigate("category"));
  actions.appendChild(addBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pour-cancel";
  cancelBtn.innerHTML = `
    <span class="pour-cancel__fill"></span>
    <span class="pour-cancel__label">Cancel · hold 2s</span>
  `;
  actions.appendChild(cancelBtn);
  footer.appendChild(actions);
  element.appendChild(footer);

  function setProgress(pct, stepIndex, stepName) {
    const clamped = Math.max(0, Math.min(1, pct));
    fill.style.transform = `scaleX(${clamped})`;
    bar.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
    if (stepName) stepLabel.textContent = `Pouring ${formatStepName(stepName)}`;
    const dotEls = dots.querySelectorAll(".pouring-dot");
    dotEls.forEach((d, i) => {
      d.classList.remove("is-active", "is-done");
      if (i < stepIndex) d.classList.add("is-done");
      else if (i === stepIndex) d.classList.add("is-active");
    });
  }

  // ---- Countdown timer ------------------------------------------------
  const estimatedTotalSec = estimatePourSeconds(drink, order.strength, order.amount, {
    flowRateForIngredient,
    defaultFlowOzPerSec: defaultFlowOzPerSec(),
  });
  let projectedTotalSec = estimatedTotalSec;
  let totalSeededFromObserved = false;
  let remainingSec = estimatedTotalSec;
  let pourBegun = false;
  let pourStartedAt = 0;
  let timerInterval = null;

  function clockFormat(sec) {
    const s = Math.max(0, Math.round(sec));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function renderTimer() {
    if (!pourBegun) {
      timerEl.classList.remove("is-finishing");
      timerEl.textContent = `~${clockFormat(estimatedTotalSec)}`;
      return;
    }
    const finishing = remainingSec <= 3;
    timerEl.classList.toggle("is-finishing", finishing);
    timerEl.textContent = finishing ? "Almost done" : `~${clockFormat(remainingSec)}`;
  }

  function tickTimer() {
    if (!pourBegun) return;
    remainingSec = Math.max(0, remainingSec - 1);
    renderTimer();
  }

  // Refine the total-duration estimate from observed progress — only ever
  // pulling the countdown lower, never up, never to a stall.
  function syncTimer(pct) {
    const p = Math.max(0, Math.min(1, Number(pct) || 0));
    if (!pourBegun) {
      pourBegun = true;
      pourStartedAt = Date.now();
      timerInterval = setInterval(tickTimer, 1000);
    }
    const elapsed = (Date.now() - pourStartedAt) / 1000;
    if (p >= 0.08 && elapsed >= 2) {
      const observedTotal = elapsed / p;
      if (!totalSeededFromObserved) {
        projectedTotalSec = observedTotal;
        totalSeededFromObserved = true;
      } else {
        projectedTotalSec += (observedTotal - projectedTotalSec) * 0.2;
      }
    }
    const target = Math.max(0, projectedTotalSec - elapsed);
    if (target < remainingSec) {
      remainingSec += (target - remainingSec) * 0.5;
    }
    renderTimer();
  }

  renderTimer();

  let unsubs = [];
  let routed = false;

  function cleanup() {
    for (const unsub of unsubs) unsub();
    unsubs = [];
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // The pour ended (idle / maintenance grab). The server has already parked
  // the queue if more drinks wait — route to the queue screen for the
  // glass-swap pause, otherwise to the complete screen. Deferred so we can't
  // re-enter doTransition from inside a state-change listener.
  function routeAfterPour() {
    if (routed) return;
    routed = true;
    const q = getQueue();
    const goQueue = q.awaitingContinue && q.entries.length > 0;
    cleanup();
    queueMicrotask(() => {
      if (goQueue) replaceWith("queue");
      else replaceWith("complete", { order });
    });
  }

  unsubs.push(
    on("POUR_PROGRESS", (msg) => {
      if (routed) return;
      if (msg.status === "waiting-for-glass") {
        stepLabel.textContent = "Please place your glass on the tray...";
        return;
      }
      setProgress(msg.pct, msg.stepIndex, msg.step);
      syncTimer(msg.pct);
    })
  );
  // Error copy surfaces as a toast; the actual screen transition is driven by
  // MACHINE_STATE going idle below (the server parks / finishes the queue).
  unsubs.push(
    on("POUR_ERROR", (msg) => {
      if (!routed) showToast(pourErrorMessage(msg));
    })
  );
  // Single source of truth for "is the pour still running". Resyncs the bar
  // while pouring; routes onward the moment the machine is no longer pouring.
  unsubs.push(
    onMachineStatus((s) => {
      if (routed) return;
      if (s.status === "pouring") {
        const j = s.job;
        if (j && j.progress !== undefined) {
          setProgress(j.progress, j.stepIndex ?? -1, j.step);
          syncTimer(j.progress);
        }
      } else {
        routeAfterPour();
      }
    })
  );

  // Hold-to-cancel: a 2s hold fires POUR_CANCEL; releasing early aborts it.
  let holdTimer = null;
  function startHold() {
    cancelBtn.classList.add("is-holding");
    holdTimer = setTimeout(() => {
      cancelBtn.classList.remove("is-holding");
      cancelPour();
    }, 2000);
  }
  function endHold() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    cancelBtn.classList.remove("is-holding");
  }
  cancelBtn.addEventListener("pointerdown", startHold);
  cancelBtn.addEventListener("pointerup", endHold);
  cancelBtn.addEventListener("pointerleave", endHold);
  cancelBtn.addEventListener("pointercancel", endHold);

  function mount() {}

  function unmount() {
    cleanup();
    endHold();
    // No cancel on unmount — the pour is server-owned and continues. Leaving
    // this screen (to browse / queue another drink) is a supported action.
  }

  return { element, mount, unmount };
}
