import { navigate } from "../app.js";
import { drinks, getCategoryById, isDrinkEnabled } from "../drinks.js";
import { header, readyIndicator, adminButton } from "../components/header.js";
import { glass } from "../components/glass.js";
import { setSelectedDrink } from "../state.js";
import { isDrinkPourable } from "../inventory-store.js";
import { isCategoryEnabled } from "../category-store.js";
import { timeBucket } from "./idle-timeofday.js";
import { requestAdminAccess } from "../admin-auth.js";
import { orderQrCard } from "../components/order-qr.js";


const ROTATE_MS = 30000;
const CLOCK_TICK_MS = 60000;
const FADE_MS = 400;

function clockTime() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Prefer drinks in the bucket's categories, then any pourable drink, then the
// full list. Each fallback keeps the screen alive if earlier pools come up
// empty (bucket categories all out of stock, inventory not yet hydrated).
function pickableDrinks(bucket) {
  const visible = drinks.filter(
    (d) => isDrinkEnabled(d) && isCategoryEnabled(d.category)
  );
  const pourable = visible.filter(isDrinkPourable);
  const inBucket = pourable.filter((d) => bucket.categoryIds.includes(d.category));
  if (inBucket.length > 0) return inBucket;
  if (pourable.length > 0) return pourable;
  if (visible.length > 0) return visible;
  return drinks;
}

export function idle() {
  let currentBucket = timeBucket();
  const initialPool = pickableDrinks(currentBucket);
  let currentDrink = initialPool[Math.floor(Math.random() * initialPool.length)];
  let rotationTimer = null;
  let clockTimer = null;

  const element = document.createElement("section");
  element.className = "screen screen--idle";
  element.dataset.screen = "idle";

  // Right slot — admin gear + clock + ready. The gear is the always-visible
  // entry point to the admin screen; the 5-tap eyebrow gesture below stays as
  // a backup for when the gear is hard to hit.
  const rightSlot = document.createElement("div");
  rightSlot.className = "header-right-cluster";
  const clockEl = document.createElement("span");
  clockEl.className = "idle-clock";
  clockEl.textContent = clockTime();
  rightSlot.append(adminButton(), clockEl, readyIndicator());

  const headerEl = header({
    back: false,
    eyebrow: "Station 01",
    title: "Bartender",
    search: true,
    onSearch: () => navigate("search"),
    right: rightSlot,
  });
  element.appendChild(headerEl);
  // The drink queue is reachable from the header's queue chip on every
  // screen — no idle-only banner needed.

  // Hidden admin gesture: 5 quick taps on the "Station 01" eyebrow opens the
  // inventory screen. Resets if taps slow down (>800ms between taps).
  const eyebrowEl = headerEl.querySelector(".header-eyebrow");
  let tapCount = 0;
  let tapTimer = null;
  eyebrowEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    tapCount++;
    if (tapTimer) clearTimeout(tapTimer);
    if (tapCount >= 5) {
      tapCount = 0;
      requestAdminAccess();
      return;
    }
    tapTimer = setTimeout(() => {
      tapCount = 0;
    }, 800);
  });

  const feature = document.createElement("div");
  feature.className = "idle-feature";

  const label = document.createElement("div");
  label.className = "idle-feature__label";
  label.textContent = currentBucket.label;
  feature.appendChild(label);

  // Only the glass itself routes to detail; everything else on the screen
  // (surrounding label, name, tagline, empty space) falls through to the
  // tap-anywhere → category handler below.
  const glassEl = document.createElement("div");
  glassEl.className = "idle-feature__glass tappable";
  glassEl.addEventListener("click", (e) => {
    e.stopPropagation();
    setSelectedDrink(currentDrink.id);
    navigate("detail", { drinkId: currentDrink.id });
  });
  feature.appendChild(glassEl);

  const nameEl = document.createElement("div");
  nameEl.className = "idle-feature__name";
  feature.appendChild(nameEl);

  const accentRule = document.createElement("div");
  accentRule.className = "idle-feature__accent-rule";
  feature.appendChild(accentRule);

  const taglineEl = document.createElement("div");
  taglineEl.className = "idle-feature__tagline";
  feature.appendChild(taglineEl);

  element.appendChild(feature);

  // Absolutely positioned, so it doesn't shift the centred featured drink.
  // Hides itself when there's no reachable order URL to encode.
  element.appendChild(orderQrCard());

  const hint = document.createElement("div");
  hint.className = "idle-hint";
  hint.textContent = "Touch anywhere to begin";
  element.appendChild(hint);

  function paint(drink) {
    glassEl.innerHTML = "";
    glassEl.appendChild(glass(drink, { width: 140 }));
    nameEl.textContent = drink.name;
    taglineEl.textContent = drink.tagline || "";

    const cat = getCategoryById(drink.category);
    feature.style.setProperty("--accent", cat?.accent || "var(--border-strong)");
  }

  // Cross-fade by toggling .is-fading: opacity 0 → swap content → opacity 1.
  // Recompute the bucket each rotation so the screen adapts if the kiosk sits
  // idle through an hour rollover.
  function rotateNext() {
    feature.classList.add("is-fading");
    setTimeout(() => {
      currentBucket = timeBucket();
      label.textContent = currentBucket.label;
      const pool = pickableDrinks(currentBucket);
      let nextDrink;
      do {
        nextDrink = pool[Math.floor(Math.random() * pool.length)];
      } while (nextDrink.id === currentDrink.id && pool.length > 1);
      currentDrink = nextDrink;
      paint(currentDrink);
      feature.classList.remove("is-fading");
    }, FADE_MS / 2);
  }

  // Tap-anywhere → category. Skip if the tap landed on an actual button so the
  // search pill still works.
  element.addEventListener("click", (e) => {
    if (e.target.closest("button, .tappable")) return;
    navigate("category");
  });

  function mount() {
    paint(currentDrink);
    rotationTimer = setInterval(rotateNext, ROTATE_MS);
    clockTimer = setInterval(() => {
      clockEl.textContent = clockTime();
    }, CLOCK_TICK_MS);
  }

  function unmount() {
    if (rotationTimer) clearInterval(rotationTimer);
    if (clockTimer) clearInterval(clockTimer);
  }

  return { element, mount, unmount };
}
