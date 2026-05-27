# Carrier PCB Design

Reference spec for the carrier/interconnect PCB that hosts the Arduino Nano,
HX711 module, and relay-board ribbon. Use this as the source of truth while
drawing the schematic and layout in KiCad.

## Goals

- Single 12V cable into the board powers everything on the brain side.
- Sockets for the Arduino Nano and HX711 module so they remain swappable.
  The HX711 has 4-pin headers soldered on **both** sides (its onboard green
  screw-terminal block is removed and replaced with pin headers) and plugs
  flat onto the PCB via two 4-pin sockets.
- Screw terminals for the load cell (on the PCB) and 12V input.
- IDC ribbon connector to the 16-channel relay board.
- Pull-ups on every relay control line so an absent/reset Nano keeps relays OFF.
- Quiet HX711 supply so pump-coil switching noise doesn't bias pour weights.

## Non-goals

- Pump motor power does **not** route through this PCB. The 12V pump rail goes
  directly from the PSU to the relay board's COM contacts to the pumps. This
  PCB only handles the low-current control side.
- Relay coil supply (12V) also does **not** route through this PCB. The Songle
  SRD-12VDC-SL-C relays are fully opto-isolated from the logic side. Their 12V
  coil supply runs from the PSU directly to the relay board's dedicated
  `VCC/GND` screw terminal — never crossing this PCB or the ribbon cable. The
  PCB supplies only 5V logic + IN1-16 signals via the ribbon.
- No on-board MCU. The Nano stays socketed so firmware iteration is unchanged.
- No level shifting. Everything is 5V logic end-to-end.

## Power topology

```
  12V PSU ──┬──► (existing 12V→5V USB) ──► Pi + screen
            │
            ├──► J_PWR (carrier PCB) ──► MP1584 buck ──► +5V rail
            │                                              │
            │                  ┌───────────────────────────┼───────────────────┐
            │                  ▼                           ▼                   ▼
            │            Nano +5V pin            Relay board logic 5V    HX711 VCC
            │                                    (J_RELAY ribbon          (via ferrite +
            │                                     pins 1, 2)               100µF filter)
            │
            ├──► Relay board GND/VCC screw terminal (12V coil supply, direct)
            │
            └──► Pump motor rail (12V, switched through relay contacts)
```

Three independent 12V taps off the PSU. The brain-side tap (carrier PCB) only
carries ~150mA peak (Nano + opto LEDs + HX711) so the buck and `VIN_12V`
trace have a very easy life. The high-current paths (relay coils, pump motors)
bypass the PCB entirely, which is what keeps the HX711 quiet.

Star-tie all grounds at a single point near the buck output. The HX711 ground
runs as a dedicated wire back to the star point — not through the relay header
ground.

**Source PSU:** generic S-180-12 (180W, 12V/15A, regulated enclosed supply,
built-in OVP/OCP/OTP, V_ADJ trim pot for ~10.8–13.2V). Peak system draw is
~25W, so the PSU is over-spec — fine, gives margin if pumps stall.

**Distribution:** the PSU has two `+V` and two `-V` screw terminals (paralleled
internally) but four 12V loads (Pi+screen, carrier PCB, relay coil supply,
pump motor rail). Add a small panel or DIN-rail terminal block off one `+V`/`-V`
pair to fan out — this is a wiring decision, not a PCB feature.

## Pin assignments

Pulled from `firmware/bartender/bartender.ino`. Do not change without updating
the firmware in lockstep.

| Pump slot | Nano pin | Net name  |
|-----------|----------|-----------|
| 1         | D2       | RELAY1    |
| 2         | D3       | RELAY2    |
| 3         | D4       | RELAY3    |
| 4         | D5       | RELAY4    |
| 5         | D6       | RELAY5    |
| 6         | D7       | RELAY6    |
| 7         | D8       | RELAY7    |
| 8         | D9       | RELAY8    |
| 9         | D10      | RELAY9    |
| 10        | D11      | RELAY10   |
| 11        | D12      | RELAY11   |
| 12        | D13      | RELAY12   |
| 13        | A0       | RELAY13   |
| 14        | A1       | RELAY14   |
| 15        | A2       | RELAY15   |
| 16        | A3       | RELAY16   |
| —         | A4       | HX_DT     |
| —         | A5       | HX_SCK    |
| —         | D0/D1    | reserved (USB serial — do not route) |

## Block diagram

```
                              ┌─────────────────────────────────────────┐
                              │            CARRIER PCB                  │
                              │                                         │
   ┌───────┐  12V          ┌──┴──┐                                      │
   │ 12V   ├──────────────►│J_PWR│──► [MP1584 module] ──► +5V rail      │
   │ PSU   │  GND           │ 2T  │                          │          │
   └───────┘                └─────┘                          │          │
                                                              │          │
                              ┌──────────────────────────────┴──────┐   │
                              │       Arduino Nano (socketed)       │   │
                              │                                     │   │
                              │  D2-D13, A0-A3  ──┐ (16 control)    │   │
                              │  A4 (HX_DT)   ────┼───┐             │   │
                              │  A5 (HX_SCK)  ────┼───┤             │   │
                              │  +5V, GND          │  │             │   │
                              └────────────────────┘  │             │   │
                                       │              │             │   │
                                       │              ▼             │   │
                              [16× 10kΩ to +5V]   ┌────────────┐    │   │
                                       │          │ HX711 (mcu)│    │   │
                                       ▼          │  socketed  │    │   │
                              ┌────────────────┐  └──┬─────────┘    │   │
                              │ J_RELAY        │     │ E+/E-/A+/A-  │   │
                              │ 2×10 IDC header│     │ (4 traces)   │   │
                              │ 16 sig+5V+GND  │     ▼              │   │
                              └────────────────┘  ┌────────────────┐│   │
                                       │          │ J_CELL         ││   │
                                       │          │ 4-pos screw    ││   │
                                       │          └────────────────┘│   │
                              └────────┼─────────────────────────────┘   │
                                       ▼                                  │
                              ribbon cable (5V + 16 INs + GND)            │
                                       │                                  │
                                       ▼                                  │
                              ┌─────────────────────────────┐             │
                              │  16-ch relay board          │             │
                              │  (Songle SRD-12VDC-SL-C,    │◄────────────┘
                              │   opto-iso, low-level trig) │
                              │                             │◄─── 12V coil
                              │  GND/VCC screw term: 12V    │     supply
                              │  in (from PSU, direct)      │     (from PSU,
                              │                             │     bypassing
                              │  COM/NO contacts ──► pumps  │     this PCB)
                              └──────────────┬──────────────┘
                                             │ 12V switched
                                             ▼
                                        16× pumps
                                  (12V from PSU, switched
                                   through relay contacts)
```

## Connectors

| Ref       | Type                                    | Function                                        |
|-----------|-----------------------------------------|-------------------------------------------------|
| J_PWR     | 2-pos 5.08mm screw terminal             | 12V input (V+, GND)                             |
| J_NANO    | 2× 1×15 female header, 0.6" row pitch   | Arduino Nano socket                             |
| J_HX_MCU  | 1×4 female header, 2.54mm               | HX711 MCU-side socket: GND, DT, SCK, VCC        |
| J_HX_CELL | 1×6 female header, 2.54mm               | HX711 cell-side socket: E+, E−, A−, A+, B−, B+ (B− / B+ are NC) |
| J_CELL    | 4-pos 5.08mm screw terminal             | Load cell wires (Red, Black, White, Green)      |
| J_RELAY   | 2×10 IDC box header, shrouded, 2.54mm   | Ribbon cable to relay board                     |
| J_BUCK    | 4 PTH pads matching MP1584 module       | Buck module footprint (solder module in place)  |

The HX711 module is prepared by desoldering its onboard green screw-terminal
block and soldering a 1×4 pin header in its place, so the module has pin
headers on both sides. It then plugs flat onto the PCB into `J_HX_MCU` and
`J_HX_CELL`. The load-cell wires terminate at `J_CELL` on the PCB; the four
cell-side traces run from `J_CELL` to `J_HX_CELL`.

### J_RELAY pinout (2×10 IDC)

Mirrors the relay board's input header exactly so a straight-through ribbon
cable (pin 1 → pin 1) connects them. Confirmed against the project's specific
board: Songle SRD-12VDC-SL-C, low-level trigger, fully opto-isolated, parallel
power-pin layout (both 5V pins on one end, both GND pins on the other).

```
     pin 1 ─── +5V                    pin 2 ─── +5V
     pin 3 ─── IN1  (Nano D2)         pin 4 ─── IN2  (D3)
     pin 5 ─── IN3  (D4)              pin 6 ─── IN4  (D5)
     pin 7 ─── IN5  (D6)              pin 8 ─── IN6  (D7)
     pin 9 ─── IN7  (D8)              pin 10 ── IN8  (D9)
     pin 11 ── IN9  (D10)             pin 12 ── IN10 (D11)
     pin 13 ── IN11 (D12)             pin 14 ── IN12 (D13)
     pin 15 ── IN13 (A0)              pin 16 ── IN14 (A1)
     pin 17 ── IN15 (A2)              pin 18 ── IN16 (A3)
     pin 19 ── GND                    pin 20 ── GND
```

The relay board's 12V coil supply enters at a separate 2-pin screw terminal
on the relay board itself (labeled `GND/VCC`) and is wired directly from the
PSU. Do not put 12V on the ribbon.

### J_CELL → J_HX_CELL wiring

The HX711 module is 33×20mm with a 6-pin header on the cell side (channel A
+ unused channel B). Pin order on the module's P2 silkscreen, top-to-bottom:
`E+, E−, A−, A+, B−, B+`. Load cells vary by maker; verify with a multimeter
(E+/E− is the ~1kΩ pair). Standard color code matching the project's load
cell:

| J_CELL pin | Wire color | Net      | J_HX_CELL pin | Module pad |
|------------|------------|----------|---------------|------------|
| 1          | Red        | CELL_EP  | 1             | E+         |
| 2          | Black      | CELL_EN  | 2             | E−         |
| 3          | White      | CELL_AN  | 3             | A−         |
| 4          | Green      | CELL_AP  | 4             | A+         |
| —          | —          | (NC)     | 5             | B− (unused)|
| —          | —          | (NC)     | 6             | B+ (unused)|

J_HX_CELL pins 5 and 6 are present so the HX711 plugs in mechanically, but
they connect to nothing on the PCB. Don't route them.

### J_HX_MCU pinout

Order matches the silkscreen on the HX711 module shown in the project image,
read from the edge of the module inward:

| J_HX_MCU pin | Net    | HX711 pad | Nano pin |
|--------------|--------|-----------|----------|
| 1            | GND    | GND       | GND      |
| 2            | HX_DT  | DT        | A4       |
| 3            | HX_SCK | SCK       | A5       |
| 4            | HX_5V  | VCC       | (filtered +5V) |

Confirm the pin order on both headers against your specific module before
finalizing the layout — some HX711 boards reverse VCC/GND or swap A+/A−.

## Net list (schematic-level)

Power nets:
- `VIN_12V` — J_PWR pin 1 → buck V_IN, bulk cap +.
- `+5V` — buck V_OUT → Nano +5V, J_RELAY pins 1/2, ferrite input, LED anode.
- `HX_5V` — ferrite output → J_HX_MCU VCC, post-filter caps.
- `GND` — common return, star-tied; reaches J_RELAY at pins 19/20.

Signal nets (one per relay; abbreviated):
- `RELAY1` — Nano D2 → R1 (pull-up to +5V) → J_RELAY pin 3.
- `RELAY2` — Nano D3 → R2 (pull-up) → J_RELAY pin 4.
- … same pattern up through `RELAY16` (Nano A3) → J_RELAY pin 18; mapping
  follows the pin table above (odd RELAYn → odd-row pin, even RELAYn →
  even-row pin).

HX711 signals:
- `HX_DT` — Nano A4 ↔ J_HX_MCU DT pin.
- `HX_SCK` — Nano A5 → J_HX_MCU SCK pin.

Load cell signals:
- `CELL_EP`, `CELL_EN`, `CELL_AN`, `CELL_AP` — J_CELL pins → J_HX_CELL pins,
  short direct traces, kept as far from RELAY* and from the buck switch node
  as physically possible.

## Bill of materials

| Qty | Ref            | Part                          | Notes                                   |
|-----|----------------|-------------------------------|-----------------------------------------|
| 1   | U1             | MP1584EN mini buck module     | Set output to 5.0V before soldering in  |
| 1   | U2 (socket)    | Arduino Nano (user-supplied)  | Sockets only on PCB                     |
| 1   | U3 (socket)    | HX711 module (user-supplied)  | Sockets only on PCB                     |
| 16  | R1–R16         | 10kΩ 1/4W resistor            | 0805 SMT or THT; relay-line pull-ups    |
| 1   | R17            | 1kΩ resistor                  | Power LED current limit                 |
| 1   | D1             | LED, 3mm or 0805, green       | Power indicator                         |
| 1   | FB1            | Ferrite bead, BLM21PG221 or equiv | Or substitute 10Ω 0805 resistor     |
| 1   | C1             | 100µF / 25V electrolytic      | Bulk cap on VIN_12V                     |
| 1   | C2             | 100µF / 10V electrolytic      | Bulk cap on +5V rail                    |
| 1   | C3             | 100µF / 10V tantalum or elec  | HX_5V post-filter                       |
| 4   | C4–C7          | 100nF 0603 or 0805 ceramic    | Decoupling: Nano, HX711, relay, buck    |
| 2   | J_NANO_A/B     | 1×15 female header, 2.54mm    | Nano socket pair                        |
| 1   | J_HX_MCU       | 1×4 female header, 2.54mm     | HX711 MCU-side socket                   |
| 1   | J_HX_CELL      | 1×6 female header, 2.54mm     | HX711 cell-side socket (B−/B+ unused)   |
| 1   | J_CELL         | 4-pos 5.08mm screw terminal   | Load cell                               |
| 1   | J_PWR          | 2-pos 5.08mm screw terminal   | 12V input                               |
| 1   | J_RELAY        | 2×10 IDC box header, shrouded | Relay ribbon                            |
| 6   | TP1–TP6        | Keystone 5000 (or PTH loop)   | 5V, GND, HX_DT, HX_SCK, RELAY1, RELAY8  |
| 4   | —              | M3 mounting holes             | Plated; tie one to GND for shield path  |

## Layout zones (top view, ~100×80mm 2-layer)

```
   ┌────────────────────────────────────────────────┐
   │ [J_PWR 12V]   [Buck U1]          [J_RELAY IDC]│
   │  C1                                            │
   │                                                │
   │       ┌──────────────────────┐                 │
   │       │   J_NANO socket      │   R1..R16       │
   │       │   (Arduino Nano)     │   ▒▒▒▒▒▒▒▒      │
   │       │                      │                 │
   │       └──────────────────────┘                 │
   │                                                │
   │   ─── star ground point ───                    │
   │                                                │
   │       ┌──────────┐   [J_CELL screw term]       │
   │       │  HX711   │                             │
   │       │ (J_HX_MCU+J_HX_CELL sockets)           │
   │       │ FB1 + C3 nearby                        │
   │       └──────────┘                             │
   │                                                │
   │ TP_5V TP_GND TP_DT TP_SCK TP_R1 TP_R8          │
   └────────────────────────────────────────────────┘
```

### Layout rules (enforce in KiCad)

1. **HX711 quiet corner.** Place `J_HX_MCU` + `J_HX_CELL` and the supply
   filter (FB1 + C3) as far from `J_RELAY` and from the buck switching node
   as possible. Pour the ground under the HX711 as a dedicated copper region
   tied to the star point with a single trace. Keep `J_CELL` adjacent to
   `J_HX_CELL` so the four cell-side traces are as short as possible.
2. **Buck switch-node containment.** The MP1584 module's switch node is the
   primary EMI emitter on this board. Do not run any signal traces under it.
   If you have to, route them on the opposite layer with a ground plane between.
3. **DT/SCK length.** Keep `HX_DT` and `HX_SCK` traces under 5 cm. Route them
   as a pair, away from the relay bus. No 90° corners; use 45° or arcs.
4. **Relay bus.** The 16 RELAY* traces and J_RELAY header sit on the opposite
   edge from HX711. Trace width is uncritical (low-current logic) — 0.25mm is
   fine.
5. **Power widths.** Relay coil current doesn't cross this PCB, so `VIN_12V`
   and `+5V` carry only the carrier PCB's own demand (~150mA peak: Nano +
   relay-board opto LEDs + HX711). 0.5mm minimum trace width on 1oz copper
   is plenty. Pour `GND` as a plane regardless.
6. **Connector orientation.** All screw terminals and the IDC header face
   outward, perpendicular to the nearest board edge, so cables clear the
   enclosure.
7. **Mounting holes.** Four M3 holes near corners, ≥3mm from any trace. Tie
   one (preferably the corner nearest J_PWR) to GND for chassis-shield
   continuity if you mount in a metal enclosure.
8. **Silkscreen.** Label every connector pin, every screw terminal, the
   buck voltage (`SET 5.0V`), each test point, and the pump slot number next
   to the relay header (`P1..P16`).

## KiCad project setup

1. New project, e.g. `pcb/bartender-carrier/`.
2. Schematic page size A4, single sheet is enough.
3. Use the built-in `Connector_Generic`, `Resistor_THT`/`Resistor_SMD`,
   `Capacitor_THT`/`Capacitor_SMD` libraries for symbols/footprints.
4. For the Nano: KiCad ships an `Arduino_Nano_v3.x` symbol/footprint pair
   in the `MCU_Module` library — use that and place 1×15 female sockets on
   the PCB to match.
5. For the HX711 and MP1584 modules, create simple generic
   `Connector_PinHeader_1x04_P2.54mm_Vertical` footprints — they're just
   pin sockets from the PCB's perspective.
6. Design rules: 6/6 mil track/clearance is well within JLCPCB's free tier
   and PCBWay's standard process; no need to push tighter.
7. Run ERC, then DRC. Generate Gerbers + drill via
   `File → Plot → Plot` with the JLCPCB or PCBWay preset.
8. The "Fabrication Toolkit" KiCad plugin can package a JLCPCB-ready zip
   in one click if you decide to go that route.

## Open questions

Resolve and record any answers below before fabrication:

- [ ] Verify HX711 wire-up with a multimeter against the actual unit
      before fab. Datasheet image confirms `GND/DT/SCK/VCC` on the MCU side
      and `E+/E−/A−/A+/B−/B+` on the cell side, but sibling boards exist
      that reorder either header.
- [x] Load cell is a single 4-wire bridge — `J_CELL` is a 4-pos screw
      terminal; channel B (B−/B+) is unrouted on the PCB.
- [x] Relay board confirmed: 2×10 input header, parallel power pinout
      (`5V 1 3 5 7 9 11 13 15 GND` on each row, with even INs on the
      opposite row), Songle SRD-12VDC-SL-C, fully opto-isolated, low-level
      trigger. `J_RELAY` pinout matches.
- [x] TVS diode across `VIN_12V` — **not added**. The S-180-12 has built-in
      OVP/OCP/OTP, so an inline TVS is redundant. Revisit only if the PSU is
      ever replaced with an unregulated or generic wall-wart supply.
- [ ] Decide whether to bring out a 2-pin "future I/O" header from one
      unused Nano pin (e.g. D0/D1 are gone, but D-A6/A7 are analog-only and
      still free for a future button or sensor).
