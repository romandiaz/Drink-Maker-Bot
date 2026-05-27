// Compact vertical bar chart with stacked segments and optional tap selection.
// Each bar is a list of coloured segments; their sum sets the bar's height
// relative to the tallest bar in the set. When onSelect is supplied each
// column becomes a button — the host screen drives a selection state and
// re-renders to highlight the chosen bar (CLAUDE.md forbids hover on the
// touchscreen, so taps replace tooltips here). Pixel-based sizing throughout:
// percentage heights on nested flex children don't resolve reliably, and we
// already know the chart's height in px.

export function createBarChart({ bars, height = 52, onSelect }) {
  const wrap = document.createElement("div");
  wrap.className = "bar-chart";
  wrap.style.height = `${height}px`;

  const totals = (bars || []).map((b) =>
    (b.segments || []).reduce((s, x) => s + (Number(x.value) || 0), 0),
  );
  const max = totals.reduce((m, t) => Math.max(m, t), 0);

  (bars || []).forEach((b, i) => {
    const col = document.createElement(onSelect ? "button" : "div");
    col.className = "bar-chart__col";
    if (onSelect) {
      col.type = "button";
      col.classList.add("tappable");
      col.addEventListener("click", () => onSelect(i, b));
    }
    if (b.selected) col.classList.add("is-selected");

    const stack = document.createElement("div");
    stack.className = "bar-chart__bar";
    const totalPx = max > 0 ? Math.round((totals[i] / max) * height) : 0;
    const px = Math.max(2, totalPx);
    stack.style.height = `${px}px`;

    if (totals[i] === 0) {
      stack.classList.add("is-empty");
    } else {
      // Stack segments bottom-up via column-reverse. Floor each pixel slice
      // and let the last segment absorb the rounding remainder, so the
      // coloured stack exactly fills the bar.
      const segs = (b.segments || []).filter((s) => Number(s.value) > 0);
      let used = 0;
      segs.forEach((seg, j) => {
        const isLast = j === segs.length - 1;
        const v = Number(seg.value);
        const segPx = isLast
          ? Math.max(1, px - used)
          : Math.max(1, Math.floor((v / totals[i]) * px));
        if (!isLast) used += segPx;
        const segEl = document.createElement("div");
        segEl.className = "bar-chart__seg";
        segEl.style.height = `${segPx}px`;
        segEl.style.background = seg.color;
        stack.appendChild(segEl);
      });
    }
    col.appendChild(stack);
    wrap.appendChild(col);
  });

  return wrap;
}
