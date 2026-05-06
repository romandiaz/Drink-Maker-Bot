// Admin Network tab. Switches wlan0 between client mode (saved WiFi network)
// and host mode (broadcasts the kiosk hotspot for guest phones). The kiosk
// loads localhost so the touchscreen stays up through any switch — SSH
// sessions over wlan0 will drop, ethernet sessions won't.

import { getJSON, postJSON, putJSON, delJSON } from "../api.js";
import { showToast } from "../components/toast.js";
import { keyboard } from "../components/keyboard.js";

export function adminNetworkView({ host, setMeta }) {
  const element = document.createElement("div");
  element.className = "admin-body admin-body--network";

  let status = null;
  let scanList = null;
  let saved = null;
  let hotspotConfig = null;
  let busy = false;
  let pollTimer = null;
  let modalEl = null;

  function setBusy(v) {
    busy = v;
    element.classList.toggle("is-busy", v);
    for (const b of element.querySelectorAll(".net-btn")) {
      if (!b.dataset.alwaysEnabled) b.disabled = v;
    }
  }

  async function refreshStatus() {
    try { status = await getJSON("/api/network/status"); render(); }
    catch (e) { console.error(e); }
  }

  async function refreshAll() {
    setMeta("Loading…");
    try {
      [status, saved, hotspotConfig] = await Promise.all([
        getJSON("/api/network/status"),
        getJSON("/api/network/saved"),
        getJSON("/api/network/hotspot"),
      ]);
      // Scan only in client mode — the radio is busy as an AP in host mode.
      if (status.mode !== "host") {
        try { scanList = await getJSON("/api/network/scan"); }
        catch (e) { console.error(e); scanList = []; }
      } else {
        scanList = null;
      }
      render();
    } catch (e) {
      console.error(e);
      setMeta("Failed to load");
      showToast(`Network — ${e.message}`);
    }
  }

  function updateMeta() {
    if (!status) return;
    if (status.mode === "host") {
      const n = status.clientCount;
      setMeta(`Host · ${status.ssid || "—"}${n != null ? ` · ${n} connected` : ""}`);
    } else if (status.mode === "client") {
      setMeta(`Client · ${status.ssid || "—"} · ${status.ip || "no ip"}`);
    } else {
      setMeta("WiFi off");
    }
  }

  // --- Mode toggle ---

  function modeToggle() {
    const wrap = document.createElement("div");
    wrap.className = "net-mode-toggle";
    for (const m of [
      { id: "client", label: "Client" },
      { id: "host", label: "Host" },
    ]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "net-mode net-btn tappable";
      btn.dataset.alwaysEnabled = "1";
      if (status?.mode === m.id) btn.classList.add("is-active");
      btn.textContent = m.label;
      btn.addEventListener("click", () => switchMode(m.id));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  async function switchMode(mode) {
    if (status?.mode === mode || busy) return;
    setBusy(true);
    setMeta(mode === "host" ? "Switching to host…" : "Switching to client…");
    try {
      await postJSON("/api/network/mode", { mode });
      await refreshAll();
    } catch (e) {
      showToast(`Switch failed — ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // --- Client view ---

  function clientView() {
    const frag = document.createDocumentFragment();

    const cur = card("Current connection");
    if (status.mode === "client" && status.ssid) {
      cur.appendChild(kv("Network", status.ssid));
      cur.appendChild(kv("IP address", status.ip || "—"));
    } else {
      cur.appendChild(emptyP("Not connected to any WiFi network."));
    }
    frag.appendChild(cur);

    const av = document.createElement("section");
    av.className = "net-card";
    const head = document.createElement("div");
    head.className = "net-section-head net-section-head--row";
    const t = document.createElement("div");
    t.className = "net-section-head__title";
    t.textContent = "Available networks";
    head.appendChild(t);
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "net-btn net-btn--ghost tappable";
    refresh.dataset.alwaysEnabled = "1";
    refresh.textContent = "Rescan";
    refresh.addEventListener("click", rescan);
    head.appendChild(refresh);
    av.appendChild(head);

    if (!scanList || scanList.length === 0) {
      av.appendChild(emptyP(scanList ? "No networks found." : "Scanning…"));
    } else {
      const list = document.createElement("div");
      list.className = "net-list";
      for (const n of scanList) list.appendChild(networkRow(n));
      av.appendChild(list);
    }
    frag.appendChild(av);

    const others = (saved || []).filter((c) => !c.isHotspot);
    if (others.length > 0) {
      const sv = card("Saved networks");
      const sl = document.createElement("div");
      sl.className = "net-list";
      for (const c of others) sl.appendChild(savedRow(c));
      sv.appendChild(sl);
      frag.appendChild(sv);
    }

    return frag;
  }

  function networkRow(n) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "net-row net-btn tappable";
    if (n.inUse) row.classList.add("is-current");

    const left = document.createElement("div");
    left.className = "net-row__left";
    const name = document.createElement("div");
    name.className = "net-row__name";
    name.textContent = n.ssid;
    left.appendChild(name);
    const meta = document.createElement("div");
    meta.className = "net-row__meta";
    const bits = [];
    if (n.saved) bits.push("Saved");
    bits.push(n.security ? n.security.split(" ")[0] : "Open");
    bits.push(`${signalBars(n.signal)} ${n.signal}%`);
    meta.textContent = bits.join(" · ");
    left.appendChild(meta);
    row.appendChild(left);

    row.addEventListener("click", () => {
      if (n.inUse) return;
      const isOpen = !n.security;
      if (n.saved || isOpen) {
        connectFromScan(n);
      } else {
        openTextModal({
          title: `Connect to ${n.ssid}`,
          submitLabel: "Connect",
          password: true,
          onSubmit: async (psk) => {
            setBusy(true);
            try {
              await postJSON("/api/network/connect", { ssid: n.ssid, password: psk });
              showToast(`Connected to ${n.ssid}`, { variant: "info" });
              await refreshAll();
            } catch (e) {
              showToast(`Connect failed — ${e.message}`);
            } finally { setBusy(false); }
          },
        });
      }
    });
    return row;
  }

  async function connectFromScan(n) {
    setBusy(true);
    try {
      const savedConn = (saved || []).find((c) => c.ssid === n.ssid && !c.isHotspot);
      if (savedConn) await postJSON("/api/network/connect", { name: savedConn.name });
      else await postJSON("/api/network/connect", { ssid: n.ssid });
      showToast(`Connected to ${n.ssid}`, { variant: "info" });
      await refreshAll();
    } catch (e) {
      showToast(`Connect failed — ${e.message}`);
    } finally { setBusy(false); }
  }

  function savedRow(c) {
    const row = document.createElement("div");
    row.className = "net-saved-row";
    const name = document.createElement("div");
    name.className = "net-saved-row__name";
    name.textContent = c.ssid || c.name;
    row.appendChild(name);

    if (c.isProtected) {
      const note = document.createElement("span");
      note.className = "net-saved-row__note";
      note.textContent = "system";
      row.appendChild(note);
    } else {
      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "net-btn net-btn--warn tappable";
      forget.textContent = "Forget";
      forget.addEventListener("click", async () => {
        setBusy(true);
        try {
          await delJSON(`/api/network/saved/${encodeURIComponent(c.name)}`);
          await refreshAll();
        } catch (e) {
          showToast(`Forget failed — ${e.message}`);
        } finally { setBusy(false); }
      });
      row.appendChild(forget);
    }
    return row;
  }

  // --- Host view ---

  function hostView() {
    const frag = document.createDocumentFragment();
    const c = card("Hotspot", "Guests connect to this network");

    c.appendChild(editableRow("SSID", hotspotConfig.ssid, () => {
      openTextModal({
        title: "Hotspot name (SSID)",
        initial: hotspotConfig.ssid,
        submitLabel: "Save",
        onSubmit: (newSsid) => saveHotspot({ ssid: newSsid, password: hotspotConfig.password }),
      });
    }));
    c.appendChild(editableRow("Password", hotspotConfig.password, () => {
      openTextModal({
        title: "Hotspot password",
        initial: hotspotConfig.password,
        submitLabel: "Save",
        password: true,
        onSubmit: (newPw) => saveHotspot({ ssid: hotspotConfig.ssid, password: newPw }),
      });
    }));

    if (status.mode === "host") {
      c.appendChild(kv("Kiosk URL", `http://${status.ip || "10.42.0.1"}:3000`));
      if (status.clientCount != null) {
        const noun = status.clientCount === 1 ? "device" : "devices";
        c.appendChild(kv("Connected", `${status.clientCount} ${noun}`));
      }
    } else {
      c.appendChild(noteP("Switch to Host mode to broadcast this network."));
    }
    frag.appendChild(c);
    return frag;
  }

  async function saveHotspot(cfg) {
    setBusy(true);
    try {
      await putJSON("/api/network/hotspot", cfg);
      showToast("Hotspot updated", { variant: "info" });
      await refreshAll();
    } catch (e) {
      showToast(`Save failed — ${e.message}`);
    } finally { setBusy(false); }
  }

  // --- Layout helpers ---

  function card(title, subtitle) {
    const c = document.createElement("section");
    c.className = "net-card";
    const head = document.createElement("div");
    head.className = "net-section-head";
    const t = document.createElement("div");
    t.className = "net-section-head__title";
    t.textContent = title;
    head.appendChild(t);
    if (subtitle) {
      const s = document.createElement("div");
      s.className = "net-section-head__sub";
      s.textContent = subtitle;
      head.appendChild(s);
    }
    c.appendChild(head);
    return c;
  }

  function kv(label, value) {
    const w = document.createElement("div");
    w.className = "net-kv";
    const l = document.createElement("span");
    l.className = "net-kv__label"; l.textContent = label;
    const v = document.createElement("span");
    v.className = "net-kv__value"; v.textContent = value;
    w.append(l, v);
    return w;
  }

  function editableRow(label, value, onEdit) {
    const w = document.createElement("div");
    w.className = "net-edit-row";
    const l = document.createElement("span");
    l.className = "net-edit-row__label"; l.textContent = label;
    const v = document.createElement("span");
    v.className = "net-edit-row__value"; v.textContent = value || "—";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "net-btn tappable"; btn.textContent = "Change";
    btn.addEventListener("click", onEdit);
    w.append(l, v, btn);
    return w;
  }

  function emptyP(text) {
    const p = document.createElement("p");
    p.className = "net-empty"; p.textContent = text;
    return p;
  }
  function noteP(text) {
    const p = document.createElement("p");
    p.className = "net-note"; p.textContent = text;
    return p;
  }

  function signalBars(s) {
    if (s >= 75) return "▮▮▮▮";
    if (s >= 50) return "▮▮▮▯";
    if (s >= 25) return "▮▮▯▯";
    return "▮▯▯▯";
  }

  // --- Modal: text input via on-screen keyboard ---

  function openTextModal({ title, initial = "", submitLabel = "Save", password = false, onSubmit }) {
    if (modalEl) modalEl.remove();
    let value = initial;
    const overlay = document.createElement("div");
    overlay.className = "admin-picker net-modal";
    const panel = document.createElement("div");
    panel.className = "net-modal__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    const heading = document.createElement("div");
    heading.className = "admin-picker__title";
    heading.textContent = title;
    panel.appendChild(heading);

    const display = document.createElement("div");
    display.className = "net-modal__display";
    function paint() {
      display.textContent = password ? ("•".repeat(value.length) || "—") : (value || "—");
    }
    paint();
    panel.appendChild(display);

    panel.appendChild(keyboard({
      extended: true,
      onLetter: (ch) => { value += ch; paint(); },
      onBackspace: () => { value = value.slice(0, -1); paint(); },
    }));

    const actions = document.createElement("div");
    actions.className = "net-modal__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "net-btn tappable";
    cancel.dataset.alwaysEnabled = "1";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", close);
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "net-btn net-btn--primary tappable";
    submit.dataset.alwaysEnabled = "1";
    submit.textContent = submitLabel;
    submit.addEventListener("click", () => { close(); Promise.resolve(onSubmit(value)).catch(() => {}); });
    actions.append(cancel, submit);
    panel.appendChild(actions);

    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    function close() { overlay.remove(); if (modalEl === overlay) modalEl = null; }

    host.appendChild(overlay);
    modalEl = overlay;
  }

  // --- Lifecycle ---

  async function rescan() {
    if (!status || status.mode === "host") return;
    try {
      scanList = await getJSON("/api/network/scan");
      render();
    } catch (e) {
      showToast(`Scan failed — ${e.message}`);
    }
  }

  function render() {
    element.innerHTML = "";
    if (!status || !saved || !hotspotConfig) return;
    element.appendChild(modeToggle());
    element.appendChild(status.mode === "host" ? hostView() : clientView());
    updateMeta();
  }

  function mount() {
    refreshAll();
    // Refresh status every 10s — picks up signal/IP drift and the connected
    // client count in host mode without forcing the user to leave/return.
    pollTimer = setInterval(refreshStatus, 10000);
  }

  function unmount() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (modalEl) { modalEl.remove(); modalEl = null; }
  }

  return { element, mount, unmount };
}
