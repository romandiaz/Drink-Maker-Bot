import {
  adjustedIngredients,
  getDrinkById,
  totalVolumeOz,
} from "../drinks.js";
import { consume } from "./inventory.js";
import { record as recordPour } from "./pour-history.js";

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
  // Inlined to match the filtered list (estimatePourSeconds would re-include
  // skipped volume via the full recipe).
  const totalSeconds = (15 + totalVolume * 4.0) / SPEED_MULT;

  let cancelled = false;
  let timer = null;
  let stepIndex = 0;
  let cumulativeVolume = 0;

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

  startStep();

  return function cancel() {
    if (cancelled) return;
    cancelled = true;
    clearTimer();
    send({ type: "POUR_CANCELLED", drinkId: drink.id });
  };
}
