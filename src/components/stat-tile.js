// Shared building blocks for the Top Drinks / Top Ingredients overview bands.
// A stat tile is a value + uppercase label + optional sub-line; shortDate
// labels the activity chart's left axis. Both pages render the same .dstat-*
// markup, so they live here rather than being copied per screen.

export function statTile(value, label, sub) {
  const tile = document.createElement("div");
  tile.className = "dstat-tile";
  const v = document.createElement("div");
  v.className = "dstat-tile__value";
  v.textContent = value;
  const l = document.createElement("div");
  l.className = "dstat-tile__label";
  l.textContent = label;
  tile.append(v, l);
  if (sub) {
    const s = document.createElement("div");
    s.className = "dstat-tile__sub";
    s.textContent = sub;
    tile.appendChild(s);
  }
  return tile;
}

export function shortDate(ms) {
  const d = new Date(ms);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}
