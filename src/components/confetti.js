// Minimal canvas confetti. Spawns a fullscreen overlay, animates colored
// rectangles falling from the top with gravity + rotation, then removes
// itself. No external deps (per CLAUDE.md). Used to celebrate the moment
// the guest's drink is up.

const COLORS = [
  "#D4A574", // classics
  "#5DCAA5", // refreshers
  "#F0C040", // sours
  "#E85D9B", // party
  "#4ade80", // success green
  "#a78bfa", // purple
  "#38bdf8", // sky
];

export function fireConfetti({ count = 90, duration = 2800 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  // Match device pixel ratio so the rectangles render crisp on phones.
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // Two bursts staggered slightly so the screen fills up rather than dropping
  // a single sheet of confetti. Pieces start with an upward velocity to give
  // an "explosion" feel before gravity takes over.
  const pieces = [];
  function spawn(originX, delay) {
    for (let i = 0; i < count / 2; i++) {
      pieces.push({
        x: originX + (Math.random() - 0.5) * 80,
        y: h * 0.45,
        vx: (Math.random() - 0.5) * 9,
        vy: -8 - Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.25,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        width: 6 + Math.random() * 6,
        height: 9 + Math.random() * 9,
        delay,
      });
    }
  }
  spawn(w * 0.25, 0);
  spawn(w * 0.75, 180);

  const startTime = performance.now();
  function frame(now) {
    const elapsed = now - startTime;
    if (elapsed > duration) {
      canvas.remove();
      return;
    }

    ctx.clearRect(0, 0, w, h);

    for (const p of pieces) {
      if (elapsed < p.delay) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.28; // gravity
      p.vx *= 0.995; // air drag
      p.rotation += p.rotSpeed;

      // Fade the last 600ms so the canvas doesn't vanish abruptly.
      const fade = elapsed > duration - 600
        ? Math.max(0, 1 - (elapsed - (duration - 600)) / 600)
        : 1;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// Fire immediately if the page is visible, otherwise wait until the guest
// brings the tab/app back into focus — confetti they never see is wasted.
export function fireConfettiWhenVisible(opts) {
  if (document.visibilityState === "visible") {
    fireConfetti(opts);
    return;
  }
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      document.removeEventListener("visibilitychange", onVisible);
      fireConfetti(opts);
    }
  };
  document.addEventListener("visibilitychange", onVisible);
}
