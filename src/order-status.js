// Top sticky header for the mobile order page. Renders brand + the shared
// status pill (same component the kiosk uses — see components/status-pill.js)
// and, during a pour, a step indicator + horizontal progress bar showing the
// active ingredient and overall pct. Queue summaries live in the bottom tray.

import { getDrinkById } from "./drinks.js";
import { formatIngredient } from "./format.js";
import { createStatusPill } from "./components/status-pill.js";

export function renderStatusBar({ machine, pour, waitingForGlass = false, onPillTap }) {
  const wrap = document.createElement("header");
  wrap.className = "order-status";

  const top = document.createElement("div");
  top.className = "order-status__top";

  const title = document.createElement("p");
  title.className = "order-status__title";
  title.textContent = "DrinkBot";
  top.appendChild(title);

  // Same pill as the kiosk header — glass icon with the pie wedge that fills
  // as the pour progresses, "Pouring · N" / "Ready" / "Paused" label, and the
  // parked/maintenance accents. Tapping it expands the bottom tray, mirroring
  // the kiosk's "tap pill → queue" affordance.
  top.appendChild(createStatusPill({
    onTap: onPillTap,
    ariaLabel: "Machine status — open the queue",
  }));

  wrap.appendChild(top);

  // Pour progress detail — step name + pct + horizontal bar. The pill above
  // already shows progress via its pie, but the bar reads at a glance on a
  // phone and the step name tells the guest which ingredient is pouring.
  // Visible only while the machine is actually pouring.
  if (machine.status === "pouring") {
    const progress = document.createElement("div");
    progress.className = "order-status__progress";

    const stepRow = document.createElement("div");
    stepRow.className = "order-status__step-row";
    const stepText = document.createElement("span");
    stepText.className = "order-status__step";
    if (waitingForGlass) {
      stepText.textContent = "Waiting for a glass on the tray";
    } else if (pour?.step) {
      const stepName = formatIngredient(pour.step);
      const stepCount =
        pour.totalSteps > 1 && Number.isInteger(pour.stepIndex)
          ? ` · step ${pour.stepIndex + 1} of ${pour.totalSteps}`
          : "";
      stepText.textContent = `${stepName}${stepCount}`;
    } else {
      stepText.textContent = "Starting…";
    }
    stepRow.appendChild(stepText);

    if (pour?.pct != null && !waitingForGlass) {
      const pctEl = document.createElement("span");
      pctEl.className = "order-status__pct";
      pctEl.textContent = `${Math.round(pour.pct * 100)}%`;
      stepRow.appendChild(pctEl);
    }
    progress.appendChild(stepRow);

    const bar = document.createElement("div");
    bar.className = "order-status__bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("div");
    fill.className = "order-status__bar-fill";
    const pct = waitingForGlass ? 0 : Math.max(0, Math.min(1, pour?.pct ?? 0));
    fill.style.transform = `scaleX(${pct})`;
    bar.setAttribute("aria-valuenow", String(Math.round(pct * 100)));
    if (waitingForGlass) bar.classList.add("is-indeterminate");
    bar.appendChild(fill);
    progress.appendChild(bar);

    wrap.appendChild(progress);
  }

  return wrap;
}
