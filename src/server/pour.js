import {
  adjustedIngredients,
  getDrinkById,
  totalVolumeOz,
  estimatePourBodySeconds,
  POUR_SETUP_SECONDS,
} from "../drinks.js";
import { consume, loadInventory } from "./inventory.js";
import { record as recordPour } from "./pour-history.js";
import { loadCalibration, flowRateForSlot } from "./calibration.js";

// Mock pour speed multiplier: 1 = realistic time, higher = faster for dev iteration.
// Real serial/GPIO control replaces this later.
const SPEED_MULT = 4;

export function mockPour(order, send) {
  // An ad-hoc pour (e.g. a shot) sends its own drink definition inline since
  // it isn't registered in the shared drinks[] catalog.
  const drink = order.customDrink || getDrinkById(order.drinkId);
  if (!drink) {
    send({ type: "POUR_ERROR", code: "UNKNOWN_DRINK", drinkId: order.drinkId });
    return () => {};
  }

  // The adjusted ingredients are the actual volumes the machine will pour.
  // Frontend and backend share this computation so they stay in sync.
  // skipIngredients carries names the user pours by hand (machine isn't loaded
  // for them) — drop them from both the timed pour and the consume() call so
  // we don't pretend to dispense something we can't.
  const skip = new Set(Array.isArray(order.skipIngredients) ? order.skipIngredients : []);
  const ingredients = adjustedIngredients(drink, order.strength, order.amount).filter(
    (i) => !skip.has(i.name)
  );
  const totalVolume = totalVolumeOz(ingredients);

  let cancelled = false;
  let timer = null;
  let stepIndex = 0;
  let cumulativeVolume = 0;
  // Resolved during the async warmup: per-ingredient flow rate map keyed by
  // ingredient ID, sourced from the slot calibration. Defaults are applied
  // inside estimatePourBodySeconds when a slot has no measurement.
  let totalSeconds = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function startStep() {
    if (cancelled) return;
    if (stepIndex >= ingredients.length) {
      // Mark the pour as finished so a stale cancel() from the server's
      // per-connection cancelPour slot doesn't emit POUR_CANCELLED for the
      // already-completed drink on the next POUR.
      cancelled = true;
      // Inventory is consumed only on successful completion — a cancelled
      // pour leaves the physical state ambiguous, so we don't half-decrement.
      consume(ingredients).catch(() => {});
      recordPour({
        drinkId: drink.id,
        drinkName: drink.name,
        ingredients,
      }).catch(() => {});
      send({ type: "POUR_COMPLETE", drinkId: drink.id });
      return;
    }
    const ing = ingredients[stepIndex];
    const stepDurationMs = (ing.volumeOz / totalVolume) * totalSeconds * 1000;
    const ticks = 6;
    const tickInterval = stepDurationMs / ticks;
    const stepStartVolume = cumulativeVolume;

    send({
      type: "POUR_PROGRESS",
      step: ing.name,
      stepIndex,
      totalSteps: ingredients.length,
      pct: stepStartVolume / totalVolume,
      status: "pouring",
    });

    let tickCount = 0;
    function tick() {
      if (cancelled) return;
      tickCount++;
      const interpolatedVolume =
        stepStartVolume + (ing.volumeOz * tickCount) / ticks;
      send({
        type: "POUR_PROGRESS",
        step: ing.name,
        stepIndex,
        totalSteps: ingredients.length,
        pct: interpolatedVolume / totalVolume,
        status: "pouring",
      });
      if (tickCount < ticks) {
        timer = setTimeout(tick, tickInterval);
      } else {
        cumulativeVolume += ing.volumeOz;
        stepIndex++;
        timer = setTimeout(startStep, 200);
      }
    }
    timer = setTimeout(tick, tickInterval);
  }

  // Resolve calibration + slot mapping before the first step fires. mockPour
  // is normally a sync return so the caller can stash a cancel handle, but
  // the timing math now needs async data — kick off the timers in a then().
  Promise.all([loadCalibration(), loadInventory()])
    .then(([cal, inv]) => {
      if (cancelled) return;
      const slotByIngredient = new Map();
      for (const s of inv.slots) {
        if (s.ingredientId && !slotByIngredient.has(s.ingredientId)) {
          slotByIngredient.set(s.ingredientId, s.slot);
        }
      }
      const flowRateForIngredient = (id) => {
        const slot = slotByIngredient.get(id);
        return slot ? flowRateForSlot(cal, slot) : cal.defaultFlowOzPerSec;
      };
      const body = estimatePourBodySeconds(ingredients, {
        flowRateForIngredient,
        defaultFlowOzPerSec: cal.defaultFlowOzPerSec,
      });
      totalSeconds = (POUR_SETUP_SECONDS + body) / SPEED_MULT;
      
      send({
        type: "POUR_PROGRESS",
        step: ingredients[0]?.name || "step",
        stepIndex: 0,
        totalSteps: ingredients.length,
        pct: 0,
        status: "waiting-for-glass",
      });
      timer = setTimeout(startStep, 3000);
    })
    .catch(() => {
      // Calibration load failed — fall back to the legacy constant so a
      // mock pour still completes during dev.
      if (cancelled) return;
      totalSeconds = (POUR_SETUP_SECONDS + totalVolume * 4.0) / SPEED_MULT;
      
      send({
        type: "POUR_PROGRESS",
        step: ingredients[0]?.name || "step",
        stepIndex: 0,
        totalSteps: ingredients.length,
        pct: 0,
        status: "waiting-for-glass",
      });
      timer = setTimeout(startStep, 3000);
    });

  return function cancel() {
    if (cancelled) return;
    cancelled = true;
    clearTimer();
    send({ type: "POUR_CANCELLED", drinkId: drink.id });
  };
}
