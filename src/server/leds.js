// Addressable RGB strip driver. Renders the machine's pour lifecycle onto a
// WS2812B strip wired to the Raspberry Pi's GPIO:
//
//   idle     subtle amber breathing — empty platform (attract)
//   glass    steady bright amber — a glass is on the platform, ready to pour
//   waiting  soft blue pulse while a pour waits for a glass to be placed
//   pouring  a green progress bar that fills to the pour's pct
//   ready    glittery random flashing — done, HELD until the drink is lifted off
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

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LED_COUNT = process.env.LED_COUNT ? Number(process.env.LED_COUNT) : 60;
// ~30fps: smooth enough for a progress bar and breathing, cheap enough to run
// alongside Chromium on a Pi 3B+ without stealing frames from the browser.
const FRAME_MS = 33;
// An error pulse with no follow-up event (e.g. a pour that failed and left the
// queue empty) shouldn't glow red forever — revert to idle on its own.
const ERROR_HOLD_MS = 8000;
// The physical strip is driven by a small Python helper (rpi_ws281x) that this
// module spawns and streams frames to — see realStrip() and led-helper.py.
const HELPER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "led-helper.py");

// Palette. LEDs aren't bound by the UI's "flat, no gradients" rule — that's a
// screen-design constraint. Values loosely track the CSS design tokens so the
// physical light and the on-screen accent read as the same machine.
const AMBER = [212, 165, 116]; // --accent-classics
const BLUE = [80, 140, 255];
const GREEN = [20, 235, 45]; // punchy green; the UI's mint --status-ready reads washed-out on the strip
const BAR_BG = [6, 20, 12]; // dim rail behind the progress fill
const RED = [239, 68, 68];
// Steady brightness the strip brightens to when a glass sits on the platform —
// well above the idle breathing peak so the "glass detected" jump is obvious.
const GLASS_BRIGHTNESS = 0.7;

let strip = null;
let mode = "idle";
let pourPct = 0;
let frame = 0;
let loopTimer = null;
let errorTimer = null;
let selfTestActive = false;
const pixels = new Array(LED_COUNT).fill(null).map(() => [0, 0, 0]);
// Per-pixel glitter state for the "ready" celebration: each pixel holds a
// brightness that decays every frame and is re-ignited at random to full white,
// so the strip twinkles like glitter.
const sparkleLevel = new Float32Array(LED_COUNT);

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
    setLedMode("glass");
    await sleep(1500);
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
    case "glass":
      return renderGlass();
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
  // A deep, dramatic breath on an empty platform — swings from nearly off up to
  // a strong glow and back. Still peaks below the steady glass-present level, so
  // placing a glass reads as "settling to a bright hold".
  const b = 0.04 + 0.46 * wave(0.04);
  fill(scale(AMBER, b));
}

function renderGlass() {
  // A glass is on the platform: brighten from the breathing idle to a steady,
  // fuller amber so it reads as "noticed you — ready to pour".
  fill(scale(AMBER, GLASS_BRIGHTNESS));
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
  // Glittery white flashing — the drink is done. Every frame each pixel dims,
  // and a few random pixels re-ignite to full white, so the strip twinkles like
  // glitter. Held until the finished drink is lifted off.
  for (let i = 0; i < LED_COUNT; i++) sparkleLevel[i] *= 0.82;
  for (let n = 0; n < 3; n++) sparkleLevel[(Math.random() * LED_COUNT) | 0] = 1;
  for (let i = 0; i < LED_COUNT; i++) {
    const v = Math.round(sparkleLevel[i] * 255);
    pixels[i] = [v, v, v];
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

// Real WS2812B/SK6812 output. The Node-native bindings for this chip are
// unmaintained and no longer compile against modern Node/V8, so we drive the
// strip through a small Python helper (led-helper.py) built on the maintained
// rpi_ws281x library. This module stays the single source of animation:
// realStrip() spawns the helper once and streams it one frame per line
// (LED_COUNT hex RRGGBB triplets); the helper is a dumb sink.
//
// The backend runs as root on the Pi (rpi_ws281x needs /dev/mem for DMA), so
// the child inherits root. Data pin defaults to GPIO21 (PCM, physical pin 40),
// which leaves the Pi's onboard audio free; override with LED_GPIO. If the
// helper can't start (Python or the lib missing), it exits and we simply stop
// pushing pixels — the rest of the kiosk is unaffected. Set LED_PYTHON to point
// at a specific interpreter (e.g. a venv) if the default python3 lacks the lib.
function realStrip() {
  const python = process.env.LED_PYTHON || "python3";
  const gpio = Number(process.env.LED_GPIO) || 21;
  const brightness = Number(process.env.LED_BRIGHTNESS) || 128;
  const child = spawn(python, [HELPER], {
    stdio: ["pipe", "inherit", "inherit"],
    env: {
      ...process.env,
      LED_COUNT: String(LED_COUNT),
      LED_GPIO: String(gpio),
      LED_BRIGHTNESS: String(brightness),
    },
  });

  let alive = true;
  child.on("error", (err) => {
    alive = false;
    console.error(`[leds] helper failed to start (${err.message}); LEDs off`);
  });
  child.on("exit", (code) => {
    alive = false;
    console.error(`[leds] helper exited (code ${code}); LEDs off`);
  });
  // A backpressured/broken pipe must not crash the backend with EPIPE.
  child.stdin.on("error", () => {});
  // Don't leave an orphaned helper holding the strip when the backend exits
  // (the in-app restart button exits node cleanly, then run-server.sh respawns
  // it — without this, two helpers would fight the same GPIO).
  const cleanup = () => {
    try {
      child.kill();
    } catch {}
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => { cleanup(); process.exit(130); });
  process.once("SIGTERM", () => { cleanup(); process.exit(143); });

  return {
    render(px) {
      if (!alive) return;
      let line = "";
      for (let i = 0; i < LED_COUNT; i++) {
        const [r, g, b] = px[i];
        line += ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
        if (i < LED_COUNT - 1) line += " ";
      }
      child.stdin.write(line + "\n");
    },
  };
}
