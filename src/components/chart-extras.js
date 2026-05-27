// Legend + drill-down panel paired with the stacked bar chart. Both stats
// pages tap the same bar segments, so the labels-and-swatches piece and the
// "what was poured this day" panel live here instead of duplicating in each
// screen.

export function createLegend(items) {
  const wrap = document.createElement("div");
  wrap.className = "dstat-legend";
  for (const it of items || []) {
    if (!it) continue;
    const chip = document.createElement("span");
    chip.className = "dstat-legend__item";
    const swatch = document.createElement("span");
    swatch.className = "dstat-legend__swatch";
    swatch.style.background = it.color;
    const label = document.createElement("span");
    label.className = "dstat-legend__label";
    label.textContent = it.label;
    chip.append(swatch, label);
    wrap.appendChild(chip);
  }
  return wrap;
}

// Panel that shows what made up the selected bar — a date header, the total
// for the day, and the top contributors with their swatches. The host screen
// re-renders this whenever the selection changes; `hint` is the placeholder
// shown before anything is tapped (used when the window has no pours yet).
export function createBreakdownPanel({ date, summary, lines, hint }) {
  const wrap = document.createElement("div");
  wrap.className = "dstat-breakdown";

  if (!lines || lines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dstat-breakdown__empty";
    empty.textContent = hint || "Tap a bar to see its breakdown.";
    wrap.appendChild(empty);
    return wrap;
  }

  const head = document.createElement("div");
  head.className = "dstat-breakdown__head";
  const dateEl = document.createElement("span");
  dateEl.className = "dstat-breakdown__date";
  dateEl.textContent = date;
  const sumEl = document.createElement("span");
  sumEl.className = "dstat-breakdown__sum";
  sumEl.textContent = summary;
  head.append(dateEl, sumEl);
  wrap.appendChild(head);

  const list = document.createElement("ol");
  list.className = "dstat-breakdown__list";
  for (const line of lines) {
    const li = document.createElement("li");
    li.className = "dstat-breakdown__row";
    const swatch = document.createElement("span");
    swatch.className = "dstat-breakdown__swatch";
    swatch.style.background = line.color;
    const name = document.createElement("span");
    name.className = "dstat-breakdown__name";
    name.textContent = line.name;
    const val = document.createElement("span");
    val.className = "dstat-breakdown__value";
    val.textContent = line.value;
    li.append(swatch, name, val);
    list.appendChild(li);
  }
  wrap.appendChild(list);

  return wrap;
}
