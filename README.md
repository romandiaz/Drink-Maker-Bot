# Bartender Kiosk

Touchscreen UI for a home-built drink dispensing robot. Runs on a Raspberry Pi with the official 7" touchscreen (800×480).

## What's here

- `CLAUDE.md` — start here if you're using Claude Code to work on this project
- `docs/DESIGN_BRIEF.md` — full visual design system (colors, typography, photography, drink data)
- `docs/SCREENS.md` — per-screen behavior spec for all seven screens
- `src/` — frontend (HTML/CSS/JS) and backend (Node WebSocket server)

## Quickstart (on the Pi)

Target image: **Raspberry Pi OS Lite (32-bit)** on a Pi 3 B+ (or newer). On a fresh boot:

```bash
sudo apt update && sudo apt install -y git
git clone <this-repo> ~/bartender-kiosk
cd ~/bartender-kiosk
bash scripts/install-kiosk.sh
sudo reboot
```

The install script installs the minimal X stack, Node 20, and Chromium; configures tty1 autologin; and registers a systemd service for the backend. After reboot, the Pi boots straight into a fullscreen Chromium kiosk pointed at the local backend.

See `scripts/install-kiosk.sh` for details. Diagnostics:

```bash
systemctl status bartender-kiosk     # backend status
journalctl -u bartender-kiosk -f     # backend logs
```

## Network setup (admin Network tab + AP mode)

The admin Network tab lets a host switch the Pi between **Client** mode (joining a saved WiFi network) and **Host** mode (broadcasting a "DrinkBot" hotspot for guest phones). In Host mode a captive portal funnels any guest-phone HTTP traffic to the kiosk URL, so iOS and Android pop their built-in captive browsers automatically when a phone joins.

These features need three system-level changes. `scripts/install-network.sh` does all three:

```bash
bash scripts/install-network.sh
```

What it installs (idempotent — safe to re-run):

- `/etc/sudoers.d/nmcli-kiosk` — lets the kiosk user run `nmcli` without a password. The backend shells out to `nmcli` for every network operation; without this, the admin Network tab surfaces a clear "sudo not configured" error.
- `/etc/NetworkManager/dnsmasq-shared.d/captive.conf` — DNS hijack. Loaded by NM's shared-mode dnsmasq when Hotspot is active; resolves every DNS query from AP clients to the Pi's gateway IP (`10.42.0.1`).
- `/etc/NetworkManager/dispatcher.d/99-drinkbot-captive` — iptables dispatcher. When Hotspot comes up, redirects port 80 traffic to the kiosk on port 3000 and drops upstream forwarding (so guests can only reach the kiosk, not the wider internet).

After install, open admin → Network on the touchscreen. Tapping **Host** broadcasts `DrinkBot` (default password `drinkbot`, change it from the same screen). Tapping **Client** returns to your home WiFi.

Diagnostics:

```bash
journalctl -u NetworkManager -f          # NM events, dispatcher script errors
sudo iptables -t nat -L PREROUTING -n    # confirm the port-80 redirect is live
pgrep -af 'dnsmasq.*shared'              # confirm hijack dnsmasq is running
```

**SSH heads-up:** switching modes from any device connected to the Pi over WiFi will drop that connection (the radio changes networks). Run mode switches from the touchscreen, or keep an Ethernet cable plugged in for a stable SSH path during testing.

## Development

On a desktop, run the backend by hand and open the page in a browser:

```bash
npm install
npm run start
```

Then visit `http://localhost:3000` in a window sized to 800×480 (or use Chrome DevTools device emulation).

## Working with Claude Code

This project is structured for incremental development with Claude Code. Start by asking it to read `CLAUDE.md`, which points at everything else. Build order is suggested in that file under "What to build first".
