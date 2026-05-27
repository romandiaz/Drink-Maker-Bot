// Backup & restore section of the maintenance view. Owns its own `backups`
// list (the on-device snapshots) and renders two cards: export / restore-from-
// file, and the list of snapshots saved on the Pi.
//
// createBackupSection returns { load, renderExport, renderSaved }. The view
// calls load() once after its own data lands, and calls the render* helpers
// from its full render(). A change here (list loaded, backup deleted) asks the
// view to re-render via onChange.

import { getJSON, postJSON, delJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { sectionHead, actionBtn } from "../components/maint-ui.js";

function formatBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// A saved backup's timestamp, always absolute — a backup list is read most
// usefully as "which dated snapshot do I want", not "how long ago".
function formatBackupDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

// Two-tap confirm for a destructive button. First tap arms it (label + style
// change, 6s timeout to disarm); a second tap inside the window commits.
function makeArmable(btn, idleLabel, armedLabel, onConfirm) {
  let timer = null;
  function disarm() {
    if (timer) { clearTimeout(timer); timer = null; }
    btn.textContent = idleLabel;
    btn.classList.remove("is-armed");
  }
  btn.addEventListener("click", () => {
    if (timer) { disarm(); onConfirm(); return; }
    btn.textContent = armedLabel;
    btn.classList.add("is-armed");
    timer = setTimeout(disarm, 6000);
  });
}

export function createBackupSection({ isLocked, setBusy, onChange }) {
  let backups = null; // on-device backup files; null until first fetch

  async function load() {
    try {
      backups = await getJSON("/api/backups");
    } catch (e) {
      console.error(e);
      backups = [];
    }
    onChange();
  }

  // Restore + page-reload, shared by file-restore and named-restore. On
  // success the page reloads (so setBusy isn't cleared); on failure we surface
  // the error and re-enable the controls.
  async function restoreAndReload(doPost) {
    setBusy(true);
    try {
      await doPost();
      showToast("Backup restored — reloading…", {
        variant: "success",
        duration: 2500,
      });
      // The server stayed up and already reloaded its state; reload the page so
      // this tablet's own caches (drinks, categories) refresh too.
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      console.error(e);
      showToast(`Restore failed — ${e.message}`);
      setBusy(false);
    }
  }

  async function doRestoreNamed(name) {
    if (isLocked()) {
      showToast("Machine busy — try again in a moment");
      return;
    }
    await restoreAndReload(() =>
      postJSON(`/api/backups/${encodeURIComponent(name)}/restore`, {})
    );
  }

  async function doDelete(name) {
    try {
      await delJSON(`/api/backups/${encodeURIComponent(name)}`);
      backups = backups.filter((b) => b.name !== name);
      showToast("Backup deleted", { variant: "success", duration: 2000 });
      onChange();
    } catch (e) {
      console.error(e);
      showToast(`Delete failed — ${e.message}`);
    }
  }

  function renderExport() {
    const card = document.createElement("section");
    card.className = "maint-card";
    card.appendChild(
      sectionHead(
        "Backup & restore",
        "Save or restore all recipes, inventory, calibration and settings"
      )
    );

    const buttons = document.createElement("div");
    buttons.className = "maint-quick";

    const exportBtn = actionBtn("Export backup");
    // Read-only — safe to run even mid-pour, so exempt from the busy lock.
    exportBtn.dataset.alwaysEnabled = "1";
    exportBtn.addEventListener("click", async () => {
      // Fetch (rather than a plain <a> navigation) so we can both trigger the
      // download from the blob AND learn — via X-Backup-Saved — whether the
      // server's on-device copy landed, then refresh the saved list.
      exportBtn.disabled = true;
      try {
        const res = await fetch("/api/backup");
        if (!res.ok) throw new Error(`server ${res.status}`);
        const savedName = res.headers.get("X-Backup-Saved");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `bartender-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        if (savedName) {
          showToast("Backup downloaded & saved on the Pi", {
            variant: "success",
            duration: 2800,
          });
        } else {
          showToast("Backup downloaded — couldn't save a copy on the Pi");
        }
        await load();
      } catch (e) {
        console.error(e);
        showToast(`Export failed — ${e.message}`);
      } finally {
        exportBtn.disabled = false;
      }
    });
    buttons.appendChild(exportBtn);

    const restoreBtn = actionBtn("Restore from backup", { tone: "warn" });
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";

    let pendingBundle = null;
    let armTimer = null;
    function disarm() {
      pendingBundle = null;
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
      restoreBtn.textContent = "Restore from backup";
    }

    restoreBtn.addEventListener("click", () => {
      // Second tap on an armed button commits; first tap opens the picker.
      if (pendingBundle) {
        doRestore(pendingBundle);
        return;
      }
      fileInput.value = "";
      fileInput.click();
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let bundle;
        try {
          bundle = JSON.parse(reader.result);
        } catch {
          showToast("Couldn't read that file — not valid JSON");
          return;
        }
        if (!bundle || bundle.kind !== "bartender-kiosk-backup") {
          showToast("That's not a bartender backup file");
          return;
        }
        // Arm the destructive confirm — a second tap within 6s commits.
        pendingBundle = bundle;
        restoreBtn.textContent = "Overwrite all data — tap to confirm";
        if (armTimer) clearTimeout(armTimer);
        armTimer = setTimeout(disarm, 6000);
      };
      reader.onerror = () => showToast("Couldn't read that file");
      reader.readAsText(file);
    });

    function doRestore(bundle) {
      disarm();
      restoreAndReload(() => postJSON("/api/restore", bundle));
    }

    buttons.append(restoreBtn, fileInput);
    card.appendChild(buttons);

    const note = document.createElement("p");
    note.className = "maint-note";
    note.textContent =
      "Export bundles every recipe, bottle, calibration and setting into one file — it both downloads and is kept on the Pi (see below). Restore overwrites all current data and reloads the page. For an off-device copy, export from a computer on the same network.";
    card.appendChild(note);

    return card;
  }

  function renderBackupRow(backup) {
    const row = document.createElement("div");
    row.className = "maint-slot maint-slot--backup";

    const info = document.createElement("div");
    info.className = "maint-slot__info";
    const name = document.createElement("div");
    name.className = "maint-slot__name";
    name.textContent = formatBackupDate(backup.savedAt);
    const meta = document.createElement("div");
    meta.className = "maint-slot__meta";
    meta.textContent = `${backup.name} · ${formatBytes(backup.size)}`;
    info.append(name, meta);
    row.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "maint-slot__actions";

    const restore = actionBtn("Restore", { tone: "warn" });
    makeArmable(restore, "Restore", "Overwrite — confirm", () =>
      doRestoreNamed(backup.name)
    );
    actions.appendChild(restore);

    // Deleting a backup file is unrelated to the machine being busy.
    const del = actionBtn("Delete");
    del.dataset.alwaysEnabled = "1";
    makeArmable(del, "Delete", "Delete — confirm", () => doDelete(backup.name));
    actions.appendChild(del);

    row.appendChild(actions);
    return row;
  }

  function renderSaved() {
    const card = document.createElement("section");
    card.className = "maint-card";
    card.appendChild(
      sectionHead("Saved on this device", "Restore or delete a backup kept on the Pi")
    );

    const list = document.createElement("div");
    list.className = "maint-slot-list";
    if (backups === null) {
      const p = document.createElement("p");
      p.className = "maint-backup-empty";
      p.textContent = "Loading…";
      list.appendChild(p);
    } else if (backups.length === 0) {
      const p = document.createElement("p");
      p.className = "maint-backup-empty";
      p.textContent = "No backups saved yet — tap Export backup above to create one.";
      list.appendChild(p);
    } else {
      for (const backup of backups) list.appendChild(renderBackupRow(backup));
    }
    card.appendChild(list);
    return card;
  }

  return { load, renderExport, renderSaved };
}
