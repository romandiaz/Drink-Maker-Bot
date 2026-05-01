import { navigate } from "../app.js";
import { drinks, getDrinkById } from "../drinks.js";
import { header } from "../components/header.js";
import { glass } from "../components/glass.js";
import { on, send } from "../ws.js";
import { appState, setLastDrink } from "../state.js";
import { formatIngredient as formatStepName } from "../format.js";

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
  glassCol.appendChild(glass(drink, { width: 240 }));
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
      navigate("complete", { drinkId: msg.drinkId });
    })
  );
  // Shots don't have a "detail" screen to return to — send the user back to the
  // shot picker on cancel/error instead.
  function backOnAbort() {
    if (order.customDrink) navigate("shotPicker", {}, "pop");
    else navigate("detail", { drinkId: drink.id }, "pop");
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
    on("POUR_ERROR", () => {
      pourActive = false;
      appState.pourProgress = null;
      cleanup();
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
