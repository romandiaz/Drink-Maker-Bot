import { navigate } from "../app.js";
import { drinks, getDrinkById } from "../drinks.js";
import { header } from "../components/header.js";
import { glass } from "../components/glass.js";
import { appState } from "../state.js";
import { CHECK_SVG } from "../icons.js";
import { formatByHand, formatGarnishProse, formatTopUpProse, joinList } from "../format.js";

const AUTO_RETURN_S = 20;

export function complete(props = {}) {
  const drinkId = props.drinkId || appState.lastDrink || drinks[0].id;
  // Shots aren't in drinks[] — the synthesized drink lives on pendingOrder.
  const drink =
    (appState.pendingOrder?.drinkId === drinkId &&
      appState.pendingOrder?.customDrink) ||
    getDrinkById(drinkId);

  let countdownTimer = null;
  let secondsLeft = AUTO_RETURN_S;

  const element = document.createElement("section");
  element.className = "screen screen--complete";
  element.dataset.screen = "complete";

  // Minimal header — title only, ready indicator returns since the machine is free.
  // No back button (per spec) and no search pill (decision logged in step 7 follow-up).
  element.appendChild(
    header({
      back: false,
      title: "Cheers",
      right: "ready",
    })
  );

  const main = document.createElement("div");
  main.className = "complete-main";

  const glassWrap = document.createElement("div");
  glassWrap.className = "complete-glass";
  glassWrap.appendChild(glass(drink, { width: 240 }));
  main.appendChild(glassWrap);

  const info = document.createElement("div");
  info.className = "complete-info";

  const check = document.createElement("div");
  check.className = "complete-check";
  check.innerHTML = `${CHECK_SVG}<span>Ready</span>`;
  info.appendChild(check);

  const enjoy = document.createElement("h2");
  enjoy.className = "complete-name";
  enjoy.textContent = `Enjoy your ${drink.name}`;
  info.appendChild(enjoy);

  // Items the user adds themselves: by-hand ingredients (machine wasn't loaded
  // for them), the post-pour topUp (ginger beer, cola, beer float), and the
  // decorative garnish. Listed in that order — recipe components first, then
  // mixers, then garnish — to match the natural pour-and-finish sequence.
  const parts = [];
  const byHand = appState.pendingOrder?.missingByHand || [];
  for (const ing of byHand) parts.push(formatByHand(ing));
  if (drink.topUp) parts.push(formatTopUpProse(drink.topUp));
  if (drink.garnish) parts.push(formatGarnishProse(drink.garnish));
  if (parts.length) {
    const hint = document.createElement("div");
    hint.className = "complete-garnish";
    hint.textContent = `Don’t forget to add ${joinList(parts)}`;
    info.appendChild(hint);
  }

  const lift = document.createElement("div");
  lift.className = "complete-lift";
  lift.textContent = "Lift the glass from the tray";
  info.appendChild(lift);

  main.appendChild(info);
  element.appendChild(main);

  // Footer wraps buttons + countdown in a fixed-height slot shared with the
  // pouring screen, so the glass lands at the same Y on both screens.
  const footer = document.createElement("div");
  footer.className = "pour-stage-footer";

  const buttons = document.createElement("div");
  buttons.className = "complete-buttons";

  const anotherBtn = document.createElement("button");
  anotherBtn.type = "button";
  anotherBtn.className = "complete-btn complete-btn--primary tappable";
  anotherBtn.textContent = "Another";
  anotherBtn.addEventListener("click", () => {
    if (drink.isShot) {
      navigate("shotDetail", { ingredientId: drink.ingredients[0].name });
    } else {
      navigate("detail", { drinkId: drink.id });
    }
  });

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "complete-btn complete-btn--secondary tappable";
  doneBtn.textContent = "Done";
  doneBtn.addEventListener("click", () => navigate("idle", {}, "pop"));

  buttons.append(anotherBtn, doneBtn);
  footer.appendChild(buttons);

  const countdown = document.createElement("div");
  countdown.className = "complete-countdown";
  countdown.textContent = `Returning to idle in ${secondsLeft}s`;
  footer.appendChild(countdown);

  element.appendChild(footer);

  function tick() {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      navigate("idle", {}, "pop");
      return;
    }
    countdown.textContent = `Returning to idle in ${secondsLeft}s`;
  }

  // Any touch on the screen extends the stay — the countdown was originally a
  // hard 20s wall, which dumped users back to idle while they were still
  // looking at their drink. The global 60s inactivity timer in app.js still
  // applies, so a truly idle screen will eventually return on its own.
  function resetCountdown() {
    secondsLeft = AUTO_RETURN_S;
    countdown.textContent = `Returning to idle in ${secondsLeft}s`;
  }

  function mount() {
    countdownTimer = setInterval(tick, 1000);
    element.addEventListener("pointerdown", resetCountdown);
  }

  function unmount() {
    if (countdownTimer) clearInterval(countdownTimer);
    element.removeEventListener("pointerdown", resetCountdown);
  }

  return { element, mount, unmount };
}
