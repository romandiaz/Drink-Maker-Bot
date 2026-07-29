// The deep-clean cycle's stage spec, shared by the server state machine
// (server/clean-cycle.js) and the modal that drives it
// (components/clean-cycle-modal.js). Both need the same durations to agree on
// the time estimates they show, so the numbers live here rather than being
// duplicated on each side.
//
// The cycle assumes the "one jug" workflow: intake tubes come out of the
// bottles and go into a shared container, so every stage is a physical prompt
// ("move the tubes here") followed by a pump run across every loaded slot in
// turn. Pumps run one at a time — the firmware's RUN primitive takes a single
// slot, and the supply can't drive sixteen at once anyway.
//
// `linesAfter` is what the tubing contains once the stage finishes. It's the
// safety-relevant field: 'soap' means the machine must not pour, which is why
// the cycle keeps holding the machine lock until a rinse clears it.

export const SOAK_SECONDS = 300;

export const CLEAN_STAGES = [
  {
    id: "drain",
    label: "Drain",
    secPerSlot: 8,
    linesAfter: "air",
    instruction:
      "Lift every intake tube out of its bottle and let them hang in the air. Put a waste container under the nozzles.",
    detail:
      "Pushes the spirit left in each line out into the waste container, so it doesn't dilute the soapy water.",
  },
  {
    id: "soap",
    label: "Soap",
    secPerSlot: 12,
    linesAfter: "soap",
    instruction:
      "Put every intake tube into a jug of warm soapy water. Keep the waste container under the nozzles.",
    detail: "Fills each line with soap solution, ready to soak.",
  },
  {
    id: "soak",
    label: "Soak",
    secPerSlot: 0,
    soakSeconds: SOAK_SECONDS,
    linesAfter: "soap",
    instruction:
      "Leave everything as it is. The soap sits in the lines — this is the part that actually cleans them.",
    detail:
      "No pumping. Contact time is what breaks down the sugar and oil film inside the tubing.",
  },
  {
    id: "rinse",
    label: "Rinse",
    secPerSlot: 25,
    linesAfter: "water",
    instruction:
      "Move every intake tube to a jug of clean water. Empty the waste container first — this stage moves a lot of liquid.",
    detail:
      "Runs roughly twice as long as the soap stage so no residue is left behind. Repeat it if the runoff still foams.",
  },
  {
    id: "dry",
    label: "Dry",
    secPerSlot: 10,
    linesAfter: "air",
    instruction:
      "Lift every intake tube out of the water and let them hang in the air. Leave the waste container in place.",
    detail:
      "Clears the standing water out so the lines aren't left wet between sessions.",
  },
];

export function stageById(id) {
  return CLEAN_STAGES.find((s) => s.id === id) || null;
}

export function stageIndex(id) {
  return CLEAN_STAGES.findIndex((s) => s.id === id);
}

// Seconds of pumping for one stage across `slotCount` slots.
export function stageSeconds(stage, slotCount) {
  if (!stage) return 0;
  if (stage.soakSeconds) return stage.soakSeconds;
  return stage.secPerSlot * slotCount;
}

// Whole-cycle estimate, used on the button and the intro screen so an admin
// knows they're starting a ~15-minute job before they commit to it.
export function totalSeconds(slotCount) {
  return CLEAN_STAGES.reduce((sum, s) => sum + stageSeconds(s, slotCount), 0);
}

export function formatDuration(sec) {
  const total = Math.max(0, Math.round(sec));
  const min = Math.floor(total / 60);
  const rem = total % 60;
  if (min === 0) return `${rem}s`;
  if (rem === 0) return `${min} min`;
  return `${min} min ${rem}s`;
}
