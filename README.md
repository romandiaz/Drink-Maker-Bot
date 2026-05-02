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

## Development

On a desktop, run the backend by hand and open the page in a browser:

```bash
npm install
npm run start
```

Then visit `http://localhost:3000` in a window sized to 800×480 (or use Chrome DevTools device emulation).

## Working with Claude Code

This project is structured for incremental development with Claude Code. Start by asking it to read `CLAUDE.md`, which points at everything else. Build order is suggested in that file under "What to build first".
