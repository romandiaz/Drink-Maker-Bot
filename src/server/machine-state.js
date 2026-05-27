// Single source of truth for "what is the hardware doing right now."
//
// Every operation that drives the pumps — pours and all maintenance routines —
// goes through acquire() so two clients can't fight over the serial line.
// The current state is broadcast to every connected WebSocket whenever it
// changes, and on connection, so a freshly-loaded tablet syncs immediately.
//
// Shape:
//   { status: 'idle' | 'pouring' | 'maintenance',
//     job:    null | { kind, drinkId?, slot?, mode?, startedAt, progress? },
//     lastOutcome: null | { type: "POUR_COMPLETE" | "POUR_ERROR" | "POUR_CANCELLED", ... },
//     glassPresent: bool — maintained by glass-watch.js, broadcast here so
//                          every connected client sees the same value }

let state = { status: "idle", job: null, lastOutcome: null, glassPresent: false };
let nextJobId = 1;
const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const l of listeners) {
    try {
      l(state);
    } catch (e) {
      console.error("machine-state listener error:", e);
    }
  }
}

// Try to take the lock. Returns a release fn on success, or null if busy.
// Caller MUST call release() in a finally — otherwise the machine looks
// permanently busy to every other client.
export function acquire(job) {
  if (state.status !== "idle") return null;
  const jobId = nextJobId++;
  const ownedJob = { ...job, startedAt: Date.now(), id: jobId };
  state = {
    status: job.kind === "pour" ? "pouring" : "maintenance",
    job: ownedJob,
    lastOutcome: null,
    glassPresent: state.glassPresent,
  };
  emit();
  return function release(outcome = null) {
    // Guard against double-release: only clear if we still own the slot,
    // so a late release after a new acquire doesn't wipe someone else's job.
    if (!state.job || state.job.id !== jobId) return;
    state = { status: "idle", job: null, lastOutcome: outcome, glassPresent: state.glassPresent };
    emit();
  };
}

// Merge a patch into the active job (e.g. progress updates) and broadcast.
// No-op if there's no active job — a late progress event after release()
// shouldn't resurrect the busy state.
export function updateJob(patch) {
  if (!state.job) return;
  state = { ...state, job: { ...state.job, ...patch } };
  emit();
}

// Called by glass-watch.js whenever its state machine transitions. No-op
// when the value hasn't changed, so the WS broadcast only fires on real
// edges — clients don't get spammed with redundant updates.
export function setGlassPresent(present) {
  if (state.glassPresent === present) return;
  state = { ...state, glassPresent: present };
  emit();
}

// Convenience for the WS layer — same payload shape as the broadcast.
export function stateMessage() {
  return { type: "MACHINE_STATE", state };
}
