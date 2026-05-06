// Wraps nmcli for the admin Network tab. Switches wlan0 between client mode
// (joining a saved WiFi network) and host mode (broadcasting an AP for guest
// phones). Localhost is unaffected by mode changes — the kiosk display keeps
// working through any switch.
//
// Requires the kiosk service user to have NOPASSWD sudo for nmcli:
//   pi ALL=(ALL) NOPASSWD: /usr/bin/nmcli
// Without that, every write call fails with a clear "sudo not configured"
// error surfaced to the admin UI.

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCb);
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const PREFS_PATH = resolve(STATE_DIR, "network-prefs.json");

const HOTSPOT_NAME = "Hotspot";
const DEFAULT_HOTSPOT_SSID = "DrinkBot";
const DEFAULT_HOTSPOT_PSK = "drinkbot";
const WLAN_DEV = "wlan0";

let prefs = null;

async function loadPrefs() {
  if (prefs) return prefs;
  if (!existsSync(PREFS_PATH)) return (prefs = { lastClientConnection: null });
  try {
    prefs = JSON.parse(await readFile(PREFS_PATH, "utf8"));
  } catch {
    prefs = { lastClientConnection: null };
  }
  return prefs;
}
async function savePrefs(patch) {
  prefs = { ...(await loadPrefs()), ...patch };
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(PREFS_PATH, JSON.stringify(prefs, null, 2), "utf8");
}

// nmcli's terse mode separates fields with `:`; literal `:` inside a value is
// escaped as `\:` and `\` as `\\`. Splitting naively breaks on IPv4 addrs
// like `192.168.1.5/24` (no colons) but mangles anything else. Walk char by
// char so `IP4.ADDRESS[1]` and IPv6 don't surprise us later.
function parseTerseLine(line) {
  const fields = [];
  let buf = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && (line[i + 1] === ":" || line[i + 1] === "\\")) {
      buf += line[++i];
    } else if (c === ":") {
      fields.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  fields.push(buf);
  return fields;
}

async function nmcli(args) {
  try {
    const { stdout } = await execFile("sudo", ["-n", "nmcli", ...args], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    const stderr = (e.stderr || "").trim();
    if (/sudo: a password is required/i.test(stderr) || /a terminal is required/i.test(stderr)) {
      throw new Error(
        "sudo not configured for nmcli — add 'pi ALL=(ALL) NOPASSWD: /usr/bin/nmcli' via visudo"
      );
    }
    if (stderr) throw new Error(stderr.split("\n")[0]);
    throw e;
  }
}

const SSID_RE = /^[\x20-\x7E]{1,32}$/;
const PSK_RE = /^.{8,63}$/;

function validateSsid(ssid) {
  if (typeof ssid !== "string" || !SSID_RE.test(ssid)) {
    throw new Error("invalid ssid (1-32 printable ASCII)");
  }
}
function validatePsk(psk) {
  if (typeof psk !== "string" || !PSK_RE.test(psk)) {
    throw new Error("invalid password (8-63 chars)");
  }
}

async function activeWifiConnection() {
  const out = await nmcli(["-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"]);
  for (const line of out.split("\n").filter(Boolean)) {
    const [name, type, device] = parseTerseLine(line);
    if (type === "802-11-wireless" && device === WLAN_DEV) return name;
  }
  return null;
}

async function connectionField(name, field) {
  const out = await nmcli(["-t", "-f", field, "connection", "show", name]);
  for (const line of out.split("\n").filter(Boolean)) {
    const fields = parseTerseLine(line);
    if (fields[0] === field) return fields.slice(1).join(":");
  }
  return "";
}

async function wlanIp() {
  try {
    const out = await nmcli(["-t", "-f", "IP4.ADDRESS", "device", "show", WLAN_DEV]);
    for (const line of out.split("\n").filter(Boolean)) {
      const [k, v] = parseTerseLine(line);
      if (k && k.startsWith("IP4.ADDRESS") && v) return v.split("/")[0];
    }
  } catch {}
  return null;
}

async function clientCount() {
  // Best-effort hotspot client count via `iw`. Not all images have iw, and
  // wlan0 only exposes stations when actually in AP mode — swallow either.
  try {
    const { stdout } = await execFile("iw", ["dev", WLAN_DEV, "station", "dump"], {
      timeout: 5000,
    });
    return (stdout.match(/^Station /gm) || []).length;
  } catch {
    return null;
  }
}

export async function getStatus() {
  const status = { mode: "off", connectionName: null, ssid: null, ip: null, clientCount: null };
  status.ip = await wlanIp();
  const active = await activeWifiConnection();
  if (!active) return status;
  status.connectionName = active;
  status.ssid = (await connectionField(active, "802-11-wireless.ssid")) || null;
  const wirelessMode = await connectionField(active, "802-11-wireless.mode");
  if (wirelessMode === "ap") {
    status.mode = "host";
    status.clientCount = await clientCount();
  } else {
    status.mode = "client";
  }
  return status;
}

async function listSavedRaw() {
  const out = await nmcli(["-t", "-f", "NAME,TYPE", "connection", "show"]);
  const list = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [name, type] = parseTerseLine(line);
    if (type !== "802-11-wireless") continue;
    let ssid = "";
    try { ssid = await connectionField(name, "802-11-wireless.ssid"); } catch {}
    list.push({ name, ssid });
  }
  return list;
}

export async function listSaved() {
  const list = await listSavedRaw();
  return list.map((c) => ({
    name: c.name,
    ssid: c.ssid,
    isHotspot: c.name === HOTSPOT_NAME,
    // netplan owns these — deleting them works at runtime but they reappear
    // on the next reboot or `netplan apply`, so the UI disables Forget.
    isProtected: c.name.startsWith("netplan-"),
  }));
}

export async function scan() {
  const out = await nmcli([
    "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY",
    "device", "wifi", "list", "--rescan", "auto",
  ]);
  const savedSsids = new Set(
    (await listSavedRaw()).filter((c) => c.ssid).map((c) => c.ssid)
  );
  // De-dupe by SSID, keep strongest signal — APs broadcast multiple BSSIDs.
  const bySsid = new Map();
  for (const line of out.split("\n").filter(Boolean)) {
    const [inUse, ssid, signal, security] = parseTerseLine(line);
    if (!ssid) continue;
    const sig = Number(signal) || 0;
    const prev = bySsid.get(ssid);
    if (prev && prev.signal >= sig) continue;
    bySsid.set(ssid, {
      ssid,
      signal: sig,
      security: security || "",
      inUse: inUse === "*",
      saved: savedSsids.has(ssid),
    });
  }
  return [...bySsid.values()].sort((a, b) => b.signal - a.signal);
}

export async function connectExisting(name) {
  if (!name || typeof name !== "string") throw new Error("invalid name");
  await nmcli(["connection", "up", name]);
  if (name !== HOTSPOT_NAME) await savePrefs({ lastClientConnection: name });
}

export async function connectNew(ssid, password) {
  validateSsid(ssid);
  if (password) validatePsk(password);
  const args = ["device", "wifi", "connect", ssid, "ifname", WLAN_DEV];
  if (password) args.push("password", password);
  await nmcli(args);
  await savePrefs({ lastClientConnection: ssid });
}

export async function forget(name) {
  if (!name || typeof name !== "string") throw new Error("invalid name");
  if (name === HOTSPOT_NAME) throw new Error("cannot forget hotspot");
  if (name.startsWith("netplan-")) {
    throw new Error("netplan-managed — edit /etc/netplan to remove permanently");
  }
  await nmcli(["connection", "delete", name]);
  const cur = await loadPrefs();
  if (cur.lastClientConnection === name) await savePrefs({ lastClientConnection: null });
}

export async function getHotspotConfig() {
  await ensureHotspotExists();
  const ssid = await connectionField(HOTSPOT_NAME, "802-11-wireless.ssid");
  // -s asks nmcli to include secrets — without it the PSK comes back blank.
  const out = await nmcli([
    "-s", "-t", "-f", "802-11-wireless-security.psk",
    "connection", "show", HOTSPOT_NAME,
  ]);
  let password = "";
  for (const line of out.split("\n").filter(Boolean)) {
    const fields = parseTerseLine(line);
    if (fields[0] === "802-11-wireless-security.psk") {
      password = fields.slice(1).join(":");
    }
  }
  return { ssid, password };
}

export async function setHotspotConfig({ ssid, password }) {
  await ensureHotspotExists();
  validateSsid(ssid);
  validatePsk(password);
  await nmcli([
    "connection", "modify", HOTSPOT_NAME,
    "802-11-wireless.ssid", ssid,
    "wifi-sec.psk", password,
  ]);
  // Bounce the AP if it's currently up so the new SSID/password take effect.
  const status = await getStatus();
  if (status.mode === "host") {
    await nmcli(["connection", "down", HOTSPOT_NAME]);
    await nmcli(["connection", "up", HOTSPOT_NAME]);
  }
}

export async function setMode(mode) {
  if (mode === "host") {
    await ensureHotspotExists();
    await nmcli(["connection", "up", HOTSPOT_NAME]);
    return;
  }
  if (mode === "client") {
    const target = await pickClientConnection();
    if (!target) throw new Error("no saved client network — add one first");
    await nmcli(["connection", "up", target]);
    await savePrefs({ lastClientConnection: target });
    return;
  }
  throw new Error("invalid mode");
}

async function pickClientConnection() {
  const cur = await loadPrefs();
  const saved = await listSavedRaw();
  const candidates = saved.filter((c) => c.name !== HOTSPOT_NAME);
  if (cur.lastClientConnection) {
    const m = candidates.find((c) => c.name === cur.lastClientConnection);
    if (m) return m.name;
  }
  // Fall back to the netplan-managed home network — that's the safety net the
  // user shipped the machine with.
  const fallback = candidates.find((c) => c.name.startsWith("netplan-")) || candidates[0];
  return fallback?.name || null;
}

async function ensureHotspotExists() {
  const saved = await listSavedRaw();
  if (saved.some((c) => c.name === HOTSPOT_NAME)) return;
  await nmcli([
    "connection", "add",
    "type", "wifi",
    "ifname", WLAN_DEV,
    "con-name", HOTSPOT_NAME,
    "autoconnect", "no",
    "ssid", DEFAULT_HOTSPOT_SSID,
    "802-11-wireless.mode", "ap",
    "802-11-wireless.band", "bg",
    "ipv4.method", "shared",
    "wifi-sec.key-mgmt", "wpa-psk",
    "wifi-sec.psk", DEFAULT_HOTSPOT_PSK,
  ]);
}
