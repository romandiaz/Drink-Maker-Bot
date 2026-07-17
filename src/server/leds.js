// Addressable RGB strip driver. Renders the machine's pour lifecycle onto a
// WS2812B strip wired to the Raspberry Pi's GPIO:
//
//   idle     slow amber breathing (attract)
//   waiting  soft blue pulse while we wait for a glass on the platform
//   pouring  a green progress bar that fills to the pour's pct
//   ready    rainbow celebration, HELD until the finished drink is lifted off
//   error    red pulse (auto-clears back to idle after ERROR_HOLD_MS)
//
// Mock-first, mirroring pour.js/mockPour: with LED_STRIP unset (laptop dev, or
// a Pi before the strip is wired) the SAME animation state machine runs but
// "renders" to a no-op sink instead of pushing pixels. Set LED_STRIP=ws2812 on
// the Pi to drive real hardware (see realStrip() for the required setup). If the
// native binding is missing or fails to init, we fall back to the mock sink so
// the backend still boots and pours still work — LEDs are non-essential.
//
// The Arduino has no free pins for the strip (all 16 relay channels + the HX711
// consume every usable GPIO), so the strip is driven from the Pi directly. This
// module owns it end to end; nothing in the firmware or serial protocol changes.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const LED_COUNT = process.env.LED_COUNT ? Number(process.env.LED_COUNT) : 60;
// ~30fps: smooth enough for a progress bar and breathing, cheap enough to run
// alongside Chromium on a Pi 3B+ without stealing frames from the browser.
const FRAME_MS = 33;
// An error pulse with no follow-up event (e.g. a pour that failed and left the
// queue empty) shouldn't glow red forever — revert to idle on its own.
const ERROR_HOLD_MS = 8000;

// Palette. LEDs aren't bound by the UI's "flat, no gradients" rule — that's a
// screen-design constraint. Values loosely track the CSS design tokens so the
// physical light and the on-screen accent read as the same machine.
const AMBER = [212, 165, 116]; // --accent-classics
const BLUE = [80, 140, 255];
const GREEN = [74, 222, 128]; // --status-ready
const BAR_BG = [6, 20, 12]; // dim rail behind the progress fill
const RED = [239, 68, 68];

let strip = null;
let mode = "idle";
let pourPct = 0;
let frame = 0;
let loopTimer = null;
let errorTimer = null;
let selfTestActive = false;
const pixels = new Array(LED_COUNT).fill(null).map(() => [0, 0, 0]);

export function getLedMode() {
  return mode;
}

// Drive the strip to a lifecycle state. Pouring carries a pct (0..1); every
// pouring update refreshes it even when we're already in pouring mode. Other
// modes are edge-triggered — re-entering the same mode is a no-op so the log
// stays quiet during a pour's rapid progress stream.
export function setLedMode(next, opts = {}) {
  if (next === "pouring") pourPct = clamp01(opts.pct ?? pourPct);
  if (next === mode) return;
  mode = next;
  console.log(`[leds] -> ${mode}`);

  if (errorTimer) {
    clearTimeout(errorTimer);
    errorTimer = null;
  }
  if (mode === "error") {
    errorTimer = setTimeout(() => setLedMode("idle"), ERROR_HOLD_MS);
  }
}

export function initLeds() {
  if (loopTimer) return;
  strip = createStrip();
  loopTimer = setInterval(tick, FRAME_MS);
  // Don't hold the process open just for the animation — let it exit when the
  // rest of the server does.
  if (loopTimer.unref) loopTimer.unref();
}

function tick() {
  frame++;
  renderMode();
  strip.render(pixels);
}

// Admin bring-up aid: play every animation mode once, then return to idle.
// It drives the same state machine the pour lifecycle uses, so a clean run on
// real hardware confirms wiring, power, and the render path end to end. Harmless
// on the mock sink (it just logs the transitions). Guarded against re-entry.
export async function runLedSelfTest() {
  if (selfTestActive) return { ok: false, reason: "already-running" };
  selfTestActive = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    setLedMode("waiting");
    await sleep(1200);
    for (let p = 0; p <= 1; p += 0.05) {
      setLedMode("pouring", { pct: p });
      await sleep(90);
    }
    setLedMode("ready");
    await sleep(2500);
    setLedMode("error");
    await sleep(1500);
    return { ok: true };
  } finally {
    // Also clears the error mode's pending auto-revert timer (setLedMode does).
    setLedMode("idle");
    selfTestActive = false;
  }
}

function renderMode() {
  switch (mode) {
    case "pouring":
      return renderPouring();
    case "waiting":
      return renderWaiting();
    case "ready":
      return renderReady();
    case "error":
      return renderError();
    default:
      return renderIdle();
  }
}

function renderIdle() {
  // Gentle breathing between 15% and 30% brightness — present but not loud.
  const b = 0.15 + 0.15 * wave(0.05);
  fill(scale(AMBER, b));
}

function renderWaiting() {
  const b = 0.2 + 0.25 * wave(0.12);
  fill(scale(BLUE, b));
}

function renderPouring() {
  const filled = pourPct * LED_COUNT;
  const full = Math.floor(filled);
  const frac = filled - full;
  // Breathe the leading edge so a bar that pauses (waiting on a slow pump)
  // still looks alive rather than frozen.
  const pulse = 0.75 + 0.25 * wave(0.25);
  for (let i = 0; i < LED_COUNT; i++) {
    if (i < full) pixels[i] = GREEN;
    else if (i === full) pixels[i] = scale(GREEN, frac * pulse);
    else pixels[i] = BAR_BG;
  }
}

function renderReady() {
  // Rainbow that drifts along the strip — unmistakably "done, take your drink".
  for (let i = 0; i < LED_COUNT; i++) {
    const hue = (i / LED_COUNT + frame * 0.01) % 1;
    pixels[i] = hsv(hue, 0.9, 1);
  }
}

function renderError() {
  const b = 0.25 + 0.55 * wave(0.3);
  fill(scale(RED, b));
}

// --- pixel helpers ---------------------------------------------------------

// 0..1 triangle-ish sine, phase driven by the frame counter.
function wave(speed) {
  return 0.5 + 0.5 * Math.sin(frame * speed);
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function scale([r, g, b], k) {
  return [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
}

function fill(rgb) {
  for (let i = 0; i < LED_COUNT; i++) pixels[i] = rgb;
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: [r, g, b] = [v, t, p]; break;
    case 1: [r, g, b] = [q, v, p]; break;
    case 2: [r, g, b] = [p, v, t]; break;
    case 3: [r, g, b] = [p, q, v]; break;
    case 4: [r, g, b] = [t, p, v]; break;
    default: [r, g, b] = [v, p, q];
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// --- render targets --------------------------------------------------------

function createStrip() {
  if (!process.env.LED_STRIP) return mockStrip();
  try {
    return realStrip();
  } catch (err) {
    console.error(`[leds] hardware init failed (${err.message}); using mock`);
    return mockStrip();
  }
}

// No-op sink for dev and for a Pi before the strip is physically wired. The
// animation loop still runs and setLedMode still logs transitions, so you can
// watch the state machine without any hardware attached.
function mockStrip() {
  console.log(`[leds] mock strip (${LED_COUNT} px) — set LED_STRIP=ws2812 for hardware`);
  return { render() {} };
}

// Real WS2812B/SK6812 output via the rpi-ws281x native binding (DMA-driven,
// so timing is solid even under Chromium load). Requires, on the Pi:
//   npm install rpi-ws281x-v2
//   data pin on GPIO21 (PCM, physical pin 40) — using the PCM peripheral
//     instead of PWM leaves the Pi's onboard audio free; a 5V level shifter
//     is recommended (or try 3.3V direct — see docs/led-wiring.html)
//   the backend must run as root (or with the right cap) — the binding uses
//     /dev/mem for DMA. adjust bartender-kiosk.service accordingly.
// If your binding's API differs, this is the only function to adjust; a throw
// here just drops us back to the mock sink.
function realStrip() {
  const ws281x = require("rpi-ws281x-v2");
  ws281x.configure({
    leds: LED_COUNT,
    gpio: Number(process.env.LED_GPIO) || 21,
    brightness: Number(process.env.LED_BRIGHTNESS) || 128,
    stripType: "ws2812",
  });
  const buf = new Uint32Array(LED_COUNT);
  return {
    render(px) {
      for (let i = 0; i < LED_COUNT; i++) {
        const [r, g, b] = px[i];
        buf[i] = (r << 16) | (g << 8) | b;
      }
      ws281x.render(buf);
    },
  };
}
