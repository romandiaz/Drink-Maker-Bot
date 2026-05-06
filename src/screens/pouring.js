import { goBack, replaceWith } from "../app.js";
import { drinks, getDrinkById } from "../drinks.js";
import { header } from "../components/header.js";
import { glass, layeredGlass } from "../components/glass.js";
import { on, send } from "../ws.js";
import { appState, setLastDrink } from "../state.js";
import { formatIngredient as formatStepName } from "../format.js";
import { showToast } from "../components/toast.js";

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
    case "SERIAL_ERROR":
      return msg.message
        ? `Hardware error${where}: ${msg.message}`
        : `Hardware error${where} — try again`;
    default: {
      // Firmware terminal lines documented in firmware/bartender/bartender.ino:
      //   ERR pour-timeout <grams>   60s elapsed before reaching target
      //   ERR no-flow <grams>        5s without measurable progress (empty/clog)
      //   ERR scale-timeout <grams>  HX711 stopped responding
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

export function pouring(props = {}) {
  const drinkId =
    props.drinkId ||
    appState.pendingOrder?.drinkId ||
    appState.selectedDrink ||
    drinks[0].id;
  const order =
    appState.pendingOrder?.drinkId === drinkId
      ? appState.pendingOrder
      : { drinkId, strength: "regular", amount: 1.0 };
  // Shots (and any future ad-hoc pours) carry a synthesized drink on the order
  // rather than appearing in drinks[].
  const drink = order.customDrink || getDrinkById(drinkId);
  // Ingredients the user pours by hand after the machine finishes — recorded
  // on the order in detail.js. Excluded from the progress dots and from the
  // POUR message so the backend doesn't try to dispense something it can't.
  const skipNames = new Set((order.missingByHand || []).map((i) => i.name));
  const pouredIngredients = drink.ingredients.filter((i) => !skipNames.has(i.name));

  const element = document.createElement("section");
  element.className = "screen screen--pouring";
  element.dataset.screen = "pouring";

  // Ready indicator hidden — the machine is busy, not ready.
  element.appendChild(
    header({
      back: false,
      eyebrow: "Now pouring",
      title: drink.name,
      right: "none",
    })
  );

  const main = document.createElement("div");
  main.className = "pouring-main";

  const glassCol = document.createElement("div");
  glassCol.className = "pouring-glass";
  // Custom drinks have no photo and no meaningful single `color` — render the
  // same proportional band visualization the user just confirmed on the build
  // screen so the pour view matches what they designed.
  const renderGlass = drink.isCustom ? layeredGlass : glass;
  glassCol.appendChild(renderGlass(drink, { width: 240 }));
  main.appendChild(glassCol);

  const progressCol = document.createElement("div");
  progressCol.className = "pouring-progress";

  const stepLabel = document.createElement("div");
  stepLabel.className = "pouring-step-label";
  stepLabel.setAttribute("aria-live", "polite");
  stepLabel.textContent = "Starting…";
  progressCol.appendChild(stepLabel);

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

  // Hold-to-cancel button at the bottom. Wrapped in .pour-stage-footer so the
  // reserved footer height matches the complete screen's — keeps the glass at
  // the same Y position across both screens.
  const footer = document.createElement("div");
  footer.className = "pour-stage-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pour-cancel";
  cancelBtn.innerHTML = `
    <span class="pour-cancel__fill"></span>
    <span class="pour-cancel__label">Cancel · hold 2s</span>
  `;
  footer.appendChild(cancelBtn);
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

  let unsubs = [];
  let pourActive = true;

  function cleanup() {
    for (const unsub of unsubs) unsub();
    unsubs = [];
  }

  unsubs.push(
    on("POUR_PROGRESS", (msg) => {
      if (msg.step) appState.pourProgress = msg;
      setProgress(msg.pct, msg.stepIndex, msg.step);
    })
  );
  unsubs.push(
    on("POUR_COMPLETE", (msg) => {
      if (msg.drinkId !== drink.id) return;
      pourActive = false;
      appState.pourProgress = null;
      setLastDrink(msg.drinkId);
      cleanup();
      // Replace pouring with complete on the stack — a finished pour should
      // never be a back target.
      replaceWith("complete", { drinkId: msg.drinkId }, "push");
    })
  );
  // Cancel / error: pop pouring off the stack so it doesn't linger as a back
  // target. Regular drinks rewind one entry to detail; shots rewind two
  // entries — past shotDetail, back to the picker — so the user can choose a
  // different spirit instead of having to re-confirm the same one. Build-
  // your-own (also a customDrink) only rewinds one — back to the editor so
  // the user can tweak and retry.
  function backOnAbort() {
    if (order.customDrink?.isShot) goBack(2);
    else goBack();
  }

  unsubs.push(
    on("POUR_CANCELLED", (msg) => {
      if (msg.drinkId !== drink.id) return;
      pourActive = false;
      appState.pourProgress = null;
      cleanup();
      backOnAbort();
    })
  );
  unsubs.push(
    on("POUR_ERROR", (msg) => {
      pourActive = false;
      appState.pourProgress = null;
      cleanup();
      showToast(pourErrorMessage(msg));
      backOnAbort();
    })
  );
  // Race: another tablet (or maintenance) grabbed the machine in the gap
  // between this tablet's tap and the POUR arriving. Bounce back to detail
  // — the busy indicator will be visible there.
  unsubs.push(
    on("POUR_REJECTED", () => {
      pourActive = false;
      appState.pourProgress = null;
      cleanup();
      showToast("Machine busy — try again in a moment");
      backOnAbort();
    })
  );

  // Hold-to-cancel: a 2s timer fires POUR_CANCEL; releasing early aborts the timer
  // and the .is-holding class drives the fill animation in CSS.
  let holdTimer = null;
  function startHold() {
    cancelBtn.classList.add("is-holding");
    holdTimer = setTimeout(() => {
      cancelBtn.classList.remove("is-holding");
      send({ type: "POUR_CANCEL", drinkId: drink.id });
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

  function mount() {
    setProgress(0, -1, null);
    send({
      type: "POUR",
      drinkId: drink.id,
      strength: order.strength,
      amount: order.amount,
      // Ad-hoc drinks (e.g. shots) aren't in the backend's catalog — ship the
      // full definition inline so mockPour can run it.
      customDrink: order.customDrink,
      // By-hand ingredients aren't loaded in pumps — backend skips both the
      // timed pour and the inventory consume() for these.
      skipIngredients: skipNames.size ? [...skipNames] : undefined,
    });
  }

  function unmount() {
    cleanup();
    endHold();
    // Navigated away mid-pour (e.g. via debug nav) — tell the backend to stop.
    if (pourActive) send({ type: "POUR_CANCEL", drinkId: drink.id });
  }

  return { element, mount, unmount };
}
