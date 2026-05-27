import { navigate, replaceWith } from "../app.js";
import { getCategoryById, getDrinkById } from "../drinks.js";
import { header } from "../components/header.js";
import { glass, layeredGlass } from "../components/glass.js";
import { formatIngredient } from "../format.js";
import { CLOSE_SVG, PLUS_SVG } from "../icons.js";
import { getMachineStatus, onMachineStatus } from "../machine-status.js";
import {
  getQueue,
  onQueueChange,
  continueQueue,
  removeFromQueue,
  clearQueue,
} from "../queue-store.js";

// The drink queue — the full list of stacked drinks, shared across every
// device. Also the between-pours screen: when the machine is parked it's
// where someone swaps the glass and taps "Pour next". Doubles as the recovery
// surface — any drink can be removed and the whole queue cleared from here.
export function queue() {
  const element = document.createElement("section");
  element.className = "screen screen--queue";
  element.dataset.screen = "queue";

  // No status pill here: it navigates to "queue", which on this screen would
  // just push a duplicate entry onto the history stack (back then re-mounts
  // the queue once per tap). The queue-status line below shows machine state.
  element.appendChild(header({ back: true, title: "Drink queue", right: "none" }));

  const body = document.createElement("div");
  body.className = "queue-body";
  element.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "queue-footer";
  element.appendChild(footer);

  // Set true when this device taps "Pour next" — used to follow the pour onto
  // the pouring screen without yanking a device that's only viewing.
  let continuing = false;

  function drinkOf(order) {
    return order.customDrink || getDrinkById(order.drinkId);
  }

  function queueRow(entry, index) {
    const drink = drinkOf(entry.order);
    const row = document.createElement("div");
    row.className = "queue-row";
    if (index === 0) row.classList.add("queue-row--next");

    const num = document.createElement("div");
    num.className = "queue-row__num";
    num.textContent = String(index + 1);
    row.appendChild(num);

    const glassWrap = document.createElement("div");
    glassWrap.className = "queue-row__glass";
    const renderGlass = drink.isCustom ? layeredGlass : glass;
    glassWrap.appendChild(renderGlass(drink, { width: 40 }));
    row.appendChild(glassWrap);

    const info = document.createElement("div");
    info.className = "queue-row__info";
    const name = document.createElement("div");
    name.className = "queue-row__name";
    name.textContent = index === 0 ? `${drink.name} · next` : drink.name;
    const ings = document.createElement("div");
    ings.className = "queue-row__ings";
    ings.textContent = drink.ingredients.map((i) => formatIngredient(i.name)).join(" · ");
    info.append(name, ings);
    row.appendChild(info);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "queue-remove-btn";
    remove.setAttribute("aria-label", `Remove ${drink.name}`);
    remove.innerHTML = CLOSE_SVG;
    remove.addEventListener("click", () => removeFromQueue(entry.id));
    row.appendChild(remove);

    return row;
  }

  function render() {
    const q = getQueue();
    const machine = getMachineStatus();
    const pouringOrder = machine.status === "pouring" ? machine.job?.order : null;

    body.innerHTML = "";

    const status = document.createElement("div");
    status.className = "queue-status";
    if (pouringOrder) {
      status.textContent = `Pouring now · ${drinkOf(pouringOrder).name}`;
    } else if (q.awaitingContinue && q.entries.length > 0) {
      status.textContent = "Paused — put a fresh glass on the tray, then pour the next drink";
    } else if (q.entries.length > 0) {
      status.textContent = `${q.entries.length} drink${q.entries.length === 1 ? "" : "s"} waiting`;
    } else {
      status.textContent = "The queue is empty";
    }
    body.appendChild(status);

    const list = document.createElement("div");
    list.className = "queue-list";
    if (q.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "queue-empty";
      empty.textContent = "No drinks queued. Add one to get started.";
      list.appendChild(empty);
    } else {
      q.entries.forEach((entry, i) => list.appendChild(queueRow(entry, i)));
    }
    body.appendChild(list);

    // Footer actions.
    footer.innerHTML = "";
    const machineIdle = machine.status === "idle";

    if (machineIdle && q.entries.length > 0) {
      const next = drinkOf(q.entries[0].order);
      const cat = getCategoryById(next.category);
      const pourBtn = document.createElement("button");
      pourBtn.type = "button";
      pourBtn.className = "queue-pour-btn tappable";
      pourBtn.style.setProperty("--accent", cat?.accent || "var(--text-primary)");
      pourBtn.textContent = `Pour next · ${next.name}`;
      pourBtn.addEventListener("click", () => {
        pourBtn.disabled = true;
        continuing = true;
        continueQueue();
      });
      footer.appendChild(pourBtn);
    }

    const secondary = document.createElement("div");
    secondary.className = "queue-secondary";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "queue-secondary-btn tappable";
    addBtn.innerHTML = `${PLUS_SVG}<span>Add a drink</span>`;
    addBtn.addEventListener("click", () => navigate("category"));
    secondary.appendChild(addBtn);

    if (q.entries.length > 0) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "queue-secondary-btn queue-clear-btn tappable";
      clearBtn.textContent = "Clear queue";
      clearBtn.addEventListener("click", () => clearQueue());
      secondary.appendChild(clearBtn);
    }
    footer.appendChild(secondary);
  }

  let unsubs = [];
  let lastStatus = getMachineStatus().status;

  function cleanup() {
    for (const u of unsubs) u();
    unsubs = [];
  }

  render();

  return {
    element,
    mount() {
      // Re-render on any queue change. Machine status only re-renders on a
      // real idle/pouring flip — progress ticks leave the screen stable.
      unsubs.push(onQueueChange(render));
      unsubs.push(
        onMachineStatus((s) => {
          if (continuing && s.status === "pouring") {
            // We tapped "Pour next" — follow the pour onto the pouring screen.
            continuing = false;
            cleanup();
            queueMicrotask(() => replaceWith("pouring"));
            return;
          }
          if (s.status !== lastStatus) {
            lastStatus = s.status;
            render();
          }
        })
      );
    },
    unmount() {
      cleanup();
    },
  };
}
