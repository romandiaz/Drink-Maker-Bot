import { navigate } from "../app.js";
import { drinks, isDrinkEnabled } from "../drinks.js";
import { header } from "../components/header.js";
import { glass } from "../components/glass.js";
import { isDrinkPourable } from "../inventory-store.js";
import { isCategoryEnabled } from "../category-store.js";
import { setSelectedDrink } from "../state.js";

// "Surprise me" — a slot-machine reel that lands on a random pourable drink.
// The reel is an outlined circle; a long strip of cells is translated upward
// with an ease-out transition so it decelerates like a real reel. Each spin
// rebuilds the strip with the *current* resting drink as cell 0, so snapping
// the strip back to translateY(0) before the next spin shows the same glass
// that's already on screen — no visible jump.

// One cell is the full circle height, so when the reel stops only the winning
// drink is on screen — its neighbours sit exactly off the top and bottom edges.
// The reel renders larger than the wrap's flex footprint (260) and visually
// overflows into the surrounding gap space — that's how the circle grew
// without moving any neighbouring element.
const CELL_H = 260; // px — mirrored into CSS via the --cell-h custom property
const STRIP_LEN = 20; // cells per spin (cell 0 = current, last cell = winner)
const SPIN_MS = 2600;
const SPIN_EASING = "cubic-bezier(0.12, 0.62, 0.13, 1)";
const FIRST_SPIN_DELAY_MS = 450;
// Fraction of the spin after which the motion blur is dropped so the reel
// settles sharp — the ease-out has shed most of its speed by this point.
const BLUR_OFF_FRAC = 0.55;

// Drinks the machine can fully pour right now — the same filter the category
// screen uses for its pourable count, so the reel never lands on a drink the
// detail screen would immediately mark unavailable.
function pourablePool() {
  return drinks.filter(
    (d) => isDrinkEnabled(d) && isCategoryEnabled(d.category) && isDrinkPourable(d)
  );
}

// Radial tick ring drawn around the reel. The SVG is 280×280 (10px bigger
// than the reel on each side) and is centred over the reel via CSS so the
// halo sits outside the reel's outline. Every other ray is long+bold, the
// rest are short+thin — art deco sunburst feel.
const TICK_COUNT = 24;
function buildTickRing() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "surprise-reel-ticks");
  svg.setAttribute("viewBox", "0 0 280 280");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (let i = 0; i < TICK_COUNT; i++) {
    const isLong = i % 2 === 0;
    const line = document.createElementNS(NS, "line");
    // Inner anchor at r ≈ 131 (just outside the reel's outer border at
    // r=130.5); long rays reach to r ≈ 139, short rays stop at r ≈ 135.
    line.setAttribute("x1", "140");
    line.setAttribute("y1", isLong ? "1" : "5");
    line.setAttribute("x2", "140");
    line.setAttribute("y2", "9");
    line.setAttribute("transform", `rotate(${(i * 360) / TICK_COUNT} 140 140)`);
    if (!isLong) line.setAttribute("class", "tick--short");
    svg.appendChild(line);
  }
  return svg;
}

// Background twinkle layer behind the reel — little white stars that fade in
// and pulse only while the reel is spinning (toggled via the .is-spinning
// class). Positions/sizes/timings are randomised once at build time so the
// field looks scattered rather than gridded; each star's animation-delay is
// negative so they start mid-cycle and twinkle out of sync.
const STAR_COUNT = 100;
function buildStarfield() {
  const stars = document.createElement("div");
  stars.className = "surprise-stars";
  stars.setAttribute("aria-hidden", "true");
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = document.createElement("span");
    star.className = "surprise-star";
    const size = 1.5 + Math.random() * 1.8; // px
    const dur = 0.5 + Math.random() * 0.7; // s
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.animationDuration = `${dur}s`;
    star.style.animationDelay = `-${Math.random() * dur}s`;
    stars.appendChild(star);
  }
  return stars;
}

export function surprise() {
  const pool = pourablePool();

  const element = document.createElement("section");
  element.className = "screen screen--surprise";
  element.dataset.screen = "surprise";
  element.style.setProperty("--cell-h", `${CELL_H}px`);

  // Background twinkle layer sits behind everything (z-index handled in CSS);
  // appended first so it's the bottom-most painted child.
  element.appendChild(buildStarfield());

  element.appendChild(
    header({ eyebrow: "Bartender's Choice", title: "Surprise Me" })
  );

  // Nothing pourable — there's no drink to land on. Show a static message;
  // the header back button is the only way out.
  if (pool.length === 0) {
    const empty = document.createElement("div");
    empty.className = "surprise-empty";
    empty.textContent =
      "No drinks are pourable right now. Load some bottles and try again.";
    element.appendChild(empty);
    return { element, mount() {}, unmount() {} };
  }

  // Wrapper holds the SVG tick ring and the circular reel as overlapping layers
  // — the ticks sit just outside the reel's outline so they read as radial
  // selector marks pointing inward at the resting drink.
  const reelWrap = document.createElement("div");
  reelWrap.className = "surprise-reel-wrap";
  reelWrap.appendChild(buildTickRing());
  const reel = document.createElement("div");
  reel.className = "surprise-reel tappable";
  const strip = document.createElement("div");
  strip.className = "surprise-reel__strip";
  reel.appendChild(strip);
  reelWrap.appendChild(reel);
  element.appendChild(reelWrap);

  const result = document.createElement("div");
  result.className = "surprise-result";
  const resultName = document.createElement("div");
  resultName.className = "surprise-result__name";
  const resultTagline = document.createElement("div");
  resultTagline.className = "surprise-result__tagline";
  result.append(resultName, resultTagline);
  element.appendChild(result);

  const actions = document.createElement("div");
  actions.className = "surprise-actions";
  const spinBtn = document.createElement("button");
  spinBtn.type = "button";
  spinBtn.className = "surprise-btn surprise-btn--spin tappable";
  spinBtn.textContent = "Spin again";
  const pourBtn = document.createElement("button");
  pourBtn.type = "button";
  pourBtn.className = "surprise-btn surprise-btn--pour tappable";
  pourBtn.textContent = "Pour this →";
  actions.append(spinBtn, pourBtn);
  element.appendChild(actions);

  // Off-screen <defs> holding the motion-blur filter the strip references
  // while spinning. stdDeviation's X component is 0, so only the vertical
  // axis blurs — true directional blur for a vertically-scrolling reel.
  const blurDefs = document.createElement("div");
  blurDefs.className = "surprise-blur-defs";
  blurDefs.innerHTML =
    '<svg aria-hidden="true" focusable="false">' +
    '<defs><filter id="surprise-motion-blur">' +
    '<feGaussianBlur stdDeviation="0 26"/>' +
    "</filter></defs></svg>";
  element.appendChild(blurDefs);

  let currentWinner = pool[Math.floor(Math.random() * pool.length)];
  let spinning = false;
  let settleTimer = null;
  let startTimer = null;
  let blurTimer = null;

  function buildCell(drink) {
    const cell = document.createElement("div");
    cell.className = "surprise-cell";
    cell.appendChild(glass(drink, { width: 170 }));
    return cell;
  }

  function renderStrip(cells) {
    strip.innerHTML = "";
    for (const d of cells) strip.appendChild(buildCell(d));
  }

  // Random drink, never the one currently resting — unless the pool is a
  // single drink, in which case there's no other choice.
  function pickWinner() {
    if (pool.length === 1) return pool[0];
    let w;
    do {
      w = pool[Math.floor(Math.random() * pool.length)];
    } while (w === currentWinner);
    return w;
  }

  // Cell 0 is the current resting drink so the pre-spin snap to translateY(0)
  // shows the glass already on screen; the middle cells are random filler;
  // the last cell is the winner that ends up framed in the window.
  function buildStrip(winner) {
    const cells = [currentWinner];
    for (let i = 1; i < STRIP_LEN - 1; i++) {
      cells.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    cells.push(winner);
    return cells;
  }

  function onLanded(winner) {
    currentWinner = winner;
    spinning = false;
    element.classList.remove("is-spinning");
    // Defensive — the blur is normally cleared mid-spin by blurTimer.
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    strip.classList.remove("is-blurring");
    resultName.textContent = winner.name;
    resultTagline.textContent = winner.tagline || "";
  }

  // Settle on the transform's transitionend, with a timer backstop in case the
  // event is missed (interrupted transition, reduced-motion). finish() is
  // idempotent so whichever fires first wins.
  function scheduleSettle(winner) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      strip.removeEventListener("transitionend", onEnd);
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      onLanded(winner);
    };
    const onEnd = (e) => {
      if (e.target === strip && e.propertyName === "transform") finish();
    };
    strip.addEventListener("transitionend", onEnd);
    settleTimer = setTimeout(finish, SPIN_MS + 150);
  }

  function spin() {
    if (spinning) return;
    spinning = true;
    element.classList.add("is-spinning");
    resultName.textContent = "";
    resultTagline.textContent = "Picking your drink…";

    const winner = pickWinner();
    renderStrip(buildStrip(winner));

    // Snap to the top with no transition, force a reflow so that start state
    // is committed, then animate down so the winner cell lands in the window.
    strip.style.transition = "none";
    strip.style.transform = "translateY(0)";
    void strip.offsetHeight;
    strip.style.transition = `transform ${SPIN_MS}ms ${SPIN_EASING}`;
    strip.style.transform = `translateY(-${(STRIP_LEN - 1) * CELL_H}px)`;

    // Motion blur while the reel is fast, dropped partway through so the
    // landing is crisp. Skipped under reduced-motion — the spin is near-
    // instant there, so a lingering blur would just sit static on the result.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      strip.classList.add("is-blurring");
      blurTimer = setTimeout(() => {
        strip.classList.remove("is-blurring");
        blurTimer = null;
      }, SPIN_MS * BLUR_OFF_FRAC);
    }

    scheduleSettle(winner);
  }

  function openDetail() {
    if (element.classList.contains("is-spinning")) return;
    setSelectedDrink(currentWinner.id);
    navigate("detail", { drinkId: currentWinner.id });
  }

  spinBtn.addEventListener("click", spin);
  pourBtn.addEventListener("click", openDetail);
  reel.addEventListener("click", openDetail);

  function mount() {
    // Rest on a random drink, then auto-spin once — the tap that opened this
    // screen is the user's "pull the lever".
    renderStrip([currentWinner]);
    strip.style.transform = "translateY(0)";
    element.classList.add("is-spinning");
    startTimer = setTimeout(() => {
      startTimer = null;
      spin();
    }, FIRST_SPIN_DELAY_MS);
  }

  function unmount() {
    if (startTimer) clearTimeout(startTimer);
    if (settleTimer) clearTimeout(settleTimer);
    if (blurTimer) clearTimeout(blurTimer);
    startTimer = null;
    settleTimer = null;
    blurTimer = null;
  }

  return { element, mount, unmount };
}
