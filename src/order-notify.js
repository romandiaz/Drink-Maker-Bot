// Light foreground "your drink is ready" alerts for the mobile order page.
// No HTTPS or push infra required — relies on what the page can do while it
// stays open: a short generated tone, a tab-title flip, the Notification API
// when granted, and a Wake Lock so the phone screen doesn't sleep while a
// drink is queued. AP mode has no internet, so real Web Push is off the table.

let audioCtx = null;
let armed = false;
let originalTitle = null;
let titleRestoreBound = false;
let wakeLock = null;
let wakeLockWanted = false;

// Unlock the audio context inside a real user gesture. iOS Safari only lets
// AudioContext start from synchronous code inside a touch/click handler, so
// the caller must invoke this from the gesture itself — not from anything
// awaited. Idempotent.
export function unlockAudio() {
  if (armed) return;
  armed = true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    audioCtx = new Ctx();
    // A 1-sample silent buffer flips iOS's audio context from "suspended" to
    // "running" inside the gesture, so later .start() calls outside a gesture
    // still produce sound.
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch {
    audioCtx = null;
  }
}

// Prompt for OS-level notifications. Call after the user has committed to
// caring (e.g. just placed an order) — asking on page load is rude and gets
// auto-denied by some browsers. Permission state is sticky across visits.
export function requestNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "default") return;
  Notification.requestPermission().catch(() => {});
}

function playDing() {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    const now = audioCtx.currentTime;
    // Two-tone ding (high → low) ~500ms total. Sine waves with quick
    // attack / exponential decay so it reads as a chime, not a beep.
    const tones = [{ f: 988, t: 0 }, { f: 740, t: 0.16 }];
    for (const { f, t } of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      osc.connect(gain).connect(audioCtx.destination);
      gain.gain.setValueAtTime(0, now + t);
      gain.gain.linearRampToValueAtTime(0.25, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.35);
      osc.start(now + t);
      osc.stop(now + t + 0.4);
    }
  } catch {}
}

function flashTitle(drinkName) {
  if (originalTitle == null) originalTitle = document.title;
  document.title = `Drink ready — ${drinkName}`;
  if (!titleRestoreBound) {
    titleRestoreBound = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && originalTitle != null) {
        document.title = originalTitle;
        originalTitle = null;
      }
    });
  }
}

function fireNotification(drinkName) {
  // Only fire when the page is backgrounded — if they're already looking, the
  // sound + on-page banner do the job and a system notification is noise.
  if (!document.hidden) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification("Drink ready", {
      body: drinkName,
      tag: "drinkbot-ready",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {}
}

export function notifyDrinkReady(drinkName) {
  playDing();
  flashTitle(drinkName);
  fireNotification(drinkName);
}

async function acquireWakeLock() {
  if (!wakeLockWanted || wakeLock || !navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    // Denied or document hidden — visibilitychange below will retry.
  }
}

// Re-acquire on tab return: the browser auto-releases the lock when the page
// hides, so we have to re-request when it comes back into the foreground.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) acquireWakeLock();
});

// Toggle whether we want the screen kept awake. Callers flip this whenever
// the "do I have skin in the queue?" answer changes.
export function wantWakeLock(want) {
  wakeLockWanted = !!want;
  if (wakeLockWanted) {
    acquireWakeLock();
  } else if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
