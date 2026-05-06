import { header, notificationsButton, readyIndicator } from "../components/header.js";
import { adminDashboardView } from "./admin-dashboard.js";
import { adminInventoryView } from "./admin-inventory.js";
import { adminRecipesView } from "./admin-recipes.js";
import { adminSubmissionsView } from "./admin-submissions.js";
import { adminMaintenanceView } from "./admin-maintenance.js";
import { adminHistoryView } from "./admin-history.js";
import { adminNetworkView } from "./admin-network.js";

// Tab shell for the admin area. Holds a fixed header, a tab switcher, the
// active view's body, and a shared footer. Views own their own data fetching
// and render into a body element; mount/unmount cycle through the shell.
// `hint` is the right-aligned footer string; the dashboard has nothing to
// save, so the autosave promise only shows on the editing tabs.

const TABS = [
  { id: "dashboard", label: "Dashboard", factory: adminDashboardView, hint: "Tap a card for details" },
  { id: "inventory", label: "Inventory", factory: adminInventoryView, hint: "Changes save automatically" },
  { id: "recipes", label: "Recipes", factory: adminRecipesView, hint: "Changes save automatically" },
  { id: "submissions", label: "Submissions", factory: adminSubmissionsView, hint: "Promote guest builds into the catalog" },
  { id: "history", label: "History", factory: adminHistoryView, hint: "Newest pours first · capped at 500" },
  { id: "maintenance", label: "Maintenance", factory: adminMaintenanceView, hint: "Routines run on the live machine" },
  { id: "network", label: "Network", factory: adminNetworkView, hint: "Switch wlan0 between client and host mode" },
];

export function admin() {
  const element = document.createElement("section");
  element.className = "screen screen--admin";
  element.dataset.screen = "admin";

  // Right slot composes the bell (entry to the standalone Notifications
  // screen) alongside the ready indicator. Notifications used to be a tab —
  // moved out to keep the admin tab strip from running off the edge.
  const headerRight = document.createElement("div");
  headerRight.className = "header-right-cluster";
  headerRight.append(notificationsButton(), readyIndicator());

  element.appendChild(
    header({
      back: true,
      eyebrow: "Station 01",
      title: "Admin",
      right: headerRight,
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
    hint.textContent = tab.hint || "";
    activeView = tab.factory({ host: element, setMeta, onSwitchTab: switchTab });
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
    switchTab("dashboard");
  }

  function unmount() {
    activeView?.unmount?.();
    activeView = null;
  }

  return { element, mount, unmount };
}
