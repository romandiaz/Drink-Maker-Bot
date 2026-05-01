# Bartender Kiosk

Touchscreen UI for a home-built drink dispensing robot. Runs on a Raspberry Pi with the official 7" touchscreen (800×480).

## What's here

- `CLAUDE.md` — start here if you're using Claude Code to work on this project
- `docs/DESIGN_BRIEF.md` — full visual design system (colors, typography, photography, drink data)
- `docs/SCREENS.md` — per-screen behavior spec for all seven screens
- `src/` — frontend (HTML/CSS/JS) and backend (Node WebSocket server)

## Quickstart (on the Pi)

```bash
git clone <this-repo> bartender-kiosk
cd bartender-kiosk
npm install
npm run start
```

Then launch Chromium in kiosk mode:

```bash
chromium-browser --kiosk --disable-gpu --noerrdialogs http://localhost:3000
```

For auto-start at boot, see the autostart snippet in `CLAUDE.md`.

## Development

On a desktop, the same commands work — just open `http://localhost:3000` in a browser window sized to 800×480 (or use Chrome DevTools device emulation).

## Working with Claude Code

This project is structured for incremental development with Claude Code. Start by asking it to read `CLAUDE.md`, which points at everything else. Build order is suggested in that file under "What to build first".
