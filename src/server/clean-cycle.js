// The guided deep-clean cycle: drain → soap → soak → rinse → dry.
//
// Unlike prime/flush, this is one long server-owned job rather than a burst of
// per-slot requests from a tablet. Three reasons:
//
//   1. It has to survive a reload. A cycle runs ~15 minutes with manual steps
//      in between; an admin locking the screen or the browser reloading must
//      not orphan it. Clients read the live state off MACHINE_STATE and
//      re-attach wherever it got to.
//   2. It has to hold the machine for the WHOLE cycle, not per stage. The
//      lock is what stops the queue pouring, and between stages the lines
//      contain air, soap, or rinse water — never a drink.
//   3. Soap is a safety state. Once the soap stage runs, the cycle refuses to
//      let go of the machine until a rinse has cleared the lines (or an admin
//      explicitly overrides). That guard is the whole reason the lock is held
//      across the manual prompts instead of being taken per pump run.
//
// Phases within a stage:
//   prompt      → waiting for the admin to move the tubes, then tap Start
//   running     → pumping slot by slot (or counting down, for the soak)
//   stage-done  → stage finished; admin advances or repeats it
//   needs-rinse → cycle ended with soap still in the lines; machine stays held
//   done        → all stages complete; Finish releases the machine

import { acquire, updateJob } from "./machine-state.js";
import { loadInventory } from "./inventory.js";
import { runTimedPump } from "./maintenance.js";
import { sendRaw, isSerialReady } from "./serial.js";
import { loadCleaning, setLinesState, markCleaned } from "./cleaning-store.js";
import { CLEAN_STAGES, stageById, stageIndex, stageSeconds } from "../clean-stages.js";

let cycle = null;
// Resolver for the soak countdown, so abort() doesn't have to wait it out.
let wakeSoak = null;

function snapshot() {
  if (!cycle) return null;
  const slot = cycle.slots[cycle.slotIndex];
  return {
    stage: cycle.stageId,
    phase: cycle.phase,
    slotIndex: cycle.slotIndex,
    slotCount: cycle.slots.length,
    currentSlot: slot?.slot ?? null,
    currentIngredient: slot?.ingredientId ?? null,
    stageStartedAt: cycle.stageStartedAt,
    stageEndsAt: cycle.stageEndsAt,
    linesState: cycle.linesState,
    error: cycle.error,
  };
}

// Every state change goes out on MACHINE_STATE — the channel every client is
// already subscribed to, so no new socket plumbing.
function publish() {
  updateJob({ clean: snapshot() });
}

export function getCleanState() {
  return snapshot();
}

function setPhase(phase, patch = {}) {
  if (!cycle) return;
  Object.assign(cycle, patch, { phase });
  publish();
}

// --- Lifecycle ---

export async function start() {
  if (cycle) throw new Error("clean cycle already running");
  const inv = await loadInventory();
  const slots = inv.slots.filter((s) => s.ingredientId);
  if (slots.length === 0) throw new Error("no bottles loaded");

  const release = acquire({ kind: "maintenance", mode: "clean-cycle" });
  if (!release) throw new Error("machine busy");

  const persisted = await loadCleaning();
  cycle = {
    release,
    slots,
    stageId: CLEAN_STAGES[0].id,
    phase: "prompt",
    slotIndex: 0,
    stageStartedAt: null,
    stageEndsAt: null,
    linesState: persisted.linesState,
    cancelled: false,
    error: null,
  };
  publish();
  return snapshot();
}

// Re-take the machine on boot if the last run left soap in the lines. Without
// this a crash mid-cycle would come back up looking ready to serve drinks out
// of soapy tubing.
export async function resumeIfUnsafe() {
  const persisted = await loadCleaning();
  if (persisted.linesState !== "soap" || cycle) return;
  const release = acquire({ kind: "maintenance", mode: "clean-cycle" });
  if (!release) return;
  const inv = await loadInventory();
  cycle = {
    release,
    slots: inv.slots.filter((s) => s.ingredientId),
    stageId: "rinse",
    phase: "needs-rinse",
    slotIndex: 0,
    stageStartedAt: null,
    stageEndsAt: null,
    linesState: "soap",
    cancelled: false,
    error: null,
  };
  console.warn("[clean] resumed holding the machine — lines still contain soap");
  publish();
}

// Advance: prompt → run the stage, stage-done → set up the next stage.
export async function next() {
  if (!cycle) throw new Error("no clean cycle running");
  if (cycle.phase === "running") throw new Error("stage already running");

  if (cycle.phase === "prompt" || cycle.phase === "needs-rinse") {
    return runStage();
  }
  if (cycle.phase === "done") return finish();

  const idx = stageIndex(cycle.stageId);
  const nextStage = CLEAN_STAGES[idx + 1];
  if (!nextStage) {
    await markCleaned();
    setPhase("done");
    return snapshot();
  }
  setPhase("prompt", { stageId: nextStage.id, slotIndex: 0, stageEndsAt: null });
  return snapshot();
}

export async function repeat() {
  if (!cycle) throw new Error("no clean cycle running");
  if (cycle.phase === "running") throw new Error("stage already running");
  return runStage();
}

// Kicks the stage off and returns immediately. A stage runs for minutes —
// far too long to hold an HTTP request open — so the caller gets the
// "running" snapshot and follows the rest over MACHINE_STATE.
function runStage() {
  const stage = stageById(cycle.stageId);
  const durationSec = stageSeconds(stage, cycle.slots.length);
  cycle.cancelled = false;
  cycle.error = null;
  setPhase("running", {
    slotIndex: 0,
    stageStartedAt: Date.now(),
    stageEndsAt: Date.now() + durationSec * 1000,
  });
  driveStage(stage).catch((e) => {
    console.error("[clean] stage failed:", e);
    if (!cycle) return;
    cycle.error = e.message;
    cycle.cancelled = true;
    resolveAbort();
  });
  return snapshot();
}

async function driveStage(stage) {
  if (stage.soakSeconds) {
    await soak(stage.soakSeconds * 1000);
  } else {
    await pumpEverySlot(stage);
  }

  // finish() can land while a stage is in flight (an abort resolving on
  // another request), which drops the cycle out from under us.
  if (!cycle) return;
  if (cycle.cancelled) {
    resolveAbort();
    return;
  }

  // Only claim the new line contents if the stage actually completed — an
  // aborted soap stage still leaves soap behind, which resolveAbort handles.
  cycle.linesState = stage.linesAfter;
  await setLinesState(stage.linesAfter);
  if (!cycle) return;
  setPhase("stage-done", { stageEndsAt: null });
}

async function pumpEverySlot(stage) {
  for (let i = 0; i < cycle.slots.length; i++) {
    if (!cycle || cycle.cancelled) return;
    setPhase("running", { slotIndex: i });
    try {
      // No inventory decrement: from the drain stage onward the pumps are
      // moving air, soap, and water — not the bottle's contents.
      await runTimedPump(cycle.slots[i].slot, stage.secPerSlot * 1000, {
        decrementInventory: false,
      });
    } catch (e) {
      // A STOP mid-run surfaces here as "ERR aborted"; that's the abort path,
      // not a failure. Anything else stops the stage so the admin can look at
      // the machine rather than have it grind through fifteen more slots.
      if (!cycle || cycle.cancelled) return;
      cycle.error = `slot ${cycle.slots[i].slot}: ${e.message}`;
      cycle.cancelled = true;
      return;
    }
  }
}

function soak(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeSoak = null;
      resolve();
    }, ms);
    wakeSoak = () => {
      clearTimeout(timer);
      wakeSoak = null;
      resolve();
    };
  });
}

// End the soak early — the lines are already full of soap, so a short soak is
// a judgement call, not a safety problem.
export function skipSoak() {
  if (!cycle || cycle.stageId !== "soak" || cycle.phase !== "running") {
    throw new Error("not soaking");
  }
  if (wakeSoak) wakeSoak();
  return snapshot();
}

export function abort() {
  if (!cycle) throw new Error("no clean cycle running");
  cycle.cancelled = true;
  if (cycle.phase === "running") {
    if (wakeSoak) wakeSoak();
    // Out-of-band STOP; the in-flight RUN comes back "ERR aborted" and unwinds
    // pumpEverySlot. In mock mode there's no firmware to interrupt, so the
    // current slot's sleep plays out before the loop notices — one slot's
    // delay on a dev laptop, no delay on the machine.
    if (isSerialReady()) sendRaw("STOP");
    return snapshot();
  }
  return resolveAbort();
}

// Let go of the machine — unless the lines still hold soap, in which case we
// keep holding it and park in needs-rinse.
function resolveAbort() {
  if (cycle.linesState === "soap") {
    setPhase("needs-rinse", { stageId: "rinse", slotIndex: 0, stageEndsAt: null });
    return snapshot();
  }
  return finish();
}

export function finish() {
  if (!cycle) return null;
  const release = cycle.release;
  cycle = null;
  release();
  return null;
}

// Escape hatch for needs-rinse: the admin says the lines are clear (they
// rinsed by hand, or pulled the tubing). Trust them and release the machine.
export async function override() {
  if (!cycle) throw new Error("no clean cycle running");
  cycle.linesState = "air";
  await setLinesState("air");
  return finish();
}
