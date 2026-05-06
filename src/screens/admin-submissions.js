import { ingredientName } from "../ingredients.js";
import { drinkEditor } from "../components/drink-editor.js";
import { navigate, reloadDrinks } from "../app.js";
import { getJSON, postJSON, delJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { setBuildDraft } from "../state.js";

// Submissions tab — guest-built recipes from the "Build your own" screen.
// Each row offers Promote (opens the recipe editor pre-filled, then POSTs
// /api/submissions/:id/promote which adds the drink and removes the submission)
// and Discard (DELETE /api/submissions/:id).

const submissionUrl = (id) => `/api/submissions/${encodeURIComponent(id)}`;
const promoteUrl = (id) => `${submissionUrl(id)}/promote`;

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function ingredientsSummary(ings) {
  return ings
    .map((i) => `${i.volumeOz}oz ${ingredientName(i.name)}`)
    .join(" · ");
}

function submissionCard(sub, { onPromote, onDiscard, onOpen }) {
  const card = document.createElement("div");
  card.className = "submission-card";

  // Tap target wraps name+ingredients so the recipe area opens in
  // build-your-own without colliding with the Discard/Promote buttons below.
  // The admin actions stay outside this button — buttons can't legally nest.
  const tap = document.createElement("button");
  tap.type = "button";
  tap.className = "submission-card__tap tappable";
  tap.addEventListener("click", () => onOpen(sub));

  const head = document.createElement("div");
  head.className = "submission-card__head";
  const name = document.createElement("div");
  name.className = "submission-card__name";
  name.textContent = sub.name;
  const age = document.createElement("div");
  age.className = "submission-card__age";
  age.textContent = timeAgo(sub.createdAt);
  head.append(name, age);
  tap.appendChild(head);

  const body = document.createElement("div");
  body.className = "submission-card__body";
  body.textContent = ingredientsSummary(sub.ingredients);
  tap.appendChild(body);

  card.appendChild(tap);

  const actions = document.createElement("div");
  actions.className = "submission-card__actions";

  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "submission-card__btn submission-card__btn--ghost tappable";
  discard.textContent = "Discard";
  // Two-tap confirmation matches the recipe editor's delete pattern — first
  // tap arms, second commits, auto-resets after 3s.
  let confirming = false;
  discard.addEventListener("click", () => {
    if (!confirming) {
      confirming = true;
      discard.textContent = "Tap again to discard";
      discard.classList.add("is-confirming");
      setTimeout(() => {
        confirming = false;
        discard.textContent = "Discard";
        discard.classList.remove("is-confirming");
      }, 3000);
      return;
    }
    onDiscard(sub);
  });

  const promote = document.createElement("button");
  promote.type = "button";
  promote.className = "submission-card__btn submission-card__btn--primary tappable";
  promote.textContent = "Promote →";
  promote.addEventListener("click", () => onPromote(sub));

  actions.append(discard, promote);
  card.appendChild(actions);
  return card;
}

export function adminSubmissionsView({ host, setMeta, onSwitchTab }) {
  const element = document.createElement("div");
  element.className = "admin-body admin-body--submissions";

  let submissions = [];
  let editorEl = null;

  function updateMeta() {
    const n = submissions.length;
    setMeta(`${n} submission${n === 1 ? "" : "s"}`);
  }

  function render() {
    element.innerHTML = "";

    if (submissions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "submissions-empty";
      empty.textContent = "No submissions yet.";
      const sub = document.createElement("div");
      sub.className = "submissions-empty__sub";
      sub.textContent = "Guest-built drinks will appear here for review.";
      empty.appendChild(sub);
      element.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "submissions-list";
      for (const s of submissions) {
        list.appendChild(
          submissionCard(s, { onPromote: openPromote, onDiscard, onOpen }),
        );
      }
      element.appendChild(list);
    }

    updateMeta();
  }

  async function refresh() {
    try {
      const data = await getJSON("/api/submissions");
      submissions = Array.isArray(data.submissions) ? data.submissions : [];
    } catch (e) {
      submissions = [];
      showToast(`Couldn't load submissions — ${e.message}`);
    }
    render();
  }

  function closeEditor() {
    editorEl?.remove();
    editorEl = null;
  }

  function openPromote(sub) {
    closeEditor();
    // Strip id so drinkEditor's onSave behaves as a "create" (its routing key
    // is draft.id). We invoke the promote endpoint instead of /api/drinks
    // directly so the submission is removed atomically with the drink create.
    const seed = { ...sub, id: null };
    editorEl = drinkEditor({
      drink: seed,
      title: "Promote submission",
      onCancel: closeEditor,
      onSave: async (draft) => {
        try {
          setMeta("Promoting…");
          await postJSON(promoteUrl(sub.id), draft);
          await reloadDrinks();
          closeEditor();
          await refresh();
          showToast(`Promoted "${draft.name}" to recipes`);
          // Drop the user back into the Recipes tab so they can see the
          // newly-added drink in context.
          onSwitchTab?.("recipes");
        } catch (e) {
          console.error(e);
          setMeta(`Promote failed — ${e.message}`);
          showToast(`Promote failed — ${e.message}`);
        }
      },
    });
    host.appendChild(editorEl);
  }

  function onOpen(sub) {
    // Seed the live build-your-own draft from the submission and jump there.
    // The submission stays in the list — opening it is non-destructive; only
    // Discard removes it.
    setBuildDraft({ name: sub.name, ingredients: sub.ingredients });
    navigate("buildYourOwn");
  }

  async function onDiscard(sub) {
    try {
      setMeta("Discarding…");
      await delJSON(submissionUrl(sub.id));
      await refresh();
    } catch (e) {
      console.error(e);
      setMeta(`Discard failed — ${e.message}`);
      showToast(`Discard failed — ${e.message}`);
    }
  }

  function mount() {
    refresh();
  }

  function unmount() {
    closeEditor();
  }

  return { element, mount, unmount };
}
