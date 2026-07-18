// Shared machine-status / queue pill. The kiosk header's readyIndicator and
// the mobile order page both render this — they're the same pill, just wired
// to different tap actions (kiosk navigates to the queue screen; mobile
// expands the bottom tray). Keeping one source of truth means the glass icon,
// pie-progress wedge, "Pouring · 1" label, parked/maintenance accents, and
// pulse animation stay consistent everywhere they appear.

import { GLASS_TOPDOWN_SVG } from "../icons.js";
import { getMachineStatus, onMachineStatus } from "../machine-status.js";
import { getQueue, onQueueChange } from "../queue-store.js";

const registry = new Set();

// Pie wedge growing clockwise from 12 o'clock inside the glass icon.
// r=4.5 leaves a thin gap against the r=5.5 outer ring. Reaching p≥1 is
// rendered as a full circle (two half-arcs), since a single arc with
// identical start/end points draws nothing.
function piePath(progress) {
  const cx = 7;
  const cy = 7;
  const r = 4.5;
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0) return "";
  if (p >= 0.9999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
  }
  const angle = p * 2 * Math.PI;
  const x = cx + r * Math.sin(angle);
  const y = cy - r * Math.cos(angle);
  const largeArc = p > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y} Z`;
}

function applyPill(el) {
  const s = getMachineStatus();
  const q = getQueue();
  const n = q.entries.length;
  const parked = q.awaitingContinue && n > 0;
  const pouring = s.status === "pouring";
  // Surface a faulted load cell only while the machine is otherwise idle —
  // during a pour/maintenance the active visual takes precedence, and a pour
  // with a dead scale surfaces its own error. Optional-chained so the brief
  // pre-first-message default state (no hardware field) reads as no fault.
  const showFault = s.hardware?.scale === "fault" && s.status === "idle";
  el.classList.toggle("ready-indicator--busy", s.status !== "idle");
  el.classList.toggle("ready-indicator--pouring", pouring);
  el.classList.toggle("ready-indicator--parked", parked);
  el.classList.toggle("ready-indicator--fault", showFault);
  // Glass-presence is the inner dot of the same icon — fills when glass-watch
  // has detected a glass on the platform.
  el.classList.toggle("ready-indicator--glass", !!s.glassPresent);
  // Pour progress lives on machine-state.job.progress and is rebroadcast on
  // every tick, so this indicator pies up in lockstep on every connected
  // tablet/phone.
  const pie = el.querySelector(".glass-icon__pie");
  if (pie) {
    const progress = pouring ? Number(s.job?.progress) || 0 : 0;
    pie.setAttribute("d", piePath(progress));
  }
  const label = el.querySelector(".ready-label");
  if (label) {
    let word = "Ready";
    if (pouring) word = "Pouring";
    else if (s.status === "maintenance") word = "Maintenance";
    else if (showFault) word = "Scale offline";
    else if (parked) word = "Paused";
    // The fault label stands alone — appending a queue count ("Scale offline ·
    // 2") reads as nonsense; every other state keeps the count suffix.
    label.textContent = showFault ? word : n > 0 ? `${word} · ${n}` : word;
  }
}

function refresh() {
  for (const el of registry) {
    if (!el.isConnected) {
      registry.delete(el);
      continue;
    }
    applyPill(el);
  }
}
onMachineStatus(refresh);
onQueueChange(refresh);

// Build a status pill. `onTap` is the click handler — kiosk passes
// navigate("queue"), mobile passes an expand-the-tray callback. The pill
// self-updates on every machine-status / queue change for as long as it's in
// the DOM; orphans are dropped on the next refresh.
export function createStatusPill({ onTap, ariaLabel = "Machine status" } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ready-indicator tappable";
  btn.setAttribute("aria-label", ariaLabel);
  btn.innerHTML = `${GLASS_TOPDOWN_SVG}<span class="ready-label">Ready</span>`;
  if (onTap) {
    btn.addEventListener("click", (e) => {
      // Idle's tap-anywhere → category handler would otherwise also fire on
      // the kiosk — stop propagation so the pill's own action wins.
      e.stopPropagation();
      onTap(e);
    });
  }
  applyPill(btn);
  registry.add(btn);
  return btn;
}
