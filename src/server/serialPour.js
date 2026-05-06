// Real-hardware pour driver. Mirrors mockPour's signature so index.js can
// swap implementations on a single env-var check.
//
// Per-ingredient flow: look up the slot in inventory, convert oz -> grams
// (flat 1.0 g/mL for now), send "POUR <slot> <grams> <max-sec>", await DONE.
// Multi-ingredient drinks pour sequentially; the firmware tares before
// each POUR so each call means "add this many grams from rest."
//
// max-sec is computed from the slot's calibrated flow rate × a slop factor
// so the firmware's runaway-pour cap scales with the requested grams. Slow
// pumps (e.g. 0.04 oz/s on a soda channel) used to trip the firmware's
// fixed 60s cap on perfectly normal pours; tying the cap to calibration
// fixes that and also means recalibrating a slot updates its timeout for
// free. The firmware clamps to its own 15-min hard ceiling regardless.

import {
  adjustedIngredients,
  getDrinkById,
  totalVolumeOz,
} from "../drinks.js";
import { consume, loadInventory } from "./inventory.js";
import { sendCommand, sendRaw } from "./serial.js";
import { record as recordPour } from "./pour-history.js";
import { loadCalibration, flowRateForSlot } from "./calibration.js";

const ML_PER_OZ = 29.5735;
// Flat density covers spirits/juices to within ~5%. Per-ingredient density
// is a follow-up once syrups need accurate dosing.
const DEFAULT_DENSITY_G_PER_ML = 1.0;

// Multiplier applied to the calibrated expected duration before sending
// the firmware its per-pour timeout. 2x absorbs normal pump variability,
// air-column settling, and minor calibration drift without ever firing on
// a healthy pour.
const POUR_TIMEOUT_SLOP = 2.0;
// Fixed buffer added on top of the multiplied estimate. Covers per-pour
// fixed costs (relay actuation, initial settling) that aren't proportional
// to volume — without it a tiny 0.25oz pour at 0.25 oz/s would get a
// 2-second budget, which is too tight when the scale needs ~150ms to settle.
const POUR_TIMEOUT_BUFFER_SEC = 5;

export function serialPour(order, send) {
  const drink = order.customDrink || getDrinkById(order.drinkId);
  if (!drink) {
    send({ type: "POUR_ERROR", code: "UNKNOWN_DRINK", drinkId: order.drinkId });
    return () => {};
  }

  // skipIngredients carries names the user is pouring by hand because the
  // machine isn't loaded for them (or the bottle is empty/low). Drop them
  // from the timed pour, the consume() call, and the recorded history so we
  // never command a slot we know can't deliver — and so the percentage math
  // below is based on what the machine actually dispenses. Mirrors mockPour.
  const skip = new Set(Array.isArray(order.skipIngredients) ? order.skipIngredients : []);
  const ingredients = adjustedIngredients(drink, order.strength, order.amount).filter(
    (i) => !skip.has(i.name)
  );
  const totalVolume = totalVolumeOz(ingredients);

  let cancelled = false;

  (async () => {
    const [inventory, calibration] = await Promise.all([
      loadInventory(),
      loadCalibration(),
    ]);
    let cumulativeVolume = 0;

    for (let stepIndex = 0; stepIndex < ingredients.length; stepIndex++) {
      if (cancelled) return;
      const ing = ingredients[stepIndex];
      const slotRow = inventory.slots.find((s) => s.ingredientId === ing.name);
      if (!slotRow) {
        // Latch cancelled so a stale cancel() from the per-connection slot
        // doesn't fire POUR_CANCELLED on the next POUR — that races with the
        // newly-mounted pouring screen, which then bounces back to detail.
        cancelled = true;
        send({
          type: "POUR_ERROR",
          code: "INGREDIENT_NOT_LOADED",
          ingredient: ing.name,
        });
        return;
      }

      send({
        type: "POUR_PROGRESS",
        step: ing.name,
        stepIndex,
        totalSteps: ingredients.length,
        pct: cumulativeVolume / totalVolume,
        status: "pouring",
      });

      const grams = ing.volumeOz * ML_PER_OZ * DEFAULT_DENSITY_G_PER_ML;
      const ozPerSec = flowRateForSlot(calibration, slotRow.slot);
      const expectedSec = ing.volumeOz / ozPerSec;
      const maxSec = Math.ceil(expectedSec * POUR_TIMEOUT_SLOP + POUR_TIMEOUT_BUFFER_SEC);
      const response = await sendCommand(
        `POUR ${slotRow.slot} ${grams.toFixed(2)} ${maxSec}`,
        {
          // Firmware streams "PROGRESS <grams>" lines every ~250ms during
          // the pour. Convert back to oz and project onto the whole-drink
          // total so the UI bar climbs continuously across all ingredients
          // instead of jumping per-step.
          onProgress: (body) => {
            if (cancelled) return;
            const parts = body.split(/\s+/);
            const gramsPoured = parseFloat(parts[1]);
            if (!isFinite(gramsPoured)) return;
            const ozPoured =
              gramsPoured / (ML_PER_OZ * DEFAULT_DENSITY_G_PER_ML);
            const pct = Math.min(
              (cumulativeVolume + ozPoured) / totalVolume,
              1
            );
            send({
              type: "POUR_PROGRESS",
              step: ing.name,
              stepIndex,
              totalSteps: ingredients.length,
              pct,
              status: "pouring",
            });
          },
        }
      );

      // STOP path: cancel() set `cancelled` and the firmware's "ERR aborted"
      // is what resolves this await. cancel() already emitted POUR_CANCELLED,
      // so just exit before touching anything else.
      if (cancelled) return;
      if (response.startsWith("ERR")) {
        cancelled = true;
        send({
          type: "POUR_ERROR",
          code: response,
          ingredient: ing.name,
        });
        return;
      }

      cumulativeVolume += ing.volumeOz;
    }

    if (cancelled) return;
    // Latch cancelled so a stale cancel() from the per-connection slot
    // doesn't fire POUR_CANCELLED for an already-finished drink.
    cancelled = true;

    send({
      type: "POUR_PROGRESS",
      step: ingredients[ingredients.length - 1].name,
      stepIndex: ingredients.length - 1,
      totalSteps: ingredients.length,
      pct: 1.0,
      status: "pouring",
    });

    consume(ingredients).catch(() => {});
    recordPour({
      drinkId: drink.id,
      drinkName: drink.name,
      ingredients,
    }).catch(() => {});
    send({ type: "POUR_COMPLETE", drinkId: drink.id });
  })().catch((err) => {
    console.error("serialPour error:", err);
    if (!cancelled) {
      cancelled = true;
      send({
        type: "POUR_ERROR",
        code: "SERIAL_ERROR",
        message: err.message,
      });
    }
  });

  return function cancel() {
    if (cancelled) return;
    cancelled = true;
    sendRaw("STOP");
    send({ type: "POUR_CANCELLED", drinkId: drink.id });
  };
}
