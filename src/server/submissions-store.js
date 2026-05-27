// Guest-built drinks land here, separately from the canonical drinks catalog.
// Admin reviews them in the Submissions tab and either promotes them to the
// real catalog (via drinks-store.create) or discards them. Keeping the two
// stores apart lets guests freely build whatever without polluting what the
// machine offers by default.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "../slug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const SUBMISSIONS_PATH = resolve(STATE_DIR, "submissions.json");

let cache = null;

async function persist() {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    SUBMISSIONS_PATH,
    JSON.stringify({ submissions: cache, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

export async function load() {
  if (cache) return { submissions: cache };
  if (!existsSync(SUBMISSIONS_PATH)) {
    cache = [];
    await persist();
    return { submissions: cache };
  }
  try {
    const raw = await readFile(SUBMISSIONS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed.submissions) ? parsed.submissions : [];
    return { submissions: cache };
  } catch {
    cache = [];
    await persist();
    return { submissions: cache };
  }
}

// Re-read from disk after a backup restore.
export async function reloadFromDisk() {
  cache = null;
  await load();
}

function uniqueId(base) {
  if (!cache.some((s) => s.id === base)) return base;
  let n = 2;
  while (cache.some((s) => s.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// Trim down whatever the client sends to just the fields a guest can set.
// Category, glass, color, etc. stay un-set on the submission and get filled
// in when an admin promotes — keeps the build flow short and decisions about
// presentation in one place (the admin's edit-on-promote view).
function normalize(input) {
  if (!input || typeof input !== "object") throw new Error("payload required");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const safeName = name || "Custom drink";

  const rawIngredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  const ingredients = rawIngredients
    .filter((i) => i && typeof i.name === "string" && i.name)
    .map((i) => ({
      name: i.name,
      volumeOz: Number.isFinite(Number(i.volumeOz)) ? Math.max(0.1, Number(i.volumeOz)) : 0.5,
    }));
  if (ingredients.length === 0) throw new Error("at least one ingredient required");

  const id = uniqueId(slugify(safeName) || "custom-drink");
  return {
    id,
    name: safeName,
    ingredients,
    createdAt: new Date().toISOString(),
  };
}

export async function create(payload) {
  if (!cache) await load();
  const submission = normalize(payload);
  cache.push(submission);
  await persist();
  return submission;
}

export async function remove(id) {
  if (!cache) await load();
  const idx = cache.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error("not found");
  cache.splice(idx, 1);
  await persist();
  return { ok: true };
}

export async function get(id) {
  if (!cache) await load();
  return cache.find((s) => s.id === id) || null;
}
