// Driver UI for the guided deep-clean cycle. Every bit of state it renders
// comes off MACHINE_STATE (`job.clean`), never from local variables — the
// cycle lives on the server, so this modal is a view that can be closed and
// reopened, or opened fresh on a second tablet, without losing the thread.
//
// Closing it does NOT stop the cycle. The maintenance card shows a Resume
// button whenever a cycle is running.

import { postJSON } from "../api.js";
import { showToast } from "./toast.js";
import { actionBtn } from "./maint-ui.js";
import { onMachineStatus } from "../machine-status.js";
import { renderStageRail, renderStageProgress } from "./clean-progress.js";
import {
  CLEAN_STAGES,
  stageById,
  stageIndex,
  totalSeconds,
  formatDuration,
} from "../clean-stages.js";

export function openCleanCycle({ host, slotCount, onClose }) {
  const overlay = document.createElement("div");
  overlay.className = "admin-picker";

  const panel = document.createElement("div");
  panel.className = "clean-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  overlay.appendChild(panel);

  const title = document.createElement("div");
  title.className = "admin-picker__title";
  title.textContent = "Deep clean";
  panel.appendChild(title);

  const rail = document.createElement("div");
  rail.className = "clean-rail";
  const body = document.createElement("div");
  body.className = "clean-body";
  const actions = document.createElement("div");
  actions.className = "clean-actions";
  panel.append(rail, body, actions);

  let clean = null;
  let tick = null;
  let unsub = null;
  // Distinguishes "not started yet" from "just finished" — both are a null
  // snapshot, but one wants an intro and the other a sign-off.
  let hasStarted = false;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  function close() {
    if (tick) clearInterval(tick);
    tick = null;
    unsub?.();
    overlay.remove();
    onClose?.();
  }

  async function send(action) {
    try {
      await postJSON("/api/maintenance/clean", { action });
    } catch (e) {
      console.error(e);
      showToast(`Clean cycle — ${e.message}`);
    }
  }

  function copyLine(text, className) {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    body.appendChild(p);
    return p;
  }

  function renderIntro() {
    copyLine(
      `A full clean runs ${CLEAN_STAGES.length} stages across ${slotCount} loaded slot${slotCount === 1 ? "" : "s"} and takes about ${formatDuration(totalSeconds(slotCount))}, including a ${formatDuration(CLEAN_STAGES.find((s) => s.soakSeconds).soakSeconds)} soak.`,
      "clean-instruction"
    );
    copyLine(
      "You'll need a jug of warm soapy water, a jug of clean water, and a container to catch the runoff. The machine won't pour anything until the cycle finishes.",
      "clean-detail"
    );
    const cancel = actionBtn("Cancel");
    cancel.dataset.alwaysEnabled = "1";
    cancel.addEventListener("click", close);
    actions.appendChild(cancel);
    addPrimary("Start clean", "start");
  }

  function render() {
    body.innerHTML = "";
    actions.innerHTML = "";
    renderStageRail(rail, clean ? stageIndex(clean.stage) : -1);

    if (!clean) {
      if (hasStarted) {
        copyLine("The cleaning cycle has finished.", "clean-instruction");
        const done = actionBtn("Close", { tone: "primary" });
        done.dataset.alwaysEnabled = "1";
        done.addEventListener("click", close);
        actions.appendChild(done);
        return;
      }
      renderIntro();
      return;
    }

    const stage = stageById(clean.stage);
    const idx = stageIndex(clean.stage);
    const isLast = idx === CLEAN_STAGES.length - 1;

    if (clean.error) {
      copyLine(clean.error, "clean-error");
    }

    if (clean.phase === "needs-rinse") {
      copyLine(
        "The cycle stopped with soap still in the lines. The machine stays locked until they're rinsed.",
        "clean-error"
      );
      copyLine(stage.instruction, "clean-instruction");
      addStop("Lines are clear", "override");
      addPrimary("Run rinse", "next");
      return;
    }

    if (clean.phase === "done") {
      copyLine("Clean cycle complete. The lines are empty and dry.", "clean-instruction");
      addPrimary("Finish", "next");
      return;
    }

    if (clean.phase === "running") {
      copyLine(stage.instruction, "clean-instruction is-muted");
      renderStageProgress(body, clean, stage);
      addStop("Stop", "abort");
      if (stage.soakSeconds) {
        const skip = actionBtn("Skip soak");
        skip.dataset.alwaysEnabled = "1";
        skip.addEventListener("click", () => send("skip-soak"));
        actions.appendChild(skip);
      }
      return;
    }

    if (clean.phase === "stage-done") {
      copyLine(`${stage.label} finished.`, "clean-instruction");
      copyLine(stage.detail, "clean-detail");
      addStop("Stop", "abort");
      const again = actionBtn("Repeat");
      again.dataset.alwaysEnabled = "1";
      again.addEventListener("click", () => send("repeat"));
      actions.appendChild(again);
      const nextStage = CLEAN_STAGES[idx + 1];
      addPrimary(isLast ? "Done" : `Next · ${nextStage.label}`, "next");
      return;
    }

    // prompt
    copyLine(stage.instruction, "clean-instruction");
    copyLine(stage.detail, "clean-detail");
    addStop("Stop", "abort");
    addPrimary(`Start ${stage.label.toLowerCase()}`, "next");
  }

  function addPrimary(label, action) {
    const btn = actionBtn(label, { tone: "primary" });
    btn.dataset.alwaysEnabled = "1";
    btn.addEventListener("click", () => send(action));
    actions.appendChild(btn);
  }

  function addStop(label, action) {
    const btn = actionBtn(label, { tone: "warn" });
    btn.dataset.alwaysEnabled = "1";
    btn.addEventListener("click", () => send(action));
    actions.appendChild(btn);
  }

  // Repaint the bar and countdown between server messages — the server only
  // publishes on slot boundaries, which for a 25s rinse step is far too coarse
  // for a progress bar to look alive.
  tick = setInterval(() => {
    if (clean?.phase === "running") render();
  }, 500);

  unsub = onMachineStatus((s) => {
    clean = s.job?.clean ?? null;
    if (clean) hasStarted = true;
    render();
  });

  host.appendChild(overlay);
  // Unlike the other maintenance modals this one holds a timer and a
  // machine-status subscription, so a bare element.remove() would leak both.
  // The view calls closeModal() instead when the screen unmounts.
  overlay.closeModal = close;
  return overlay;
}
