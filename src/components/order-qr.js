// Idle-screen card that gets guests onto the mobile order page.
//
// Shown ONLY when the machine is running its own AP (network mode "host").
// The code is a "WIFI:" join string, not a URL: the whole point is the guest
// who hasn't joined the network yet, and their phone can't reach the Pi at
// all, so the code has to hand over credentials first. iOS 11+ and Android
// read this format natively from the camera app; joining trips the captive
// portal, which lands them on welcome.html and onward to /order.
//
// Every other network state renders nothing. That includes client mode, where
// the Pi is on the house Wi-Fi and a plain URL to /order would in fact work —
// guests there are already on the network. Suppressing it is a deliberate
// call for a quieter attract screen: on a home network the people using the
// machine are the ones who set it up, so the discovery problem the QR solves
// isn't really there. Re-adding that branch means an ip + port lookup from
// /api/network/status and a `http://<ip>:<port>/order` payload.
//
// The payload is read once per mount. A network-mode change mid-idle won't be
// picked up, which is fine: changing it means going through the admin Network
// tab, and coming back out of admin re-mounts idle.

import { getJSON } from "../api.js";
import { qrSvg } from "./qr.js";

const QR_PX = 112;

// The Wi-Fi QR grammar treats \ ; , : and " as structural, so any of them
// inside an SSID or passphrase has to be backslash-escaped.
function escapeWifi(value) {
  return String(value).replace(/([\\;,:"])/g, "\\$1");
}

function wifiJoinString(ssid, password) {
  const type = password ? "WPA" : "nopass";
  const pass = password ? `P:${escapeWifi(password)};` : "";
  return `WIFI:T:${type};S:${escapeWifi(ssid)};${pass};`;
}

async function resolvePayload() {
  const status = await getJSON("/api/network/status");
  if (status?.mode !== "host") return null;

  const hotspot = await getJSON("/api/network/hotspot");
  if (!hotspot?.ssid) return null;
  return {
    text: wifiJoinString(hotspot.ssid, hotspot.password),
    caption: "Scan to join",
    detail: hotspot.ssid,
  };
}

// Returns an element immediately and fills it in once the network state is
// known — the idle screen mounts synchronously and shouldn't wait on a fetch.
// Stays hidden unless there's something genuinely scannable to show.
export function orderQrCard() {
  const card = document.createElement("div");
  card.className = "idle-qr";
  card.hidden = true;

  resolvePayload()
    .then((payload) => {
      if (!payload) return;
      card.appendChild(qrSvg(payload.text, { size: QR_PX, quiet: 2 }));

      const caption = document.createElement("div");
      caption.className = "idle-qr__caption";
      caption.textContent = payload.caption;
      card.appendChild(caption);

      const detail = document.createElement("div");
      detail.className = "idle-qr__detail";
      // Also readable by anyone who'd rather join or type it by hand.
      detail.textContent = payload.detail;
      card.appendChild(detail);

      card.hidden = false;
    })
    .catch(() => {
      // No network API (dev server), nmcli missing, or the call failed. A
      // missing QR is not worth surfacing an error on the attract screen.
    });

  return card;
}
