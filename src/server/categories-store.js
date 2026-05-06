// Persisted overrides for the static category list. Categories themselves
// are hardcoded in src/drinks.js; this file just tracks which ones the admin
// has hidden from the main UI. Storing only IDs (not the full category
// records) means a category rename in code doesn't require a migration here.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const CATEGORIES_PATH = resolve(STATE_DIR, "categories.json");

let cache = null;

async function persist() {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(CATEGORIES_PATH, JSON.stringify(cache, null, 2), "utf8");
}

export async function load() {
  if (cache) return cache;
  if (!existsSync(CATEGORIES_PATH)) {
    cache = { disabledIds: [] };
    await persist();
    return cache;
  }
  try {
    const raw = await readFile(CATEGORIES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = {
      disabledIds: Array.isArray(parsed.disabledIds)
        ? parsed.disabledIds.filter((s) => typeof s === "string")
        : [],
    };
    return cache;
  } catch {
    cache = { disabledIds: [] };
    await persist();
    return cache;
  }
}

export async function save(input) {
  if (!cache) await load();
  const ids = Array.isArray(input?.disabledIds)
    ? input.disabledIds.filter((s) => typeof s === "string")
    : [];
  cache = { disabledIds: [...new Set(ids)] };
  await persist();
  return cache;
}
