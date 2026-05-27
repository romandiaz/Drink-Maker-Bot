import { getJSON, delJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { header } from "../components/header.js";

// Notifications screen — replays every toast the kiosk has shown, newest
// first. Most pour errors are gone in 4 seconds; this is where the admin
// goes after the fact to see what the actual firmware reason was. Backend
// caps at 200 rolling entries (see server/notifications.js). The Clear-all
// button uses the same two-tap confirm pattern as the History tab so an
// accidental tap can't blow the log away.
//
// Reached via the bell icon in the admin header — no longer a tab, to
// keep the admin tab strip uncluttered.

function timeLabel(iso) {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const d = new Date(ts);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${month} ${day} · ${time}`;
}

const VARIANT_LABELS = { success: "Success", info: "Info", error: "Error" };

function notificationRow(entry) {
  const row = document.createElement("div");
  row.className = "history-row notification-row";
  const variant = VARIANT_LABELS[entry.variant] ? entry.variant : "error";
  row.dataset.variant = variant;

  const head = document.createElement("div");
  head.className = "history-row__head";
  const label = document.createElement("div");
  label.className = "history-row__name";
  label.textContent = VARIANT_LABELS[variant];
  const time = document.createElement("div");
  time.className = "history-row__time";
  time.textContent = timeLabel(entry.ts);
  head.append(label, time);
  row.appendChild(head);

  const body = document.createElement("div");
  body.className = "history-row__body";
  body.textContent = entry.message || "—";
  row.appendChild(body);

  return row;
}

export function notifications() {
  const element = document.createElement("section");
  element.className = "screen screen--admin";
  element.dataset.screen = "notifications";

  element.appendChild(
    header({
      back: true,
      eyebrow: "Station 01",
      title: "Notifications",
      right: "ready",
    })
  );

  const body = document.createElement("div");
  body.className = "admin-body admin-body--history";
  element.appendChild(body);

  const footer = document.createElement("footer");
  footer.className = "screen-footer";
  const meta = document.createElement("span");
  meta.className = "screen-footer__meta";
  const hint = document.createElement("span");
  hint.className = "screen-footer__hint";
  hint.textContent = "Replay of toasts shown anywhere · capped at 200";
  footer.append(meta, hint);
  element.appendChild(footer);

  let entries = [];
  let clearConfirmTimer = null;

  function setMeta(text) {
    meta.textContent = text;
  }

  function updateMeta() {
    const n = entries.length;
    if (n === 0) {
      setMeta("No notifications");
      return;
    }
    const errs = entries.filter((e) => e.variant === "error").length;
    setMeta(`${n} notification${n === 1 ? "" : "s"} · ${errs} error${errs === 1 ? "" : "s"}`);
  }

  function render() {
    body.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "history-toolbar";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "history-toolbar__clear tappable";
    clearBtn.textContent = "Clear all";
    clearBtn.disabled = entries.length === 0;
    let confirming = false;
    clearBtn.addEventListener("click", () => {
      if (entries.length === 0) return;
      if (!confirming) {
        confirming = true;
        clearBtn.textContent = "Tap again to clear";
        clearBtn.classList.add("is-confirming");
        clearConfirmTimer = setTimeout(() => {
          confirming = false;
          clearBtn.textContent = "Clear all";
          clearBtn.classList.remove("is-confirming");
          clearConfirmTimer = null;
        }, 3000);
        return;
      }
      if (clearConfirmTimer) {
        clearTimeout(clearConfirmTimer);
        clearConfirmTimer = null;
      }
      onClear();
    });
    toolbar.appendChild(clearBtn);

    body.appendChild(toolbar);

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "No notifications yet.";
      const sub = document.createElement("div");
      sub.className = "history-empty__sub";
      sub.textContent = "Errors and status messages will appear here.";
      empty.appendChild(sub);
      body.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "history-list";
      for (const e of entries) list.appendChild(notificationRow(e));
      body.appendChild(list);
    }

    updateMeta();
  }

  async function refresh() {
    try {
      const data = await getJSON("/api/notifications");
      entries = Array.isArray(data.entries) ? data.entries : [];
      if (entries.length > 0) {
        localStorage.setItem("lastSeenNotification", entries[0].ts);
      }
    } catch (e) {
      entries = [];
      showToast(`Couldn't load notifications — ${e.message}`);
    }
    render();
  }

  async function onClear() {
    try {
      setMeta("Clearing…");
      await delJSON("/api/notifications");
      await refresh();
      // Skip the toast log here — clearing and immediately re-adding a
      // "Notifications cleared" entry as the first row reads as a bug.
      showToast("Notifications cleared", { variant: "success", duration: 2500, log: false });
    } catch (e) {
      console.error(e);
      setMeta(`Clear failed — ${e.message}`);
      showToast(`Clear failed — ${e.message}`);
    }
  }

  function mount() {
    refresh();
  }

  function unmount() {
    if (clearConfirmTimer) {
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = null;
    }
  }

  return { element, mount, unmount };
}
