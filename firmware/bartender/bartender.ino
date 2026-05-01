// Bartender Kiosk firmware — Arduino Nano.
//
// Drives a 16-channel relay board (one peristaltic pump per channel) and
// reads an HX711 load-cell amplifier to close the pour loop on weight.
//
// Serial protocol (115200 baud, '\n'-terminated):
//   <- READY                  printed once after boot, before any input
//   -> READ                   ->  WEIGHT <grams>
//   -> TARE                   ->  OK TARE
//   -> CAL <known_grams>      ->  OK CAL <factor>      (cell must hold known mass)
//   -> RUN  <slot> <ms>       ->  DONE                 (timed, ignores scale)
//   -> POUR <slot> <grams>    ->  DONE <actual_grams>  (closed-loop)
//   -> STOP                   ->  OK STOP              (kills any active relay)
//   bad input                 ->  ERR <reason>
//
// Slots are 1-based to match inventory.json on the Pi side.
// CAL persists to EEPROM and survives reboots; tare does not (re-tare per session).

#include "HX711.h"
#include <EEPROM.h>

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

// Kill any closed-loop pour that hasn't reached target by here. Catches an
// empty bottle or a wedged load cell so a pump can't run forever.
const uint32_t POUR_TIMEOUT_MS = 60000;

// Stop slightly early to compensate for liquid still in the air column.
// Tune once real pumps are mounted.
const float POUR_OVERSHOOT_GUARD_G = 0.5f;

HX711 scale;

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
  scale.tare();

  Serial.println("READY");
}

void loop() {
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

  if (line.equalsIgnoreCase("READ")) {
    float g = scale.get_units(3);
    Serial.print("WEIGHT ");
    Serial.println(g, 2);
    return;
  }
  if (line.equalsIgnoreCase("TARE")) {
    scale.tare();
    Serial.println("OK TARE");
    return;
  }
  if (line.equalsIgnoreCase("STOP")) {
    allRelaysOff();
    Serial.println("OK STOP");
    return;
  }

  int sp1 = line.indexOf(' ');
  if (sp1 < 0) { Serial.println("ERR bad-format"); return; }
  String op = line.substring(0, sp1);
  String rest = line.substring(sp1 + 1);
  rest.trim();

  if (op.equalsIgnoreCase("CAL")) {
    float knownG = rest.toFloat();
    calibrateScale(knownG);
    return;
  }

  int sp2 = rest.indexOf(' ');
  if (sp2 < 0) { Serial.println("ERR bad-format"); return; }
  int slotArg = rest.substring(0, sp2).toInt();
  float arg = rest.substring(sp2 + 1).toFloat();
  if (slotArg < 1 || slotArg > 16) { Serial.println("ERR bad-slot"); return; }
  uint8_t slot = (uint8_t)(slotArg - 1);

  if (op.equalsIgnoreCase("RUN"))       runTimed(slot, (uint32_t)arg);
  else if (op.equalsIgnoreCase("POUR")) pourClosedLoop(slot, arg);
  else                                  Serial.println("ERR unknown-cmd");
}

void calibrateScale(float knownG) {
  if (!(knownG > 0)) { Serial.println("ERR bad-mass"); return; }
  // get_value() returns raw - tare offset, so the user's TARE on an empty
  // cell before placing the mass is what makes this division correct.
  long raw = scale.get_value(20);
  float factor = (float)raw / knownG;
  if (!isfinite(factor) || factor == 0.0f) { Serial.println("ERR cal-failed"); return; }
  scaleFactor = factor;
  scale.set_scale(scaleFactor);
  saveCalibration();
  Serial.print("OK CAL ");
  Serial.println(scaleFactor, 4);
}

void runTimed(uint8_t slot, uint32_t ms) {
  relayWrite(slot, true);
  uint32_t start = millis();
  while (millis() - start < ms) {
    if (peekStop()) return;
  }
  relayWrite(slot, false);
  Serial.println("DONE");
}

void pourClosedLoop(uint8_t slot, float targetG) {
  scale.tare();
  delay(50);

  relayWrite(slot, true);
  uint32_t start = millis();
  float poured = 0;
  while (poured < (targetG - POUR_OVERSHOOT_GUARD_G)) {
    if (millis() - start > POUR_TIMEOUT_MS) break;
    if (peekStop()) return;
    poured = scale.get_units(1);
  }
  relayWrite(slot, false);

  delay(150);
  float actual = scale.get_units(5);
  Serial.print("DONE ");
  Serial.println(actual, 2);
}

// Mid-pour serial check. Only honors STOP — anything else is dropped on the
// floor for now since the host shouldn't be sending other commands during a
// pour. Returns true if the pour should abort.
bool peekStop() {
  static String mid;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      bool stop = mid.equalsIgnoreCase("STOP");
      mid = "";
      if (stop) {
        allRelaysOff();
        Serial.println("OK STOP");
        return true;
      }
    } else {
      mid += c;
      if (mid.length() > 16) mid = "";
    }
  }
  return false;
}
