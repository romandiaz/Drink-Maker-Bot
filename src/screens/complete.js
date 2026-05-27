import { resetStack } from "../app.js";
import { drinks, getDrinkById } from "../drinks.js";
import { header } from "../components/header.js";
import { glass, layeredGlass } from "../components/glass.js";
import { appState, setBuildDraft } from "../state.js";
import { CHECK_SVG } from "../icons.js";
import { formatByHand, formatGarnishProse, formatTopUpProse, joinList } from "../format.js";
import { showToast } from "../components/toast.js";
import { onMachineStatus } from "../machine-status.js";

const AUTO_RETURN_S = 20;

export function complete(props = {}) {
  // The pouring screen passes the finished order along; fall back to
  // pendingOrder / lastDrink defensively.
  const order = props.order || appState.pendingOrder || null;
  const drinkId = order?.drinkId || props.drinkId || appState.lastDrink || drinks[0].id;
  // Shots / custom builds aren't in drinks[] — their definition rides on the order.
  const drink = order?.customDrink || getDrinkById(drinkId);

  let countdownTimer = null;
  let unsubscribeStatus = null;
  let mounted = false;
  let sawGlass = false;
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
  // Match the pouring screen — custom drinks keep their layered visualization
  // through to the cheers screen instead of falling back to a single fill.
  const renderGlass = drink.isCustom ? layeredGlass : glass;
  glassWrap.appendChild(renderGlass(drink, { width: 240 }));
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
  const byHand = order?.missingByHand || [];
  for (const ing of byHand) parts.push(formatByHand(ing));
  if (drink.topUp) parts.push(formatTopUpProse(drink.topUp, order?.amount ?? 1));
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
    // Reseed the stack so back from the next detail/shot/build screen lands
    // on idle (or the shot picker, in the shot case) — not on the completed
    // pour. Custom drinks aren't in drinks[], so detail can't open them;
    // re-seed the shared build draft and route back to the build screen so
    // the user can tweak and re-pour, or pour the exact same drink again.
    // Seeding via appState (not stack-entry props) means a cancelled re-pour
    // rewinds to whatever the user is currently editing, not back to the
    // original seed.
    if (drink.isShot) {
      resetStack("idle", "shotPicker", ["shotDetail", { ingredientId: drink.ingredients[0].name }]);
    } else if (drink.isCustom) {
      setBuildDraft({ name: drink.name, ingredients: drink.ingredients });
      resetStack("idle", "buildYourOwn");
    } else {
      resetStack("idle", ["detail", { drinkId: drink.id }]);
    }
  });

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "complete-btn complete-btn--secondary tappable";
  doneBtn.textContent = "Done";
  doneBtn.addEventListener("click", () => resetStack("idle"));

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
      resetStack("idle");
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

  // Glass-lift detection piggybacks on glass-watch.js, which already maintains
  // `glassPresent` system-wide and broadcasts it via MACHINE_STATE. We just
  // wait for a true→false edge — no per-screen polling, no maintenance-lock
  // churn flashing the header indicator. In mock mode the watcher isn't
  // running, so glassPresent stays false and the 20s countdown handles return.
  function mount() {
    mounted = true;
    countdownTimer = setInterval(tick, 1000);
    element.addEventListener("pointerdown", resetCountdown);

    unsubscribeStatus = onMachineStatus((status) => {
      if (!mounted) return;
      if (status.glassPresent) {
        sawGlass = true;
      } else if (sawGlass) {
        showToast("Cheers!", { variant: "success", log: false, duration: 3000 });
        resetStack("idle");
      }
    });
  }

  function unmount() {
    mounted = false;
    if (countdownTimer) clearInterval(countdownTimer);
    if (unsubscribeStatus) {
      unsubscribeStatus();
      unsubscribeStatus = null;
    }
    element.removeEventListener("pointerdown", resetCountdown);
  }

  return { element, mount, unmount };
}
