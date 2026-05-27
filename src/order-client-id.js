// Stable per-device identifier for the mobile order page. Stashed in
// localStorage on first visit so a phone can identify itself across reloads
// and pull its own queued drinks without authentication. Not a secret — the
// server uses it only to scope QUEUE_REMOVE to the entry's original adder.

const STORAGE_KEY = "drinkbot.clientId";

function randomId() {
  // crypto.randomUUID is the cleanest path; fall back for the rare older
  // mobile browser that doesn't have it (the captive-portal page is the only
  // realistic entry point for this UI, so the fallback is mostly defensive).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "cid-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getClientId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // Private-mode Safari or storage disabled — fall back to a per-session id
    // so QUEUE_ADD/REMOVE still pair up within one page load.
    return randomId();
  }
}
