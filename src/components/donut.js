// Small reusable donut chart. Each segment is its own SVG circle with
// stroke-dasharray cut to the right arc length and stroke-dashoffset to slide
// it into place — same pattern as the detail-screen donut, but parameterized
// for the admin dashboard's mini cards.

export function createDonut({
  segments,
  size = 88,
  thickness = 10,
  centerLabel,
  centerSubLabel,
  trackColor = "var(--border-divider)",
}) {
  const wrap = document.createElement("div");
  wrap.className = "mini-donut";
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "mini-donut__svg");
  svg.setAttribute("aria-hidden", "true");

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  const track = document.createElementNS(svgNS, "circle");
  track.setAttribute("cx", cx);
  track.setAttribute("cy", cy);
  track.setAttribute("r", r);
  track.setAttribute("fill", "transparent");
  track.setAttribute("stroke", trackColor);
  track.setAttribute("stroke-width", thickness);
  svg.appendChild(track);

  const valid = (segments || []).filter((s) => s && Number(s.value) > 0);
  const total = valid.reduce((s, x) => s + Number(x.value), 0);

  if (total > 0) {
    let accumulated = 0;
    const gap = valid.length > 1 ? 1.4 : 0;
    valid.forEach((seg) => {
      const portion = Number(seg.value) / total;
      const arcLength = portion * circumference;
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      circle.setAttribute("r", r);
      circle.setAttribute("fill", "transparent");
      circle.setAttribute("stroke", seg.color);
      circle.setAttribute("stroke-width", thickness);
      circle.setAttribute(
        "stroke-dasharray",
        `${Math.max(0, arcLength - gap)} ${circumference}`,
      );
      circle.setAttribute("stroke-dashoffset", `-${accumulated}`);
      circle.classList.add("mini-donut__slice");
      svg.appendChild(circle);
      accumulated += arcLength;
    });
  }

  wrap.appendChild(svg);

  if (centerLabel != null || centerSubLabel != null) {
    const center = document.createElement("div");
    center.className = "mini-donut__center";
    if (centerLabel != null) {
      const t = document.createElement("div");
      t.className = "mini-donut__label";
      if (centerLabel instanceof Node) t.appendChild(centerLabel);
      else t.textContent = String(centerLabel);
      center.appendChild(t);
    }
    if (centerSubLabel) {
      const s = document.createElement("div");
      s.className = "mini-donut__sub";
      s.textContent = centerSubLabel;
      center.appendChild(s);
    }
    wrap.appendChild(center);
  }

  return wrap;
}
