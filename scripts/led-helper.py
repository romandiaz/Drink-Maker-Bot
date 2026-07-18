#!/usr/bin/env python3
# Thin WS2812/SK6812 renderer for the bartender kiosk.
#
# All animation lives in the Node backend (src/server/leds.js). This process is
# just the hardware sink: it reads one frame per stdin line — LED_COUNT
# space-separated RRGGBB hex triplets — and pushes it to the strip via the
# maintained rpi_ws281x library. (The Node-native WS2812 bindings are
# unmaintained and no longer build against modern Node/V8, which is why the
# render path lives here in Python.)
#
# leds.js spawns this and streams frames to it. The backend runs as root
# because rpi_ws281x needs /dev/mem for DMA, so this inherits root too.
#
# Config comes from the environment (set by leds.js): LED_COUNT, LED_GPIO
# (default 21 = PCM / physical pin 40), LED_BRIGHTNESS.

import os
import sys

from rpi_ws281x import PixelStrip, Color

COUNT = int(os.environ.get("LED_COUNT", "60"))
GPIO = int(os.environ.get("LED_GPIO", "21"))
BRIGHTNESS = int(os.environ.get("LED_BRIGHTNESS", "128"))

# 800kHz data rate, DMA channel 10, no signal invert, hardware channel 0.
# Channel 0 covers GPIO21 (PCM) and GPIO18 (PWM0); channel 1 is only for the
# PWM1 pins (GPIO13 / GPIO19).
strip = PixelStrip(COUNT, GPIO, 800000, 10, False, BRIGHTNESS, 0)
strip.begin()
print(f"led-helper: ready on GPIO{GPIO}, {COUNT} px", file=sys.stderr, flush=True)

for line in sys.stdin:
    parts = line.split()
    if not parts:
        continue
    for i in range(min(COUNT, len(parts))):
        v = int(parts[i], 16)
        strip.setPixelColor(i, Color((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF))
    strip.show()
