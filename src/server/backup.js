// Whole-state backup: bundles every JSON file under state/ into one document
// for download, and restores them from such a bundle. Restore overwrites the
// state files, then reloads every store's in-memory cache so the running
// server reflects the new data without a restart.
//
// Backups are also kept on the Pi itself, under backups/ (a sibling of state/,
// never inside it — a backup that landed in state/ would get re-bundled into
// the next backup). The admin Maintenance tab browses, restores, and deletes
// these on-device copies.

import { readFile, writeFile, readdir, mkdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as drinksStore from "./drinks-store.js";
import * as categoriesStore from "./categories-store.js";
import * as submissionsStore from "./submissions-store.js";
import * as inventory from "./inventory.js";
import * as ingredientsStore from "./ingredients-store.js";
import * as calibration from "./calibration.js";
import * as pourHistory from "./pour-history.js";
import * as notifications from "./notifications.js";
import * as adminPin from "./admin-pin.js";
import * as cleaningStore from "./cleaning-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const BACKUPS_DIR = resolve(__dirname, "backups");

// Every persisted store — restore reloads each one's cache from disk.
const STORES = [
  drinksStore, categoriesStore, submissionsStore, inventory,
  ingredientsStore, calibration, pourHistory, notifications, adminPin,
  cleaningStore,
];

const BUNDLE_KIND = "bartender-kiosk-backup";
// State filenames are plain lowercase slugs — this both filters the backup
// and blocks path traversal on restore.
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*\.json$/;

// Read every state JSON file into one bundle object.
export async function createBackup() {
  const files = {};
  if (existsSync(STATE_DIR)) {
    for (const name of await readdir(STATE_DIR)) {
      if (!SAFE_NAME.test(name)) continue;
      try {
        files[name] = JSON.parse(await readFile(resolve(STATE_DIR, name), "utf8"));
      } catch {
        // Skip a corrupt file rather than failing the whole backup.
      }
    }
  }
  return {
    kind: BUNDLE_KIND,
    version: 1,
    createdAt: new Date().toISOString(),
    files,
  };
}

// Overwrite the state files from a bundle. Every filename is validated before
// anything is written, so a bad entry aborts the whole restore rather than
// leaving a half-applied state. Returns the number of files written.
export async function restoreBackup(bundle) {
  if (!bundle || typeof bundle !== "object" || bundle.kind !== BUNDLE_KIND) {
    throw new Error("not a bartender backup file");
  }
  const files = bundle.files;
  if (!files || typeof files !== "object") {
    throw new Error("backup contains no files");
  }
  const entries = Object.entries(files);
  if (entries.length === 0) throw new Error("backup is empty");

  for (const [name] of entries) {
    if (basename(name) !== name || !SAFE_NAME.test(name)) {
      throw new Error(`unsafe filename in backup: ${name}`);
    }
  }
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  for (const [name, content] of entries) {
    await writeFile(
      resolve(STATE_DIR, name),
      JSON.stringify(content, null, 2),
      "utf8"
    );
  }
  // Re-read every store from disk so the running server reflects the restored
  // files immediately — no restart needed.
  await Promise.all(STORES.map((s) => s.reloadFromDisk()));
  return entries.length;
}

// --- On-device backup files ---
// Backups kept on the Pi so there's a recovery point even with no laptop on
// hand. The same SAFE_NAME slug rule that filters state/ also names these and
// guards restore/delete against path traversal.

// backup-<date>-<time>.json — a lower-case slug so it passes SAFE_NAME when
// it's read back in. e.g. backup-2026-05-19-143052.json
function backupFilename(createdAt) {
  const stamp = new Date(createdAt)
    .toISOString()
    .slice(0, 19)
    .replace("T", "-")
    .replace(/:/g, "");
  return `backup-${stamp}.json`;
}

// Write a bundle into the on-device backups folder. Returns the file's name
// and byte size so the caller can report what landed.
export async function saveBackupFile(bundle) {
  if (!existsSync(BACKUPS_DIR)) await mkdir(BACKUPS_DIR, { recursive: true });
  const name = backupFilename(bundle.createdAt);
  const json = JSON.stringify(bundle, null, 2);
  await writeFile(resolve(BACKUPS_DIR, name), json, "utf8");
  return { name, size: Buffer.byteLength(json, "utf8") };
}

// Every backup file on the Pi, newest first. Date/size come from the file
// stat — cheaper than parsing every bundle just to list them.
export async function listBackups() {
  if (!existsSync(BACKUPS_DIR)) return [];
  const out = [];
  for (const name of await readdir(BACKUPS_DIR)) {
    if (!SAFE_NAME.test(name)) continue;
    try {
      const info = await stat(resolve(BACKUPS_DIR, name));
      if (info.isFile()) {
        out.push({ name, size: info.size, savedAt: info.mtime.toISOString() });
      }
    } catch {
      // Vanished between readdir and stat — skip it.
    }
  }
  out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return out;
}

// Validate an admin-supplied backup name before it touches the filesystem.
// Same guard restoreBackup uses on bundle entries — no path separators, plain
// lower-case slug only.
function backupPath(name) {
  if (basename(name) !== name || !SAFE_NAME.test(name)) {
    throw new Error("invalid backup name");
  }
  return resolve(BACKUPS_DIR, name);
}

// Read and parse one on-device backup. restoreBackup re-checks the shape.
export async function readBackup(name) {
  const path = backupPath(name);
  if (!existsSync(path)) throw new Error("backup not found");
  return JSON.parse(await readFile(path, "utf8"));
}

// Delete one on-device backup.
export async function deleteBackup(name) {
  const path = backupPath(name);
  if (!existsSync(path)) throw new Error("backup not found");
  await unlink(path);
}
