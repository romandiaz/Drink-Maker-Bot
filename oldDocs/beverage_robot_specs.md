# Beverage Robot Technical Specification
## Project: Diaz Creative Studio Automated Mixology System

This document provides the technical context for software development on a Raspberry Pi (UI) and Arduino Nano (Hardware Control) cocktail machine.

---

## 1. System Architecture
- **Master:** Raspberry Pi 3 B+ (Python / Kivy or Tkinter)
- **Slave:** Arduino Nano (C++ / Arduino Wire)
- **Interface:** USB Serial (`/dev/ttyUSB0` or `/dev/ttyACM0`)
- **Control Logic:** The Pi sends high-level commands (e.g., "POUR:1:50"); the Nano executes real-time weight monitoring and relay switching.

---

## 2. Pin Mapping (Arduino Nano)

| Component | Pin | Function |
| :--- | :--- | :--- |
| **HX711 DT** | D2 | Load Cell Data |
| **HX711 SCK** | D3 | Load Cell Clock |
| **Relays 1-10** | D4 - D13 | Pump Control (Active Low) |
| **Relays 11-16** | A0 - A5 | Pump Control (Mapped as Digital Pins) |

---

## 3. Communication Protocol (Serial)

### Pi to Nano Commands
- `POUR:PUMP_ID:WEIGHT_GRAMS` -> Start dispensing.
- `STOP` -> Emergency stop all pumps.
- `TARE` -> Zero out the load cell.
- `STATUS` -> Request current weight/pump status.

### Nano to Pi Responses
- `WEIGHT:XX.X` -> Real-time weight data.
- `READY` -> System idle and ready.
- `DONE:PUMP_ID` -> Successfully finished a pour.
- `ERROR:NO_GLASS` -> Safety trigger if load cell detects no weight change.

---

## 4. Hardware Specifics for Software Logic
- **Relay Logic:** 16-channel board is **Active Low**. 
  - `digitalWrite(pin, LOW)` = Pump ON.
  - `digitalWrite(pin, HIGH)` = Pump OFF.
- **Dispensing Logic:**
  - Pumps 1-13: Peristaltic (Steady flow).
  - Pumps 14-16: Diaphragm (Carbonated mixers).
- **Scale Calibration:** The HX711 requires a `calibration_factor` to convert raw units to grams.

---

## 5. Software Requirements
- **Raspberry Pi:** Python 3, `pyserial`, `JSON` for recipes.
- **Arduino:** `HX711` library, Serial at 115200 baud.
