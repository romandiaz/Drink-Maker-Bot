// Turns the weight stream the firmware sends during a pour into a flow-rate
// observation, so ordinary drinks keep each slot's calibration current instead
// of it only changing when someone remembers to run the manual wizard.
//
// Why the PROGRESS window rather than the whole command: a POUR does real work
// before and after the pump runs. It averages 10 HX711 samples for its pour-start
// baseline (~1s at the cell's ~10Hz), waits 50ms, then after the pump stops
// waits 150ms and averages 5 more for the settling read (~0.5s). That's roughly
// 1.7s of fixed overhead on every pour regardless of size. Dividing volume by
// the total command duration would therefore report every pump as far slower
// than it is, and the error is worst on small pours — a 0.25oz dash from a
// genuinely 0.25 oz/s pump would measure as ~0.09 oz/s and drag that slot's
// calibration down every time someone ordered an Old Fashioned.
//
// Measuring between the first and last streamed PROGRESS sample excludes both
// ends, leaving only time the pump was actually moving liquid.

// PROGRESS arrives about every 250ms. Three samples is two intervals — enough
// to average out one late serial line.
const MIN_SAMPLES = 3;
// Guards the fast end: below about a second, serial jitter on the first and
// last line is a large fraction of the measured span.
const MIN_SPAN_MS = 1000;
// Guards the slow end: the load cell is good to a few tenths of a gram, so a
// window that only moved a gram or two is mostly noise. ~5g keeps the
// measurement error under a few percent even on a trickling soda pump.
const MIN_SPAN_G = 5;

const ML_PER_OZ = 29.5735;
const DEFAULT_DENSITY_G_PER_ML = 1.0;

// Collects the weight samples streamed during one ingredient's pour and
// reports the flow rate they imply. One instance per pour step.
export function createFlowSample() {
  const points = [];

  return {
    // `grams` is the cumulative poured weight from one "PROGRESS <grams>" line.
    add(grams) {
      const g = Number(grams);
      if (!Number.isFinite(g)) return;
      points.push({ t: Date.now(), g });
    },

    // Measured oz/sec across the streamed window, or null when the window is
    // too short, too light, or too sparse to be worth learning from. Null is
    // the normal outcome for a dash of bitters — small pours simply don't
    // teach us anything, and saying so is better than guessing.
    ozPerSec() {
      if (points.length < MIN_SAMPLES) return null;
      const first = points[0];
      const last = points[points.length - 1];
      const spanMs = last.t - first.t;
      const spanG = last.g - first.g;
      if (spanMs < MIN_SPAN_MS) return null;
      if (spanG < MIN_SPAN_G) return null;
      const ozPoured = spanG / (ML_PER_OZ * DEFAULT_DENSITY_G_PER_ML);
      return ozPoured / (spanMs / 1000);
    },

    // Most recent cumulative weight seen, in oz, or null if nothing streamed.
    // This is the only measurement available when a pour is interrupted rather
    // than finished: a STOP makes the firmware abort without reporting grams,
    // so the last PROGRESS line — at most ~250ms stale — is what tells us how
    // much actually reached the glass.
    lastOz() {
      if (points.length === 0) return null;
      const g = points[points.length - 1].g;
      return g / (ML_PER_OZ * DEFAULT_DENSITY_G_PER_ML);
    },
  };
}
