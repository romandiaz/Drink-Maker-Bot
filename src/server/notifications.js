// Append-only log of toasts shown anywhere in the UI. Captures errors
// (pour failures, save errors) plus success/info status messages
// ("History cleared") so the admin Notifications tab can replay what a
// guest saw and dismissed before the kiosk owner could read it.
//
// Storage mirrors pour-history: JSON file under server/state/, capped at
// MAX_ENTRIES rolling so it can't grow without bound across long uptimes.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const NOTIFICATIONS_PATH = resolve(STATE_DIR, "notifications.json");

const MAX_ENTRIES = 200;

let cache = null;

async function load() {
  if (cache) return cache;
  if (!existsSync(NOTIFICATIONS_PATH)) {
    cache = { entries: [] };
    return cache;
  }
  try {
    const raw = await readFile(NOTIFICATIONS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
    return cache;
  } catch {
    cache = { entries: [] };
    return cache;
  }
}

async function persist() {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(NOTIFICATIONS_PATH, JSON.stringify(cache, null, 2), "utf8");
}

// Re-read from disk after a backup restore.
export async function reloadFromDisk() {
  cache = null;
  await load();
}

export async function record({ message, variant }) {
  if (!message) return;
  const data = await load();
  data.entries.push({
    message: String(message),
    // Anything not explicitly success/info is treated as an error so a
    // caller that forgets the variant fails loud rather than silent.
    variant: variant === "info" || variant === "success" ? variant : "error",
    ts: new Date().toISOString(),
  });
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }
  await persist();
}

// Newest-first list for the Notifications admin tab. Same convention as
// pour-history.list().
export async function list() {
  const data = await load();
  return { entries: [...data.entries].reverse() };
}

export async function clear() {
  cache = { entries: [] };
  await persist();
  return { ok: true, entries: [] };
}
