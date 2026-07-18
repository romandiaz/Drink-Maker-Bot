// Bartender Kiosk firmware — Arduino Nano.
//
// Drives a 16-channel relay board (one peristaltic pump per channel) and
// reads an HX711 load-cell amplifier to close the pour loop on weight.
//
// Serial protocol (115200 baud, '\n'-terminated). Every command may end
// with a sequence ID token "#<n>" which the firmware echoes back at the
// end of its response, letting the host pair commands to replies by ID
// rather than by FIFO position. The ID is optional so the manual
// serial-bridge console still works without one.
//
//   <- READY                            (boot, no ID)
//   <- STATUS scale=<ok|fault>          (boot, no ID; unsolicited health)
//   -> READ                  #<id>  ->  WEIGHT <grams> #<id>
//   -> TARE                  #<id>  ->  OK TARE #<id>
//   -> STABLE [<n>] [<tol>]  #<id>  ->  OK STABLE <grams> #<id>
//                                    or  ERR scale-unstable #<id>
//                                    or  ERR scale-timeout #<id>
//
//      Debounced read: returns the mean once the last <n> HX711 samples
//      (default 3, max STABLE_SAMPLES_MAX) all fall within <tol> grams
//      (default STABLE_TOLERANCE_DEFAULT_G). Use this instead of READ
//      when one noisy sample would mis-fire a threshold (glass-present
//      detection, glass-lift detection). Hard 3s internal cap so a user
//      resting a hand on the platform fails fast.
//   -> CAL  <known_grams>    #<id>  ->  OK CAL <factor> #<id>
//   -> RUN  <slot> <ms>      #<id>  ->  DONE #<id>
//   -> POUR <slot> <grams> [<max-sec>] #<id>
//                                    ->  PROGRESS <poured_grams> #<id>     (streamed every ~250ms)
//                                        ...
//                                        DONE <actual_grams> #<id>
//                                    or  ERR no-flow <actual> #<id>       (weight stalled; bottle empty / clog)
//                                    or  ERR scale-timeout <actual> #<id> (HX711 stopped responding)
//                                    or  ERR pour-timeout <actual> #<id>  (host-supplied max-sec elapsed)
//                                    or  ERR glass-removed <actual> #<id> (glass lifted mid-pour)
//
//      <max-sec> is optional. Host computes it from the slot's calibrated
//      flow rate × a slop factor, so the cap scales with the requested
//      grams instead of being a fixed constant. Omitting it falls back to
//      POUR_TIMEOUT_MS_DEFAULT below — used by the diag sketch and the
//      manual serial console where no calibration is available.
//   -> PING                  #<id>  ->  PONG #<id>
//   -> HEALTH                #<id>  ->  HEALTH scale=<ok|fault> #<id>
//
//      Live hardware probe (re-checks the HX711 on demand). The same state
//      is emitted unsolicited at boot as the "STATUS scale=..." line above.
//   -> STOP                          ->  OK STOP                  (no-ID, fire-and-forget)
//                                        ERR aborted #<inflight>  (if a POUR or STABLE was in flight)
//   bad input                       ->  ERR <reason> [#<id>]
//
// Slots are 1-based to match inventory.json on the Pi side.
// CAL persists to EEPROM and survives reboots; tare does not (re-tare per
// session). POUR does NOT tare internally — it samples a baseline at
// pour-start and measures delta from there, leaving the HX711 zero
// undisturbed for other consumers (host glass-watcher, admin maintenance).
//
// Hardware watchdog: a 4s WDT is armed in setup() and kicked from loop() and
// the inner pour/run/cal busy-loops. If the firmware hangs (HX711 wedge,
// infinite buffer fill, stack corruption, EMI bit flip), the chip resets,
// re-runs setup() — which deliberately drives every relay OFF before
// switching pins to OUTPUT — and emits READY. The host treats a mid-session
// READY as a reset and rejects its queued commands, so the worst case for
// the user is one failed pour instead of a frozen kiosk.

#include "HX711.h"
#include <EEPROM.h>
#include <avr/wdt.h>

const uint8_t RELAY_PINS[16] = {
  2, 3, 4, 5, 6, 7, 8, 9,
  10, 11, 12, 13, A0, A1, A2, A3,
};

const uint8_t HX711_DT  = A4;
const uint8_t HX711_SCK = A5;

// Most cheap 16-ch relay boards trigger on LOW. Flip if yours is active-HIGH.
const bool RELAY_ACTIVE_LOW = true;

// Loaded from EEPROM on boot if a valid record exists; otherwise raw counts.
// Set by `CAL <known_grams>` and persisted automatically.
float scaleFactor = 1.0f;

// Live load-cell health. false when the HX711 isn't responding. Set at boot
// by the bounded tare, refreshed by every scale access and the HEALTH command,
// and surfaced to the host via the boot STATUS line and HEALTH replies.
bool scaleOk = false;

// Bump if the EEPROM layout ever changes — old records will be ignored
// and the sketch falls back to the default factor until re-calibrated.
const uint32_t CAL_MAGIC = 0xCA1B0001UL;
const int CAL_EEPROM_ADDR = 0;

struct CalRecord {
  uint32_t magic;
  float scaleFactor;
};

// Kill any closed-loop pour that hasn't reached target by here. The host
// supplies a per-pour value as an optional 3rd POUR arg, computed from
// the slot's calibrated flow rate. These two constants are only the
// fallback (host omits the arg) and the hard ceiling (host value clamped
// to this so a misconfigured host can't make a pump run forever).
const uint32_t POUR_TIMEOUT_MS_DEFAULT = 600000UL;  // 10 min — generous fallback
const uint32_t POUR_TIMEOUT_MS_MAX     = 900000UL;  // 15 min — hard ceiling

// Stop slightly early to compensate for liquid still in the air column.
// Tune once real pumps are mounted.
const float POUR_OVERSHOOT_GUARD_G = 0.5f;

// Cadence for streaming PROGRESS updates during a closed-loop pour. 250ms
// gives the UI a smooth-looking bar (~4 updates/sec) while costing roughly
// 100 chars/sec on the serial link — negligible at 115200.
const uint32_t PROGRESS_INTERVAL_MS = 250;

// No-flow guard: if weight hasn't advanced by NO_FLOW_PROGRESS_G in
// NO_FLOW_WINDOW_MS the pour aborts with ERR no-flow. Threshold is
// deliberately lenient (catches near-zero flow only) — at typical pump
// rates of 1-5 g/s, a 5s window delivers 5-25g, well clear of the 1g
// gate. Failure mode this catches: empty bottle, kinked tube, detached
// hopper. Tune lower if your pumps are very slow.
const uint32_t NO_FLOW_WINDOW_MS = 5000;
const float    NO_FLOW_PROGRESS_G = 1.0f;

// Glass-removed guard: a strongly negative *delta from pour-start* means
// the glass that was on the platform when POUR began is no longer there.
// Without this check the pour would run for the full NO_FLOW_WINDOW (5s)
// spraying liquid onto the platform — relying on no-flow to catch it is
// far too slow. N consecutive samples are required so a single ADC blip
// can't false-abort a healthy pour.
const float    GLASS_REMOVED_THRESHOLD_G = -50.0f;
const uint8_t  GLASS_REMOVED_SAMPLES     = 3;

// HX711 read guard: if the load cell stops responding (loose DOUT line,
// ADC stuck) get_units() would block until the WDT fires. Cap each read
// at 500ms so we can fail with a clean ERR scale-timeout instead.
const uint32_t SCALE_READ_TIMEOUT_MS = 500;

// STABLE primitive: returns the mean of N HX711 samples once they all
// agree within `tolerance` grams. Defaults are tuned for "glass placement"
// type events — settle within a few hundred ms once the user stops moving.
// MAX is the rolling-buffer ceiling; the host can request fewer samples
// for a faster (but less debounced) reading.
const uint8_t  STABLE_SAMPLES_DEFAULT     = 3;
const uint8_t  STABLE_SAMPLES_MAX         = 10;
const float    STABLE_TOLERANCE_DEFAULT_G = 0.5f;
// Hard internal cap. A user resting a hand on the platform never settles,
// so we bail with ERR scale-unstable and let the host loop and try again.
// Must stay well under the 4s WDT window.
const uint32_t STABLE_TIMEOUT_MS          = 3000;

HX711 scale;

// Set per command from the trailing "#<n>" token (empty if host omitted it).
// Every println goes through printIdSuffix() so the same ID is echoed in the
// matching response.
String currentId = "";
// Captured at the start of any command that calls peekStop() (POUR, STABLE)
// so STOP can fail the right queued command on the host instead of leaving
// it hanging on a reply that never comes.
String inflightId = "";

// Strip a trailing "#<n>" token from `line` and return it (e.g. "#42").
// Returns "" when no ID token is present, leaving `line` unchanged.
String extractId(String& line) {
  int sp = line.lastIndexOf(' ');
  if (sp < 0) return "";
  String tail = line.substring(sp + 1);
  if (tail.length() < 2 || tail.charAt(0) != '#') return "";
  for (uint16_t i = 1; i < tail.length(); i++) {
    if (!isDigit(tail.charAt(i))) return "";
  }
  line = line.substring(0, sp);
  line.trim();
  return tail;
}

void printIdSuffix() {
  if (currentId.length()) {
    Serial.print(' ');
    Serial.print(currentId);
  }
  Serial.println();
}

void relayWrite(uint8_t slot, bool on) {
  bool active = RELAY_ACTIVE_LOW ? !on : on;
  digitalWrite(RELAY_PINS[slot], active ? HIGH : LOW);
}
void allRelaysOff() {
  for (uint8_t i = 0; i < 16; i++) relayWrite(i, false);
}

void loadCalibration() {
  CalRecord rec;
  EEPROM.get(CAL_EEPROM_ADDR, rec);
  if (rec.magic == CAL_MAGIC && isfinite(rec.scaleFactor) && rec.scaleFactor != 0.0f) {
    scaleFactor = rec.scaleFactor;
  }
}

void saveCalibration() {
  CalRecord rec = { CAL_MAGIC, scaleFactor };
  // EEPROM.put compares before writing, so unchanged bytes don't burn cycles.
  EEPROM.put(CAL_EEPROM_ADDR, rec);
}

// Tare without risking an unbounded block. bogde's tare() -> read_average()
// spins in read() until DOUT is ready with no timeout, so a cell that goes
// quiet mid-average would hang until the WDT fires (and could reset-loop on a
// persistently flaky cell). Here we gate every sample on wait_ready_timeout
// and give up cleanly, leaving the previous offset untouched. Returns true
// only if the full average completed.
bool boundedTare(uint8_t times) {
  long sum = 0;
  for (uint8_t i = 0; i < times; i++) {
    wdt_reset();
    if (!scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) return false;
    sum += scale.read();
  }
  scale.set_offset(sum / (long)times);
  return true;
}

// Emit current scale health as a standalone, no-ID status line — an
// unsolicited notification like READY, not a reply to a command.
void reportHealth() {
  Serial.print("STATUS scale=");
  Serial.println(scaleOk ? "ok" : "fault");
}

void setup() {
  // Defensively clear MCUSR and disable the WDT before doing anything else.
  // Older AVR bootloaders left the watchdog armed across resets, which
  // would loop-reset the sketch on entry; modern Optiboot handles it, but
  // the cost here is two instructions and it's bulletproof.
  MCUSR = 0;
  wdt_disable();

  // Write the idle level BEFORE switching to OUTPUT. If we set OUTPUT first,
  // the pin briefly drives LOW and clicks every relay on at power-up.
  for (uint8_t i = 0; i < 16; i++) {
    digitalWrite(RELAY_PINS[i], RELAY_ACTIVE_LOW ? HIGH : LOW);
    pinMode(RELAY_PINS[i], OUTPUT);
  }

  Serial.begin(115200);
  scale.begin(HX711_DT, HX711_SCK);
  loadCalibration();
  scale.set_scale(scaleFactor);

  // Arm the watchdog BEFORE touching the HX711. The old code tared first, but
  // bogde's tare() -> read_average() has no timeout: a load cell that passed
  // the initial ready check and then went quiet mid-average would block here
  // forever — before READY, with the WDT still disabled. That silent,
  // un-recoverable hang was the root cause of the intermittent "no READY on
  // boot". Arming first means the worst case is a clean reset, not a freeze.
  // 4s window still covers the longest legit blocking call (CAL averages 20
  // samples ≈ 2s at 10Hz) with margin.
  wdt_enable(WDTO_4S);

  // Bounded, non-blocking tare (see boundedTare). A dead or flaky cell can no
  // longer freeze boot: we tare if it responds, otherwise boot un-tared and
  // flag the scale as faulted. Either way we always reach READY.
  scaleOk = boundedTare(10);

  Serial.println("READY");
  // Announce hardware health right after READY so the host knows on connect
  // if the load cell is down, instead of discovering it at the first pour.
  reportHealth();
}

void loop() {
  wdt_reset();
  static String buf;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (buf.length()) handleCommand(buf);
      buf = "";
    } else {
      buf += c;
      if (buf.length() > 64) buf = "";
    }
  }
}

void handleCommand(String line) {
  line.trim();
  currentId = extractId(line);

  if (line.equalsIgnoreCase("READ")) {
    // Guard the blocking read: a dead HX711 would otherwise make get_units()
    // spin until the WDT resets the board and drops the command. Fail fast
    // with a clean error the host can surface, and update the health flag.
    if (!scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
      scaleOk = false;
      Serial.print("ERR scale-timeout");
      printIdSuffix();
      return;
    }
    scaleOk = true;
    float g = scale.get_units(3);
    Serial.print("WEIGHT ");
    Serial.print(g, 2);
    printIdSuffix();
    return;
  }
  if (line.equalsIgnoreCase("TARE")) {
    // Bounded tare so a non-responsive cell returns an error instead of
    // blocking until the WDT resets us.
    if (!boundedTare(10)) {
      scaleOk = false;
      Serial.print("ERR scale-timeout");
      printIdSuffix();
      return;
    }
    scaleOk = true;
    Serial.print("OK TARE");
    printIdSuffix();
    return;
  }
  if (line.equalsIgnoreCase("PING")) {
    Serial.print("PONG");
    printIdSuffix();
    return;
  }
  if (line.equalsIgnoreCase("HEALTH")) {
    // Live re-probe so the answer reflects the scale's current state rather
    // than a stale boot-time flag. Cheap: one readiness poll, no averaging.
    scaleOk = scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS);
    Serial.print("HEALTH scale=");
    Serial.print(scaleOk ? "ok" : "fault");
    printIdSuffix();
    return;
  }
  if (line.equalsIgnoreCase("STOP")) {
    allRelaysOff();
    Serial.print("OK STOP");
    printIdSuffix();
    return;
  }
  // Bare STABLE (no args) → defaults. The args-bearing form is handled
  // alongside CAL below since it doesn't take a slot.
  if (line.equalsIgnoreCase("STABLE")) {
    stableRead(STABLE_SAMPLES_DEFAULT, STABLE_TOLERANCE_DEFAULT_G);
    return;
  }

  int sp1 = line.indexOf(' ');
  if (sp1 < 0) { Serial.print("ERR bad-format"); printIdSuffix(); return; }
  String op = line.substring(0, sp1);
  String rest = line.substring(sp1 + 1);
  rest.trim();

  if (op.equalsIgnoreCase("CAL")) {
    float knownG = rest.toFloat();
    calibrateScale(knownG);
    return;
  }
  if (op.equalsIgnoreCase("STABLE")) {
    // "STABLE <n> [<tolerance>]". toFloat() stops at the first non-numeric
    // char so reading <n> as int via toInt() then peeling off the tolerance
    // works whether one or two args follow.
    int nReq = rest.toInt();
    uint8_t n = (nReq <= 0) ? STABLE_SAMPLES_DEFAULT : (uint8_t)nReq;
    float tol = STABLE_TOLERANCE_DEFAULT_G;
    int sp = rest.indexOf(' ');
    if (sp >= 0) {
      float t = rest.substring(sp + 1).toFloat();
      if (t > 0) tol = t;
    }
    stableRead(n, tol);
    return;
  }

  int sp2 = rest.indexOf(' ');
  if (sp2 < 0) { Serial.print("ERR bad-format"); printIdSuffix(); return; }
  int slotArg = rest.substring(0, sp2).toInt();
  String afterSlot = rest.substring(sp2 + 1);
  afterSlot.trim();
  // toFloat() stops at the first non-numeric char, so it correctly grabs
  // just the grams/ms even when an optional 3rd arg follows.
  float arg = afterSlot.toFloat();
  if (slotArg < 1 || slotArg > 16) { Serial.print("ERR bad-slot"); printIdSuffix(); return; }
  uint8_t slot = (uint8_t)(slotArg - 1);

  if (op.equalsIgnoreCase("RUN")) {
    runTimed(slot, (uint32_t)arg);
  } else if (op.equalsIgnoreCase("POUR")) {
    // Optional 3rd arg: max-seconds. Falls back to POUR_TIMEOUT_MS_DEFAULT
    // when absent (diag sketch, manual console). Clamped to MAX so a
    // misconfigured host can't disable the runaway-pour safety net.
    uint32_t pourTimeoutMs = POUR_TIMEOUT_MS_DEFAULT;
    int sp3 = afterSlot.indexOf(' ');
    if (sp3 >= 0) {
      float maxSec = afterSlot.substring(sp3 + 1).toFloat();
      if (maxSec > 0) {
        uint32_t requested = (uint32_t)(maxSec * 1000.0f);
        pourTimeoutMs = requested > POUR_TIMEOUT_MS_MAX ? POUR_TIMEOUT_MS_MAX : requested;
      }
    }
    pourClosedLoop(slot, arg, pourTimeoutMs);
  } else {
    Serial.print("ERR unknown-cmd"); printIdSuffix();
  }
}

void calibrateScale(float knownG) {
  if (!(knownG > 0)) { Serial.print("ERR bad-mass"); printIdSuffix(); return; }
  // get_value() returns raw - tare offset, so the user's TARE on an empty
  // cell before placing the mass is what makes this division correct.
  // 20 samples at 10Hz ≈ 2s of blocking — kick the WDT first so we don't
  // race the 4s window.
  wdt_reset();
  if (!scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
    scaleOk = false;
    Serial.print("ERR scale-timeout"); printIdSuffix(); return;
  }
  long raw = scale.get_value(20);
  float factor = (float)raw / knownG;
  if (!isfinite(factor) || factor == 0.0f) { Serial.print("ERR cal-failed"); printIdSuffix(); return; }
  scaleFactor = factor;
  scale.set_scale(scaleFactor);
  saveCalibration();
  scaleOk = true;
  Serial.print("OK CAL ");
  Serial.print(scaleFactor, 4);
  printIdSuffix();
}

void runTimed(uint8_t slot, uint32_t ms) {
  relayWrite(slot, true);
  uint32_t start = millis();
  while (millis() - start < ms) {
    wdt_reset();
    if (peekStop()) return;
  }
  relayWrite(slot, false);
  Serial.print("DONE");
  printIdSuffix();
}

// Debounced weight read. Samples the HX711 in a rolling buffer of <nSamples>
// and returns the mean once the spread (max - min) across the buffer is
// within <tolerance> grams. Used by host-side glass detection: one STABLE
// gives a high-quality reading without the host having to debounce noisy
// single-sample READs across a long round-trip. Capped at STABLE_TIMEOUT_MS
// so a user resting a hand on the platform fails fast with ERR scale-unstable
// and the host can loop, rather than us starving the WDT.
void stableRead(uint8_t nSamples, float tolerance) {
  // Stash the ID so peekStop() emits "ERR aborted #<id>" against the right
  // queued command if STOP arrives mid-sample.
  inflightId = currentId;

  if (nSamples < 2) nSamples = 2;
  if (nSamples > STABLE_SAMPLES_MAX) nSamples = STABLE_SAMPLES_MAX;
  if (!(tolerance > 0)) tolerance = STABLE_TOLERANCE_DEFAULT_G;

  float buf[STABLE_SAMPLES_MAX];
  uint8_t filled = 0;
  uint8_t head = 0;
  uint32_t start = millis();

  while (millis() - start < STABLE_TIMEOUT_MS) {
    wdt_reset();
    if (peekStop()) { inflightId = ""; return; }
    if (!scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
      scaleOk = false;
      Serial.print("ERR scale-timeout");
      printIdSuffix();
      inflightId = "";
      return;
    }
    float g = scale.get_units(1);
    buf[head] = g;
    head = (head + 1) % nSamples;
    if (filled < nSamples) filled++;

    if (filled >= nSamples) {
      float lo = buf[0], hi = buf[0], sum = buf[0];
      for (uint8_t i = 1; i < nSamples; i++) {
        if (buf[i] < lo) lo = buf[i];
        if (buf[i] > hi) hi = buf[i];
        sum += buf[i];
      }
      if (hi - lo <= tolerance) {
        scaleOk = true;
        Serial.print("OK STABLE ");
        Serial.print(sum / nSamples, 2);
        printIdSuffix();
        inflightId = "";
        return;
      }
    }
  }
  Serial.print("ERR scale-unstable");
  printIdSuffix();
  inflightId = "";
}

void pourClosedLoop(uint8_t slot, float targetG, uint32_t timeoutMs) {
  // Stash the ID so peekStop() can reference it if STOP arrives mid-pour;
  // the host needs to know which queued POUR to fail.
  inflightId = currentId;

  // Capture a baseline weight reading once at pour start, then measure
  // delta from that baseline for the entire pour. We deliberately do NOT
  // call scale.tare() here — the HX711's tare offset is a shared resource
  // (the host-side glass watcher reads absolute grams to decide what
  // "empty platform" looks like), and re-zeroing it on every pour leads
  // to a desync where the watcher can get stuck believing no glass is
  // present after a pour ends. Tracking a per-pour delta in software
  // gives us the same closed-loop behavior with no global side-effect.
  //
  // Average 10 samples so a single noisy reading doesn't bias the
  // baseline by enough to either overshoot the target or false-trip the
  // glass-removed guard. If the HX711 is dead we bail immediately rather
  // than running the pump blind.
  float wStart = 0.0f;
  if (scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
    wStart = scale.get_units(10);
  } else {
    scaleOk = false;
    Serial.print("ERR scale-timeout 0.00");
    printIdSuffix();
    inflightId = "";
    return;
  }
  delay(50);

  relayWrite(slot, true);
  uint32_t start = millis();
  uint32_t lastProgressMs = 0;
  uint32_t lastFlowTimeMs = millis();
  float poured = 0;
  float lastFlowG = 0;
  uint8_t glassRemovedConsecutive = 0;
  bool timedOut = false;
  bool noFlow = false;
  bool scaleTimeout = false;
  bool glassRemoved = false;
  while (poured < (targetG - POUR_OVERSHOOT_GUARD_G)) {
    if (millis() - start > timeoutMs) { timedOut = true; break; }
    if (peekStop()) { inflightId = ""; return; }
    wdt_reset();
    if (!scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
      // Pump is on but we can't measure — stop immediately rather than
      // risk an unbounded overpour while waiting for the WDT to fire.
      scaleOk = false;
      scaleTimeout = true;
      break;
    }
    // Delta from the pour-start baseline. Stays positive while liquid
    // accumulates in the glass; goes strongly negative only if the glass
    // is physically removed from the platform.
    poured = scale.get_units(1) - wStart;
    // Glass-removed check. Mid-pour readings stay ≥0 (modulo noise) while
    // the glass is still there; a strongly negative delta means the
    // glass has been lifted. Require N consecutive samples below the
    // threshold so a single ADC blip can't false-abort a healthy pour.
    if (poured < GLASS_REMOVED_THRESHOLD_G) {
      glassRemovedConsecutive++;
      if (glassRemovedConsecutive >= GLASS_REMOVED_SAMPLES) {
        glassRemoved = true;
        break;
      }
    } else {
      glassRemovedConsecutive = 0;
    }
    uint32_t now = millis();
    if (poured > lastFlowG + NO_FLOW_PROGRESS_G) {
      lastFlowG = poured;
      lastFlowTimeMs = now;
    } else if (now - lastFlowTimeMs > NO_FLOW_WINDOW_MS) {
      noFlow = true;
      break;
    }
    if (now - lastProgressMs >= PROGRESS_INTERVAL_MS) {
      lastProgressMs = now;
      Serial.print("PROGRESS ");
      Serial.print(poured, 2);
      printIdSuffix();
    }
  }
  relayWrite(slot, false);

  delay(150);
  // Settling read: capture liquid still in the air column after pump-off.
  // Same delta-from-baseline math as inside the loop. If the scale doesn't
  // respond, fall back to the last mid-pour value — the pump is already
  // off, so we just lose the air-column correction.
  float actual = poured;
  if (scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
    actual = scale.get_units(5) - wStart;
  }

  if (scaleTimeout) {
    Serial.print("ERR scale-timeout ");
  } else if (glassRemoved) {
    // Glass lifted mid-pour. Distinct from no-flow so the host can show
    // "Glass was removed — please replace and try again" instead of the
    // misleading "out of <ingredient>".
    Serial.print("ERR glass-removed ");
  } else if (noFlow) {
    // Out of liquid, kinked tube, or pump that no longer moves fluid.
    // Distinct from pour-timeout so the host can show "out of <ingredient>"
    // instead of a generic timeout.
    Serial.print("ERR no-flow ");
  } else if (timedOut) {
    Serial.print("ERR pour-timeout ");
  } else {
    Serial.print("DONE ");
  }
  Serial.print(actual, 2);
  printIdSuffix();
  inflightId = "";
}

// Mid-operation serial check. Only honors STOP — anything else is dropped on
// the floor since the host shouldn't be sending other commands while a POUR
// or STABLE is in flight. Returns true if the current operation should abort.
//
// On abort we emit two lines: "OK STOP" (echoes the STOP's own ID, if any)
// for the side-channel ack, then "ERR aborted #<inflight-id>" so the host
// can match the failure to the queued command (POUR or STABLE) and fail it
// cleanly instead of waiting for a reply that will never come.
bool peekStop() {
  static String mid;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      String line = mid;
      mid = "";
      line.trim();
      if (line.length() == 0) continue;
      String stopId = extractId(line);
      if (line.equalsIgnoreCase("STOP")) {
        allRelaysOff();
        Serial.print("OK STOP");
        if (stopId.length()) { Serial.print(' '); Serial.print(stopId); }
        Serial.println();
        Serial.print("ERR aborted");
        if (inflightId.length()) { Serial.print(' '); Serial.print(inflightId); }
        Serial.println();
        return true;
      }
      // Other commands during a pour/stable are silently dropped — host
      // shouldn't be sending them, and we don't want to perturb the loop.
    } else {
      mid += c;
      // Bumped from 16: must fit "STOP #<id>" without overflowing.
      if (mid.length() > 64) mid = "";
    }
  }
  return false;
}
