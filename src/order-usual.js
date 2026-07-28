// Per-device memory of what this phone has ordered, so the order page can
// offer a one-tap repeat of a guest's usual.
//
// Phone-local on purpose. This is a personal convenience, not machine state:
// the server's pour log stays anonymous, nothing has to be threaded through
// the pour drivers, and a guest's drinking history never leaves their own
// handset. The trade is that clearing site data forgets it and the kiosk
// can't show it — both fine for a party appliance.
//
// Sits alongside order-client-id.js, which owns the other piece of per-device
// state. Same storage-may-throw defensiveness: private-mode Safari rejects
// localStorage writes, and a guest who can't be remembered should still be
// able to order.

const STORAGE_KEY = "drinkbot.usual";
// Distinct order signatures kept. Far more than one guest gets through in a
// night; the cap exists only so storage can't grow across parties.
const MAX_ENTRIES = 20;

// Two orders are "the same usual" when the drink AND how it was customised
// match, so a one-tap repeat reproduces exactly what the guest had — a strong
// double Margarita is a different usual from a plain single.
function signature(order) {
  return [order.drinkId, order.strength, order.amount].join("|");
}

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.drinkId) : [];
  } catch {
    // Unreadable or corrupt — start over rather than break the page.
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage disabled or full. Losing the memory is not worth a failed order.
  }
}

// Call once per successfully placed order.
export function recordOrder(order) {
  if (!order || !order.drinkId) return;
  const sig = signature(order);
  const entries = read();
  const at = entries.findIndex((e) => e.sig === sig);
  const prev = at >= 0 ? entries[at] : null;
  if (at >= 0) entries.splice(at, 1);

  // The list is kept in most-recent-first order by construction rather than by
  // sorting on lastAt, because two orders placed in the same millisecond share
  // a timestamp and a stable sort would then fall back to array order — which
  // is oldest-first, so pruning the tail would drop exactly the wrong ones.
  entries.unshift({
    sig,
    drinkId: order.drinkId,
    strength: order.strength,
    amount: order.amount,
    count: prev ? prev.count + 1 : 1,
    lastAt: Date.now(),
  });

  // Prune the least-recent, not the least-frequent: a drink someone had three
  // times last month matters less than the one they switched to tonight.
  write(entries.slice(0, MAX_ENTRIES));
}

// Most-ordered first, ties broken by most-recent. `limit` caps the result.
export function getUsuals(limit = 3) {
  return read()
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, limit);
}
