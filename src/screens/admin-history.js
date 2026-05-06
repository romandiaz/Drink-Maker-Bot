import { ingredientName } from "../ingredients.js";
import { getJSON, delJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { navigate } from "../app.js";
import { getDrinkById, getShotIngredientById } from "../drinks.js";
import { setBuildDraft } from "../state.js";

// Resolve a history entry to a click action. Regular drinks open detail;
// shot entries (id shape `shot-{ingredientId}-{volume}`) open shotDetail;
// custom build-your-own pours seed the draft and open buildYourOwn so the
// admin (or curious guest) can re-pour or tweak the recipe. Ingredient IDs
// themselves contain hyphens (e.g. lime-juice), so we anchor the shot regex
// on the trailing decimal volume rather than splitting on `-`.
const SHOT_ID_RE = /^shot-(.+)-(\d+\.\d+)$/;

function resolveTarget(entry) {
  const id = entry.drinkId;
  if (!id) return null;
  if (getDrinkById(id)) {
    return { run: () => navigate("detail", { drinkId: id }) };
  }
  const shotMatch = SHOT_ID_RE.exec(id);
  if (shotMatch && getShotIngredientById(shotMatch[1])) {
    return {
      run: () => navigate("shotDetail", { ingredientId: shotMatch[1] }),
    };
  }
  if (id.startsWith("custom-")) {
    return {
      run: () => {
        // Strip the "Custom drink" placeholder so the user lands on the same
        // unnamed-state buildYourOwn shows for a fresh draft. A real guest
        // name (the rare ones who tap "Name your drink") is preserved.
        const name = entry.drinkName === "Custom drink" ? "" : entry.drinkName;
        setBuildDraft({ name, ingredients: entry.ingredients });
        navigate("buildYourOwn");
      },
    };
  }
  return null;
}

// History tab — raw log of completed pours, newest first. The backend caps
// at 500 rolling entries, so we render every row we get without paging. A
// single "Clear all" button at the top wipes the log via DELETE /api/history;
// it uses the same two-tap confirm pattern as the Submissions tab's discard
// button so an accidental tap can't blow away the log.

function timeLabel(iso) {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  // Older than a day: show a compact absolute date so the admin can spot
  // session boundaries without doing relative-day math in their head.
  const d = new Date(ts);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${month} ${day} · ${time}`;
}

function ingredientsSummary(ings) {
  if (!ings || ings.length === 0) return "—";
  return ings
    .map((i) => `${i.volumeOz} oz ${ingredientName(i.name)}`)
    .join(" · ");
}

function historyRow(entry) {
  const target = resolveTarget(entry);
  const row = document.createElement(target ? "button" : "div");
  row.className = "history-row";
  if (target) {
    row.type = "button";
    row.classList.add("history-row--tappable", "tappable");
    row.addEventListener("click", target.run);
  }

  const head = document.createElement("div");
  head.className = "history-row__head";
  const name = document.createElement("div");
  name.className = "history-row__name";
  name.textContent = entry.drinkName || entry.drinkId || "Unknown";
  const time = document.createElement("div");
  time.className = "history-row__time";
  time.textContent = timeLabel(entry.ts);
  head.append(name, time);
  row.appendChild(head);

  const body = document.createElement("div");
  body.className = "history-row__body";
  body.textContent = ingredientsSummary(entry.ingredients);
  row.appendChild(body);

  return row;
}

export function adminHistoryView({ setMeta }) {
  const element = document.createElement("div");
  element.className = "admin-body admin-body--history";

  let entries = [];
  let clearConfirmTimer = null;

  function updateMeta() {
    const n = entries.length;
    setMeta(`${n} pour${n === 1 ? "" : "s"} logged`);
  }

  function render() {
    element.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "history-toolbar";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "history-toolbar__clear tappable";
    clearBtn.textContent = "Clear all";
    clearBtn.disabled = entries.length === 0;
    let confirming = false;
    clearBtn.addEventListener("click", () => {
      if (entries.length === 0) return;
      if (!confirming) {
        confirming = true;
        clearBtn.textContent = "Tap again to clear";
        clearBtn.classList.add("is-confirming");
        clearConfirmTimer = setTimeout(() => {
          confirming = false;
          clearBtn.textContent = "Clear all";
          clearBtn.classList.remove("is-confirming");
          clearConfirmTimer = null;
        }, 3000);
        return;
      }
      if (clearConfirmTimer) {
        clearTimeout(clearConfirmTimer);
        clearConfirmTimer = null;
      }
      onClear();
    });
    toolbar.appendChild(clearBtn);

    element.appendChild(toolbar);

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "No pours yet.";
      const sub = document.createElement("div");
      sub.className = "history-empty__sub";
      sub.textContent = "Completed pours will appear here.";
      empty.appendChild(sub);
      element.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "history-list";
      for (const e of entries) list.appendChild(historyRow(e));
      element.appendChild(list);
    }

    updateMeta();
  }

  async function refresh() {
    try {
      const data = await getJSON("/api/history");
      entries = Array.isArray(data.entries) ? data.entries : [];
    } catch (e) {
      entries = [];
      showToast(`Couldn't load history — ${e.message}`);
    }
    render();
  }

  async function onClear() {
    try {
      setMeta("Clearing…");
      await delJSON("/api/history");
      await refresh();
      showToast("History cleared", { variant: "info", duration: 2500 });
    } catch (e) {
      console.error(e);
      setMeta(`Clear failed — ${e.message}`);
      showToast(`Clear failed — ${e.message}`);
    }
  }

  function mount() {
    refresh();
  }

  function unmount() {
    if (clearConfirmTimer) {
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = null;
    }
  }

  return { element, mount, unmount };
}
