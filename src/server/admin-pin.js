// Admin PIN gate. Persisted plaintext in state/admin-pin.json — this is a home
// kiosk, not a hardened system; physical access is the real boundary. Storing
// it plain lets the user edit the file by hand to change the PIN until an
// in-app Settings tile lands.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const PIN_PATH = resolve(STATE_DIR, "admin-pin.json");

const DEFAULT_PIN = "1234";
const PIN_RE = /^\d{4,8}$/;

let cache = null;

async function persist(data) {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(PIN_PATH, JSON.stringify(data, null, 2), "utf8");
}

async function load() {
  if (cache) return cache;
  if (!existsSync(PIN_PATH)) {
    cache = { pin: DEFAULT_PIN, updatedAt: new Date().toISOString() };
    await persist(cache);
    return cache;
  }
  try {
    const parsed = JSON.parse(await readFile(PIN_PATH, "utf8"));
    if (typeof parsed.pin !== "string" || !PIN_RE.test(parsed.pin)) {
      throw new Error("invalid pin file");
    }
    cache = parsed;
    return cache;
  } catch {
    cache = { pin: DEFAULT_PIN, updatedAt: new Date().toISOString() };
    await persist(cache);
    return cache;
  }
}

export async function verifyPin(submitted) {
  const data = await load();
  return typeof submitted === "string" && submitted === data.pin;
}
