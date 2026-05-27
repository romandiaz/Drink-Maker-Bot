// Whole-state backup: download a bundle (also kept on the Pi), list/restore/
// delete on-device snapshots, and restore an uploaded bundle.
import { readJsonBody, jsonRoute } from "../http-util.js";
import {
  createBackup,
  restoreBackup,
  saveBackupFile,
  listBackups,
  readBackup,
  deleteBackup,
} from "../backup.js";

export async function backupRoutes(req, res, urlPath) {
  // Whole-state backup download. Content-Disposition makes the browser save
  // it rather than render it. Export also keeps a copy on the Pi; the saved
  // filename rides back in X-Backup-Saved so the client can report honestly
  // whether the on-device copy landed, without coupling it to the download.
  if (urlPath === "/api/backup" && req.method === "GET") {
    const bundle = await createBackup();
    const date = new Date().toISOString().slice(0, 10);
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bartender-backup-${date}.json"`,
      "Cache-Control": "no-store",
    };
    try {
      const saved = await saveBackupFile(bundle);
      headers["X-Backup-Saved"] = saved.name;
    } catch (e) {
      // A failed disk save (full/read-only SD card) shouldn't cost the user
      // their download — log it and let the absent header speak.
      console.error("on-device backup save failed:", e);
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(bundle, null, 2));
    return true;
  }

  // Backups stored on the Pi: list, restore-from, and delete.
  if (urlPath === "/api/backups" && req.method === "GET") {
    await jsonRoute(res, () => listBackups());
    return true;
  }
  const backupRestoreMatch = urlPath.match(/^\/api\/backups\/([^/]+)\/restore$/);
  if (backupRestoreMatch && req.method === "POST") {
    // Read the bundle straight off disk — no need to ship it to the client
    // and back. restoreBackup reloads every store's cache, so the running
    // server reflects the restore without a restart.
    await jsonRoute(res, async () => {
      const bundle = await readBackup(backupRestoreMatch[1]);
      const count = await restoreBackup(bundle);
      return { ok: true, files: count };
    });
    return true;
  }
  const backupMatch = urlPath.match(/^\/api\/backups\/([^/]+)$/);
  if (backupMatch && req.method === "DELETE") {
    await jsonRoute(res, async () => {
      await deleteBackup(backupMatch[1]);
      return { ok: true };
    });
    return true;
  }

  if (urlPath === "/api/restore" && req.method === "POST") {
    // The bundle carries every state file (pour history alone can be tens
    // of KB) — well past readJsonBody's default cap. restoreBackup writes the
    // files and reloads every store's cache, so the running server reflects
    // the restore without a restart.
    await jsonRoute(res, async () => {
      const body = await readJsonBody(req, 8 * 1024 * 1024);
      const count = await restoreBackup(body);
      return { ok: true, files: count };
    });
    return true;
  }

  return false;
}
