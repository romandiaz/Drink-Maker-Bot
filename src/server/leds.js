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
// A second strip for the dispenser is chained after the bar on the same data
// line; BAR_COUNT + DISP_COUNT below size the two zones. The dispenser zone runs
// its own pour animation — a flow down the spout tinted with the color of the
// ingredient currently dispensing — and shares the done glitter and the error
// alarm with the bar. The bar stays green throughout: it's the progress
// indicator, and re-coloring it per step would make progress harder to read.
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
import { INGREDIENT_COLORS } from "../ingredient-defaults.js";

// Strip sizing lives here (version-controlled), not in systemd env — this is a
// single-purpose appliance, like SLOT_COUNT in inventory.js. The dispenser strip
// is chained after the bar on one data line, so the chain is one logical strip
// of BAR_COUNT + DISP_COUNT pixels; env vars override only for a different build.
const BAR_COUNT = process.env.LED_BAR_COUNT ? Number(process.env.LED_BAR_COUNT) : 60;
const DISP_COUNT = process.env.LED_DISP_COUNT ? Number(process.env.LED_DISP_COUNT) : 20;
const LED_COUNT = BAR_COUNT + DISP_COUNT;
// ~30fps: smooth enough for a progress bar and breathing, cheap enough to run
// alongside Chromium on a Pi 3B+ without stealing frames from the browser.
const FRAME_MS = 33;
// Crossfade length between modes, in frames, so a mode change eases in instead
// of hard-cutting. ~0.4s at the ~30fps frame rate.
const FADE_FRAMES = 12;
// Idle rotates through a few different looks so an untouched machine stays
// visually alive. Each holds for IDLE_VARIANT_FRAMES, then crossfades to the next.
const IDLE_VARIANTS = 3;
const IDLE_VARIANT_FRAMES = 420; // ~14s at ~30fps
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
const OFF = [0, 0, 0]; // dispenser zone when nothing is happening at the spout
const RED = [255, 0, 0]; // pure saturated red for the error alarm (no green/blue)
// Steady brightness the strip brightens to when a glass sits on the platform —
// well above the idle breathing peak so the "glass detected" jump is obvious.
const GLASS_BRIGHTNESS = 0.7;

let strip = null;
let mode = "idle";
let pourPct = 0;
// Ingredient currently dispensing, and the LED-normalized color it renders as.
// Tracked as a pair so we only re-resolve (and crossfade) when the step
// actually changes, not on every one of the pour's rapid progress updates.
let pourIngredient = null;
let pourColor = GREEN;
let frame = 0;
let loopTimer = null;
let errorTimer = null;
let selfTestActive = false;
// fadeElapsed starts "finished" so boot renders the live frame immediately.
let fadeElapsed = FADE_FRAMES;
let idleVariant = 0;
const pixels = new Array(LED_COUNT).fill(null).map(() => [0, 0, 0]);
// Crossfade buffers: `outFrame` is what actually goes to the strip; on a mode
// change we snapshot it into `fadeFrom` and blend from there into the new mode.
const outFrame = new Array(LED_COUNT).fill(null).map(() => [0, 0, 0]);
const fadeFrom = new Array(LED_COUNT).fill(null).map(() => [0, 0, 0]);
// Per-pixel glitter state for the "ready" celebration: each pixel holds a
// brightness that decays every frame and is re-ignited at random to full white,
// so the strip twinkles like glitter.
const sparkleLevel = new Float32Array(LED_COUNT);

export function getLedMode() {
  return mode;
}

// Drive the strip to a lifecycle state. Pouring carries a pct (0..1) and the
// id of the ingredient currently dispensing; every pouring update refreshes
// both even when we're already in pouring mode. Other modes are edge-triggered
// — re-entering the same mode is a no-op so the log stays quiet during a pour's
// rapid progress stream.
export function setLedMode(next, opts = {}) {
  if (next === "pouring") {
    pourPct = clamp01(opts.pct ?? pourPct);
    if ("ingredient" in opts && opts.ingredient !== pourIngredient) {
      pourIngredient = opts.ingredient;
      pourColor = ledColorFor(opts.ingredient);
      // Once per step, not per progress event — the guard above keeps this as
      // quiet as the mode log, and it's how a wrong-colored pour gets
      // diagnosed on the Pi without a second strip to compare against.
      console.log(`[leds] dispenser ${pourIngredient} -> rgb(${pourColor})`);
      // A step change (gin → vermouth) isn't a mode change, so the crossfade
      // below never fires for it — drive it from here instead, or the
      // dispenser would hard-cut between colors mid-pour.
      if (next === mode) startFade();
    }
  }
  if (next === mode) return;
  startFade();
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

// Snapshot the current output so tick() crossfades from it into whatever renders
// next — a mode change or an idle-variant flip — instead of hard-cutting.
function startFade() {
  for (let i = 0; i < LED_COUNT; i++) {
    const c = outFrame[i];
    fadeFrom[i] = [c[0], c[1], c[2]];
  }
  fadeElapsed = 0;
}

// While idle, rotate through the idle sub-animations on a timer, crossfading
// between them the same way a mode change does.
function maybeRotateIdle() {
  if (mode !== "idle") return;
  const v = Math.floor(frame / IDLE_VARIANT_FRAMES) % IDLE_VARIANTS;
  if (v !== idleVariant) {
    idleVariant = v;
    startFade();
  }
}

function tick() {
  frame++;
  maybeRotateIdle();
  renderMode();
  if (fadeElapsed < FADE_FRAMES) {
    // Crossfade from the pre-transition snapshot into the live new mode.
    fadeElapsed++;
    const t = ease(fadeElapsed / FADE_FRAMES);
    for (let i = 0; i < LED_COUNT; i++) {
      const a = fadeFrom[i];
      const b = pixels[i];
      outFrame[i] = [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
      ];
    }
  } else {
    // No fade running — mirror the target so the next transition has an
    // accurate frame to fade from.
    for (let i = 0; i < LED_COUNT; i++) outFrame[i] = pixels[i];
  }
  strip.render(outFrame);
}

// Three far-apart hues (red / green / blue) so a self-test run makes a wrong
// color order — the classic GRB-vs-RGB strip miswiring — obvious at a glance.
const SELF_TEST_INGREDIENTS = ["campari", "midori", "blue-curacao"];

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
      // Step through a few strongly-colored ingredients so the run also proves
      // the dispenser's per-ingredient tint and its crossfade, not just the bar.
      const i = Math.min(
        Math.floor(p * SELF_TEST_INGREDIENTS.length),
        SELF_TEST_INGREDIENTS.length - 1
      );
      setLedMode("pouring", { pct: p, ingredient: SELF_TEST_INGREDIENTS[i] });
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
    // Whole-chain effects — both zones share these.
    case "ready":
      return renderReady(); // glitter across bar + dispenser
    case "error":
      return renderError(); // red alarm across bar + dispenser
    // Per-zone: bar does its thing, dispenser flows or goes dark.
    case "pouring":
      renderPouringBar();
      renderDispenserPour();
      return;
    case "glass":
      renderGlass();
      clearDispenser();
      return;
    case "waiting":
      renderWaiting();
      clearDispenser();
      return;
    default:
      renderIdle();
      clearDispenser();
      return;
  }
}

function renderIdle() {
  // Empty platform: cycle through a few dim amber looks (see maybeRotateIdle).
  switch (idleVariant) {
    case 1:
      return renderIdleChase();
    case 2:
      return renderIdleScan();
    default:
      return renderIdleFlicker();
  }
}

function renderIdleFlicker() {
  // A quick, low-level flicker — a wide swing kept dim, from nearly off up to a
  // soft low glow, well under the steady glass-present level.
  const b = 0.02 + 0.26 * wave(0.13);
  fillBar(scale(AMBER, b));
}

function renderIdleChase() {
  // A soft amber comet drifting along the bar, wrapping around seamlessly.
  const head = (frame * 0.5) % BAR_COUNT;
  for (let i = 0; i < BAR_COUNT; i++) {
    let d = Math.abs(i - head);
    d = Math.min(d, BAR_COUNT - d); // wrap distance
    const b = 0.03 + 0.32 * Math.exp(-(d * d) / 18); // gaussian bump, sigma≈3
    pixels[i] = scale(AMBER, b);
  }
}

function renderIdleScan() {
  // A Larson-style scanner sweeping edge to edge across the bar.
  const head = (BAR_COUNT - 1) * (0.5 + 0.5 * Math.sin(frame * 0.05));
  for (let i = 0; i < BAR_COUNT; i++) {
    const d = Math.abs(i - head);
    const b = 0.02 + 0.3 * Math.exp(-(d * d) / 12.5); // sigma≈2.5
    pixels[i] = scale(AMBER, b);
  }
}

function renderGlass() {
  // A glass is on the platform: brighten from the breathing idle to a steady,
  // fuller amber so it reads as "noticed you — ready to pour".
  fillBar(scale(AMBER, GLASS_BRIGHTNESS));
}

function renderWaiting() {
  const b = 0.2 + 0.25 * wave(0.12);
  fillBar(scale(BLUE, b));
}

function renderPouringBar() {
  const filled = pourPct * BAR_COUNT;
  const full = Math.floor(filled);
  const frac = filled - full;
  for (let i = 0; i < BAR_COUNT; i++) {
    if (i > full) {
      pixels[i] = BAR_BG;
      continue;
    }
    // Chasing pulse: a brightness wave scrolls along the filled green toward the
    // leading edge, so the bar looks like it's actively flowing rather than a
    // static block. Stays green throughout (0.3..1.0), just brighter at the crest.
    let b = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(i * 0.35 - frame * 0.3));
    if (i === full) b *= frac; // partial leading pixel
    pixels[i] = scale(GREEN, b);
  }
}

function renderDispenserPour() {
  // The dispenser's own effect during a pour: pulses flowing down the strip
  // toward the spout, reading as liquid running, tinted with the ingredient
  // currently dispensing. Flip the sign of the frame term to reverse the
  // direction if the strip is mounted the other way.
  for (let k = 0; k < DISP_COUNT; k++) {
    const b = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(k * 0.6 - frame * 0.45));
    pixels[BAR_COUNT + k] = scale(pourColor, b);
  }
}

// Resolve an ingredient id to the color its pour renders as on the strip.
//
// The catalog palette is tuned for the kiosk's dark screen, which wants the
// opposite of what a strip wants: a screen shows dark liquids as dark pixels,
// but an LED can only emit light, so kahlua (#3A2418) or cola (#5A341F) would
// render as a pixel that's essentially off. We normalize instead — scale the
// color until its brightest channel hits full — which preserves hue and
// relative saturation while making every ingredient actually visible. Kahlua
// becomes a warm amber; genuinely clear spirits like gin and vodka stay
// near-white, which is honest. Per-pixel brightness is applied on top by the
// flow wave, exactly as it was for the old fixed green.
//
// Ingredients with no palette entry (admin-added, no color assigned) keep the
// original green rather than the catalog's neutral grey — grey renders as a
// murky off-white on a strip and reads as a fault, not a pour.
function ledColorFor(id) {
  const hex = INGREDIENT_COLORS[id];
  if (!hex) return GREEN;
  const n = parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return GREEN;
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const peak = Math.max(rgb[0], rgb[1], rgb[2]);
  if (peak === 0) return GREEN;
  return rgb.map((c) => Math.round((c * 255) / peak));
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

// Smoothstep easing for crossfades — eases in and out, no linear hard edges.
function ease(t) {
  return t * t * (3 - 2 * t);
}

function scale([r, g, b], k) {
  return [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
}

function fill(rgb) {
  for (let i = 0; i < LED_COUNT; i++) pixels[i] = rgb;
}

// Bar zone = [0, BAR_COUNT); dispenser zone = [BAR_COUNT, LED_COUNT).
function fillBar(rgb) {
  for (let i = 0; i < BAR_COUNT; i++) pixels[i] = rgb;
}

function clearDispenser() {
  for (let i = BAR_COUNT; i < LED_COUNT; i++) pixels[i] = OFF;
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
