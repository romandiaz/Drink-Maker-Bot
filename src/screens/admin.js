import { navigate } from "../app.js";
import { header } from "../components/header.js";
import { adminInventoryView } from "./admin-inventory.js";
import { adminRecipesView } from "./admin-recipes.js";

// Tab shell for the admin area. Holds a fixed header, a tab switcher, the
// active view's body, and a shared footer. Views own their own data fetching
// and render into a body element; mount/unmount cycle through the shell.

const TABS = [
  { id: "inventory", label: "Inventory", factory: adminInventoryView },
  { id: "recipes", label: "Recipes", factory: adminRecipesView },
];

export function admin() {
  const element = document.createElement("section");
  element.className = "screen screen--admin";
  element.dataset.screen = "admin";

  element.appendChild(
    header({
      back: true,
      onBack: () => navigate("idle", {}, "pop"),
      eyebrow: "Station 01",
      title: "Admin",
      right: "none",
    })
  );

  const tabs = document.createElement("div");
  tabs.className = "admin-tabs";
  element.appendChild(tabs);

  const viewHost = document.createElement("div");
  viewHost.className = "admin-view-host";
  element.appendChild(viewHost);

  const footer = document.createElement("footer");
  footer.className = "screen-footer";
  const meta = document.createElement("span");
  meta.className = "screen-footer__meta";
  const hint = document.createElement("span");
  hint.className = "screen-footer__hint";
  hint.textContent = "Changes save automatically";
  footer.append(meta, hint);
  element.appendChild(footer);

  function setMeta(text) {
    meta.textContent = text;
  }

  let activeView = null;
  let activeTabId = null;

  function switchTab(id) {
    if (activeTabId === id) return;
    activeView?.unmount?.();
    activeView = null;
    viewHost.innerHTML = "";
    activeTabId = id;
    renderTabs();

    const tab = TABS.find((t) => t.id === id);
    activeView = tab.factory({ host: element, setMeta });
    viewHost.appendChild(activeView.element);
    activeView.mount?.();
  }

  function renderTabs() {
    tabs.innerHTML = "";
    for (const t of TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-tab tappable";
      if (t.id === activeTabId) btn.classList.add("is-active");
      btn.textContent = t.label;
      btn.addEventListener("click", () => switchTab(t.id));
      tabs.appendChild(btn);
    }
  }

  function mount() {
    switchTab("inventory");
  }

  function unmount() {
    activeView?.unmount?.();
    activeView = null;
  }

  return { element, mount, unmount };
}
