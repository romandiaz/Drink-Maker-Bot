// Machine routines that drive the pumps or load cell: prime/flush, the
// two-step pump calibration, and load-cell tare/calibrate. Each routine that
// physically actuates the machine takes the machine-state lock for its
// duration (returning 409 if something else holds it); calibrate-save is a
// pure persist and doesn't.
import { readJsonBody, sendJson, jsonRoute } from "../http-util.js";
import {
  runTimedPump,
  runCalibrationMeasure,
  saveCalibrationResult,
  tareScale,
  calibrateScale,
} from "../maintenance.js";
import { acquire as acquireMachine } from "../machine-state.js";
import { runLedSelfTest } from "../leds.js";

// Acquire the machine for `job`, run `fn`, and always release. Sends 409 if the
// machine is busy, 200 with fn's result on success, 400 on failure. Validate
// inputs before calling this so an invalid request never grabs the lock.
async function withMachineLock(res, job, fn) {
  const release = acquireMachine(job);
  if (!release) {
    sendJson(res, 409, { error: "machine busy" });
    return;
  }
  try {
    sendJson(res, 200, await fn());
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  } finally {
    release();
  }
}

export async function maintenanceRoutes(req, res, urlPath) {
  if (urlPath === "/api/maintenance/run" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const slot = Number(body.slot);
      const durationSec = Number(body.durationSec);
      const mode = body.mode === "clean" ? "clean" : "prime";
      if (!Number.isInteger(slot) || slot < 1) throw new Error("invalid slot");
      if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 60) {
        throw new Error("invalid duration");
      }
      await withMachineLock(res, { kind: "maintenance", mode, slot }, async () => {
        await runTimedPump(slot, durationSec * 1000);
        return { ok: true, mode, slot, durationSec };
      });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/maintenance/calibrate-measure" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const slot = Number(body.slot);
      const durationSec = Number(body.durationSec);
      if (!Number.isInteger(slot) || slot < 1) throw new Error("invalid slot");
      await withMachineLock(
        res,
        { kind: "maintenance", mode: "calibrate", slot },
        async () => {
          const result = await runCalibrationMeasure(slot, durationSec);
          return { ok: true, slot, ...result };
        }
      );
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/maintenance/calibrate-save" && req.method === "POST") {
    await jsonRoute(res, async () => {
      const body = await readJsonBody(req);
      return saveCalibrationResult(Number(body.slot), Number(body.ozPerSec));
    });
    return true;
  }

  if (urlPath === "/api/maintenance/scale-tare" && req.method === "POST") {
    await withMachineLock(res, { kind: "maintenance", mode: "tare" }, async () => {
      await tareScale();
      return { ok: true };
    });
    return true;
  }

  if (urlPath === "/api/maintenance/scale-calibrate" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const knownGrams = Number(body.knownGrams);
      await withMachineLock(
        res,
        { kind: "maintenance", mode: "scale-calibrate" },
        async () => {
          const result = await calibrateScale(knownGrams);
          return { ok: true, ...result };
        }
      );
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (urlPath === "/api/maintenance/led-test" && req.method === "POST") {
    // Takes the machine lock like the pump routines: the ~7s sequence drives
    // the strip through the pour modes, and holding the lock keeps a pour from
    // starting mid-test and fighting it for the LEDs.
    await withMachineLock(res, { kind: "maintenance", mode: "led-test" }, () =>
      runLedSelfTest()
    );
    return true;
  }

  return false;
}
