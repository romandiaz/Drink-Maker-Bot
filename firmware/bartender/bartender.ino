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
//   -> READ                  #<id>  ->  WEIGHT <grams> #<id>
//   -> TARE                  #<id>  ->  OK TARE #<id>
//   -> CAL  <known_grams>    #<id>  ->  OK CAL <factor> #<id>
//   -> RUN  <slot> <ms>      #<id>  ->  DONE #<id>
//   -> POUR <slot> <grams> [<max-sec>] #<id>
//                                    ->  PROGRESS <poured_grams> #<id>     (streamed every ~250ms)
//                                        ...
//                                        DONE <actual_grams> #<id>
//                                    or  ERR no-flow <actual> #<id>       (weight stalled; bottle empty / clog)
//                                    or  ERR scale-timeout <actual> #<id> (HX711 stopped responding)
//                                    or  ERR pour-timeout <actual> #<id>  (host-supplied max-sec elapsed)
//
//      <max-sec> is optional. Host computes it from the slot's calibrated
//      flow rate × a slop factor, so the cap scales with the requested
//      grams instead of being a fixed constant. Omitting it falls back to
//      POUR_TIMEOUT_MS_DEFAULT below — used by the diag sketch and the
//      manual serial console where no calibration is available.
//   -> PING                  #<id>  ->  PONG #<id>
//   -> STOP                          ->  OK STOP                (no-ID, fire-and-forget)
//                                        ERR aborted #<pour-id> (only if a POUR was in flight)
//   bad input                       ->  ERR <reason> [#<id>]
//
// Slots are 1-based to match inventory.json on the Pi side.
// CAL persists to EEPROM and survives reboots; tare does not (re-tare per session).
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

// HX711 read guard: if the load cell stops responding (loose DOUT line,
// ADC stuck) get_units() would block until the WDT fires. Cap each read
// at 500ms so we can fail with a clean ERR scale-timeout instead.
const uint32_t SCALE_READ_TIMEOUT_MS = 500;

HX711 scale;

// Set per command from the trailing "#<n>" token (empty if host omitted it).
// Every println goes through printIdSuffix() so the same ID is echoed in the
// matching response.
String currentId = "";
// Captured at POUR start so peekStop() can fail the right queued command on
// the host when STOP arrives mid-pour.
String inflightPourId = "";

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
  // Skip the tare if the HX711 isn't responding — tare() would otherwise
  // block forever and we haven't armed the WDT yet. Pours will fail with
  // ERR scale-timeout in that state, which the host surfaces clearly.
  if (scale.wait_ready_timeout(1000)) {
    scale.tare();
  }

  // 4s window: long enough to cover the worst legit blocking call (CAL
  // averages 20 HX711 samples ≈ 2s at the default 10Hz rate) with margin,
  // short enough that a real hang recovers fast.
  wdt_enable(WDTO_4S);

  Serial.println("READY");
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
    float g = scale.get_units(3);
    Serial.print("WEIGHT ");
    Serial.print(g, 2);
    printIdSuffix();
    return;
  }
  if (line.equalsIgnoreCase("TARE")) {
    scale.tare();
    Serial.print("OK TARE");
    printIdSuffix();
    return;
  }
  if (line.equalsIgnoreCase("PING")) {
    Serial.print("PONG");
    printIdSuffix();
    return;
  }
  if (line.equalsIgnoreCase("STOP")) {
    allRelaysOff();
    Serial.print("OK STOP");
    printIdSuffix();
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
  long raw = scale.get_value(20);
  float factor = (float)raw / knownG;
  if (!isfinite(factor) || factor == 0.0f) { Serial.print("ERR cal-failed"); printIdSuffix(); return; }
  scaleFactor = factor;
  scale.set_scale(scaleFactor);
  saveCalibration();
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

void pourClosedLoop(uint8_t slot, float targetG, uint32_t timeoutMs) {
  // Stash the ID so peekStop() can reference it if STOP arrives mid-pour;
  // the host needs to know which queued POUR to fail.
  inflightPourId = currentId;

  // Best-effort tare: if the HX711 is dead we'll catch it in the loop
  // below and bail with ERR scale-timeout rather than blocking here.
  if (scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
    scale.tare();
  }
  delay(50);

  relayWrite(slot, true);
  uint32_t start = millis();
  uint32_t lastProgressMs = 0;
  uint32_t lastFlowTimeMs = millis();
  float poured = 0;
  float lastFlowG = 0;
  bool timedOut = false;
  bool noFlow = false;
  bool scaleTimeout = false;
  while (poured < (targetG - POUR_OVERSHOOT_GUARD_G)) {
    if (millis() - start > timeoutMs) { timedOut = true; break; }
    if (peekStop()) { inflightPourId = ""; return; }
    wdt_reset();
    if (!scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
      // Pump is on but we can't measure — stop immediately rather than
      // risk an unbounded overpour while waiting for the WDT to fire.
      scaleTimeout = true;
      break;
    }
    poured = scale.get_units(1);
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
  // If the scale doesn't respond, fall back to the last mid-pour value —
  // the pump is already off, so we just lose the air-column correction.
  float actual = poured;
  if (scale.wait_ready_timeout(SCALE_READ_TIMEOUT_MS)) {
    actual = scale.get_units(5);
  }

  if (scaleTimeout) {
    Serial.print("ERR scale-timeout ");
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
  inflightPourId = "";
}

// Mid-pour serial check. Only honors STOP — anything else is dropped on the
// floor for now since the host shouldn't be sending other commands during a
// pour. Returns true if the pour should abort.
//
// On abort we emit two lines: "OK STOP" (echoes the STOP's own ID, if any)
// for the side-channel ack, then "ERR aborted #<inflight-pour-id>" so the
// host can match the failure to the queued POUR command and fail it cleanly
// instead of waiting for a DONE that will never come.
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
        if (inflightPourId.length()) { Serial.print(' '); Serial.print(inflightPourId); }
        Serial.println();
        return true;
      }
      // Other commands during a pour are silently dropped — host shouldn't
      // be sending them, and we don't want to perturb the closed loop.
    } else {
      mid += c;
      // Bumped from 16: must fit "STOP #<id>" without overflowing.
      if (mid.length() > 64) mid = "";
    }
  }
  return false;
}
