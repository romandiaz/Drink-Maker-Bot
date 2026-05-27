// Captive portal intercept logic to keep mobile devices from routing traffic
// over cellular data when the machine is acting as a standalone AP.

// Well-known captive-portal probe paths. iOS, Android, and Windows all hit
// specific URLs after joining a network to detect whether they have real
// internet access. In Host mode we hijack their DNS to point here, so these
// requests land on us. First contact from a device gets a 302 to "/" so the
// OS pops its captive browser; subsequent probes from the same device return
// success once it's been "signed in" so the OS clears the captive flag and the
// user can use the kiosk in their regular browser (where WebSockets work).
const CAPTIVE_PROBE_PATHS = new Set([
  "/hotspot-detect.html",
  "/library/test/success.html",
  "/generate_204",
  "/gen_204",
  "/connecttest.txt",
  "/ncsi.txt",
  "/check_network_status.txt",
  "/canonical.html",
]);

// Apple-flavored probes look for a specific HTML body, not a 204. Returning
// 204 to these doesn't reliably clear iOS's captive flag on older versions.
const APPLE_PROBE_PATHS = new Set([
  "/hotspot-detect.html",
  "/library/test/success.html",
]);
const APPLE_SUCCESS_HTML =
  "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>";

// IPs that have loaded a real kiosk asset (not just a probe). Once an IP is
// in here, future probe responses tell the OS the network is healthy and the
// captive sandbox dismisses. Process-lifetime only — restart the backend and
// every device re-runs the captive flow, which is fine.
let signedInIPs = new Set();

function clientIp(req) {
  const raw = req.socket.remoteAddress || "";
  // Strip the IPv4-mapped IPv6 prefix Node uses on dual-stack sockets so
  // "::ffff:10.42.0.5" and "10.42.0.5" don't count as different devices.
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

export function markDeviceSignedIn(req) {
  signedInIPs.add(clientIp(req));
}

export function clearSignedInIPs() {
  signedInIPs = new Set();
}

// Intercept captive portal probes. Returns true if the request was handled.
export function handleCaptivePortal(req, res, urlPath) {
  if (!CAPTIVE_PROBE_PATHS.has(urlPath)) {
    return false;
  }

  if (signedInIPs.has(clientIp(req))) {
    // Tell the OS the network is healthy. Captive flag clears, sandbox
    // dismisses, the user's regular browser tab finishes loading.
    if (APPLE_PROBE_PATHS.has(urlPath)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(APPLE_SUCCESS_HTML);
    } else {
      res.writeHead(204);
      res.end();
    }
    return true;
  }

  // First probe from this device — pop the captive browser at the
  // welcome interstitial, not the kiosk itself. The interstitial bounces
  // the user out to a regular browser (Chrome via intent on Android,
  // Safari via NFC-queued tab on iOS).
  res.writeHead(302, { Location: "/welcome" });
  res.end();
  return true;
}
