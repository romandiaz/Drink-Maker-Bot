// Presentation half of the deep-clean modal: the stage rail and the live
// progress readout. Pure rendering — given a cycle snapshot it appends DOM and
// returns. No server calls, no actions, no state of its own, which is what
// keeps clean-cycle-modal.js down to the phase→UI mapping and the action
// buttons.

import { ingredientName } from "../ingredients.js";
import { CLEAN_STAGES, formatDuration } from "../clean-stages.js";

export function renderStageRail(rail, activeIdx) {
  rail.innerHTML = "";
  for (const [i, stage] of CLEAN_STAGES.entries()) {
    const pill = document.createElement("div");
    pill.className = "clean-rail__step";
    if (i < activeIdx) pill.classList.add("is-done");
    if (i === activeIdx) pill.classList.add("is-active");
    pill.textContent = stage.label;
    rail.appendChild(pill);
  }
}

// Fraction of the stage elapsed, interpolated from the two timestamps the
// server publishes. The server only emits on slot boundaries — for a 25s-per-
// slot rinse that's far too coarse for a bar that should look alive — so the
// modal re-renders on a timer and this recomputes from the clock.
function progressPct(clean) {
  if (!clean?.stageStartedAt || !clean?.stageEndsAt) return 0;
  const span = clean.stageEndsAt - clean.stageStartedAt;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (Date.now() - clean.stageStartedAt) / span));
}

export function renderStageProgress(body, clean, stage) {
  const line = document.createElement("div");
  line.className = "clean-now";
  if (stage.soakSeconds) {
    line.textContent = "Soaking";
  } else {
    const name = clean.currentIngredient
      ? ingredientName(clean.currentIngredient)
      : "—";
    line.textContent = `Slot ${String(clean.currentSlot ?? 0).padStart(2, "0")} · ${name}`;
  }
  body.appendChild(line);

  const bar = document.createElement("div");
  bar.className = "clean-bar";
  const fill = document.createElement("div");
  fill.className = "clean-bar__fill";
  fill.style.width = `${(progressPct(clean) * 100).toFixed(1)}%`;
  bar.appendChild(fill);
  body.appendChild(bar);

  const meta = document.createElement("div");
  meta.className = "clean-meta";
  const remaining = formatDuration((clean.stageEndsAt - Date.now()) / 1000);
  const of = stage.soakSeconds
    ? ""
    : ` · slot ${clean.slotIndex + 1} of ${clean.slotCount}`;
  meta.textContent = `${remaining} left${of}`;
  body.appendChild(meta);
}
