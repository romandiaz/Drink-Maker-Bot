// Bartender diag sketch — minimal Arduino Nano sanity check.
//
// On boot: prints READY.
// On a slow tick: cycles each of 16 relays in turn and prints "RELAY:<n>".
// Per byte received: echoes "RX:<chr>(<dec>)" so the host's TX is visible
//                    even when the line-ending dropdown is wrong.
// On '\n' or '\r' terminator: also echoes "LINE:<accumulated_text>".
//
// Recognized commands (typed at Serial Monitor):
//   READ  -> WEIGHT <raw_counts>     reads the HX711 (uncalibrated)
//   TARE  -> OK TARE                 zeros the cell at current resting load
//
// No EEPROM, no watchdog, no command IDs. This sketch is for hardware
// bring-up only; switch back to bartender.ino for real pours.

#include "HX711.h"

const uint8_t RELAY_PINS[16] = {
  2, 3, 4, 5, 6, 7, 8, 9,
  10, 11, 12, 13, A0, A1, A2, A3,
};
const bool RELAY_ACTIVE_LOW = true;
// Slowed from 1s to 3s so HX711 output isn't drowned out by RELAY ticks.
const uint32_t RELAY_ON_MS  = 200;
const uint32_t RELAY_GAP_MS = 2800;

const uint8_t HX711_DT  = A4;
const uint8_t HX711_SCK = A5;
HX711 scale;

void relayWrite(uint8_t i, bool on) {
  bool active = RELAY_ACTIVE_LOW ? !on : on;
  digitalWrite(RELAY_PINS[i], active ? HIGH : LOW);
}

void setup() {
  // Drive idle level BEFORE switching to OUTPUT, so we don't click every
  // relay on for one CPU cycle at power-up.
  for (uint8_t i = 0; i < 16; i++) {
    digitalWrite(RELAY_PINS[i], RELAY_ACTIVE_LOW ? HIGH : LOW);
    pinMode(RELAY_PINS[i], OUTPUT);
  }
  Serial.begin(115200);
  scale.begin(HX711_DT, HX711_SCK);
  // Don't tare here — wait for the user's TARE command so they can choose
  // when (e.g. with the empty glass on the cell). If HX711 isn't wired,
  // skip silently so READY still prints.
  if (scale.wait_ready_timeout(500)) {
    Serial.println("HX711:OK");
  } else {
    Serial.println("HX711:NOT_RESPONDING");
  }
  Serial.println("READY");
}

void handleLine(const String& line) {
  if (line.equalsIgnoreCase("READ")) {
    if (!scale.wait_ready_timeout(500)) {
      Serial.println("ERR scale-timeout");
      return;
    }
    long raw = scale.read_average(3);
    Serial.print("WEIGHT ");
    Serial.println(raw);
    return;
  }
  if (line.equalsIgnoreCase("TARE")) {
    if (!scale.wait_ready_timeout(500)) {
      Serial.println("ERR scale-timeout");
      return;
    }
    scale.tare();
    Serial.println("OK TARE");
    return;
  }
  Serial.print("UNKNOWN:");
  Serial.println(line);
}

void loop() {
  static uint8_t slot = 0;
  static String buf;

  while (Serial.available()) {
    char c = (char)Serial.read();
    Serial.print("RX:");
    Serial.print(c);
    Serial.print("(");
    Serial.print((int)c);
    Serial.println(")");
    if (c == '\n' || c == '\r') {
      if (buf.length()) {
        Serial.print("LINE:");
        Serial.println(buf);
        handleLine(buf);
      }
      buf = "";
    } else {
      buf += c;
      if (buf.length() > 64) buf = "";
    }
  }

  Serial.print("RELAY:");
  Serial.println(slot + 1);
  relayWrite(slot, true);
  delay(RELAY_ON_MS);
  relayWrite(slot, false);
  delay(RELAY_GAP_MS);
  slot = (slot + 1) % 16;
}
