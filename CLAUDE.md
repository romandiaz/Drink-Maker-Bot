# Bartender Kiosk — Claude Code Project Guide

This file tells Claude Code how to work on this project. Read `docs/DESIGN_BRIEF.md` first for the full visual spec; this file covers engineering conventions, architecture, and constraints.

## What this is

A touchscreen kiosk UI for a home-built drink dispensing robot. The UI runs fullscreen in a browser on a Raspberry Pi with a 7" touchscreen. Users pick a drink; the robot pours the correct ingredients.

## Hardware target (non-negotiable)

- **Device:** Raspberry Pi (any model with DSI, typically Pi 4 or 5)
- **Display:** Official Raspberry Pi 7" Touch Screen
- **Resolution:** exactly `800 × 480` pixels
- **Orientation:** landscape
- **Touch:** 10-finger capacitive, no mouse or keyboard
- **Browser:** Chromium in kiosk mode (fullscreen, no chrome, no cursor)

Every layout decision assumes this resolution. Never design for responsive resizing — this screen is fixed.

## Tech stack

- **Plain HTML/CSS/JS.** No framework. This runs on a Pi; we want cold-start under 2 seconds and no build step for rapid iteration. If complexity grows, we'll reconsider, but start here.
- **Single-page app.** All screens live in one document; transitions are CSS-driven show/hide with `display` and `opacity`.
- **No external dependencies** except for one optional web font load. No React, no Vue, no Tailwind, no bundler. Vanilla.
- **State management:** a single `appState` object in `src/state.js`, updated by explicit action functions. No reactive framework.
- **Serial communication with the robot:** via a small Node.js backend at `src/server/` that exposes a WebSocket. The frontend sends pour commands; the backend translates them to serial/GPIO. Don't implement the robot control yet — stub it with a `mockPour()` that resolves after a realistic delay.

## Project structure

```
bartender-kiosk/
├── CLAUDE.md                    ← this file
├── README.md                    ← human-facing quickstart
├── docs/
│   ├── DESIGN_BRIEF.md          ← full visual spec (read this!)
│   └── SCREENS.md               ← per-screen behavior spec
├── src/
│   ├── index.html               ← single entry point, all screens
│   ├── styles.css               ← global styles, design tokens
│   ├── app.js                   ← bootstrap, screen routing
│   ├── state.js                 ← appState + action fns
│   ├── drinks.js                ← drink + category data
│   ├── screens/
│   │   ├── idle.js
│   │   ├── category.js
│   │   ├── search.js
│   │   ├── drink-list.js
│   │   ├── detail.js
│   │   ├── pouring.js
│   │   └── complete.js
│   ├── components/
│   │   ├── glass.js             ← SVG glass renderer (placeholder until photos)
│   │   ├── keyboard.js          ← on-screen QWERTY
│   │   └── header.js            ← station header w/ ready indicator
│   ├── server/
│   │   ├── index.js             ← Node backend, WebSocket
│   │   └── pour.js              ← mockPour() now, real pour later
│   └── assets/
│       └── drinks/              ← photos go here (16 files, see brief)
└── package.json                 ← just for the backend
```

## Design tokens (CSS custom properties)

Put these in `:root` in `styles.css`. Everything else references them — never hardcode a color in a component.

```css
:root {
  /* Backgrounds */
  --bg-primary: #0a0a0a;
  --bg-surface: #141414;
  --bg-surface-2: #1a1a1a;
  --bg-surface-dim: #0f0f0f;

  /* Text */
  --text-primary: #f5f5f5;
  --text-secondary: #888;
  --text-tertiary: #666;
  --text-quaternary: #555;
  --text-disabled: #444;

  /* Borders */
  --border-default: rgba(255,255,255,0.08);
  --border-emphasis: rgba(255,255,255,0.15);
  --border-strong: rgba(255,255,255,0.2);
  --border-divider: rgba(255,255,255,0.1);

  /* Status */
  --status-ready: #4ade80;

  /* Category accents */
  --accent-classics: #D4A574;
  --accent-refreshers: #5DCAA5;
  --accent-sours: #F0C040;
  --accent-party: #E85D9B;

  /* Layout */
  --radius-sm: 3px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-pill: 999px;

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}

html, body {
  width: 800px;
  height: 480px;
  overflow: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  margin: 0;
  cursor: none; /* touchscreen — no cursor */
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
```

## Coding conventions

- **File size:** no file over ~200 lines. Split when it grows.
- **Functions:** prefer small, named functions. No anonymous callbacks passed around.
- **DOM manipulation:** one render function per screen (`renderIdle()`, `renderCategory()`, etc.) that returns an element. Screens mount/unmount via a root router in `app.js`.
- **No inline event handlers in HTML.** Attach via `addEventListener` in JS.
- **Comments:** explain *why* something is done a non-obvious way. Don't explain *what* the code does if the code is readable.
- **Naming:** `camelCase` for JS, `kebab-case` for CSS classes, `SCREAMING_SNAKE` for constants.
- **Imports:** ES modules (`<script type="module">`). No bundler needed.

## Screen routing

A small history-stack router in `app.js`. No library. Each screen module exports a factory: `export function idle(props) { return { element, mount, unmount }; }`. Four navigation primitives drive the stack:

```js
navigate(screen, props)             // push a new entry, slide-in animation
goBack(steps = 1)                   // pop entries, slide-out animation; floors at the root
replaceWith(screen, props, dir?)    // swap top entry — previous screen vanishes from history
resetStack(...entries)              // clear and rebuild the stack; entry = string | [screen, props]
```

Rules of thumb:

- **Forward navigation:** `navigate("detail", { drinkId })`.
- **Back buttons:** call `goBack()`. The header's back button defaults to `goBack` when no `onBack` is supplied — most screens just omit `onBack` entirely.
- **Mid-flow screens that should never be back targets** (e.g. pouring → complete): use `replaceWith` so the in-flight screen pops off when the next one arrives.
- **End-of-flow returns** (Done, auto-return-to-idle, "Another"): use `resetStack` to seed a clean back path. `resetStack("idle")` is the canonical "fully reset" call; `resetStack("idle", ["detail", { drinkId }])` says "land on detail, but back from here goes to idle."
- **First mount and `#admin` direct entry:** `resetStack(initialScreen)` — there's no outgoing element so the transition is instant.

Each entry stores `{ screen, props }`. Re-mounting on back goes through the screen factory again — screens should be idempotent on re-mount and read live state (inventory, machine status) from their stores rather than expecting props to carry it. Animation direction (`push` / `pop` / `none`) is decided by which primitive was called, not chosen by callers.

## Interaction rules (from the brief, enforced in code)

- **Touch targets minimum 44×44 px** including padding. Never smaller. Verify this when styling buttons.
- **Tap feedback within 100ms.** Apply `.pressed` class on `touchstart`, remove on `touchend`. CSS transitions for any color/scale change ≤ 200ms ease-out.
- **No hover states** — this is a touchscreen. Style `:active` instead.
- **No long-press, no swipe, no multi-touch gestures** except possibly swiping pagination dots on the drink list. One tap = one action.
- **Every screen after idle has a visible back button** in the top-left — a 36×36 circle with a left chevron.
- **Status always visible.** The "READY" indicator in the top-right persists across every screen except pouring.
- **Auto-return to idle after 60 seconds of inactivity** on any screen. Reset the timer on any touch event.

## Drink data shape

In `src/drinks.js`:

```js
export const categories = [
  { id: 'classics',   name: 'The Classics',   descriptor: 'TIMELESS',        accent: 'var(--accent-classics)' },
  { id: 'refreshers', name: 'The Refreshers', descriptor: 'LIGHT & CRISP',   accent: 'var(--accent-refreshers)' },
  { id: 'sours',      name: 'The Sours',      descriptor: 'TART & BRIGHT',   accent: 'var(--accent-sours)' },
  { id: 'party',      name: 'The Party',      descriptor: 'BRIGHT & BOLD',   accent: 'var(--accent-party)' },
];

export const drinks = [
  {
    id: 'martini',
    name: 'Martini',
    category: 'classics',
    glassType: 'coupe',
    ingredients: [
      { name: 'gin',      volumeMl: 60 },
      { name: 'vermouth', volumeMl: 10 },
    ],
    garnish: 'olive',
    photo: 'assets/drinks/martini.webp',
    color: '#E8DFA8',  // fallback SVG fill until photos exist
  },
  // ... 15 more, see full list in docs/DESIGN_BRIEF.md
];
```

## Robot control contract

The frontend never talks to hardware directly. It sends WebSocket messages to the Node backend:

```js
// Frontend → backend
{ type: 'POUR', drinkId: 'martini', strength: 'regular', ice: 'chilled' }

// Backend → frontend (progress updates)
{ type: 'POUR_PROGRESS', step: 'gin',      pct: 0.33, status: 'pouring' }
{ type: 'POUR_PROGRESS', step: 'vermouth', pct: 0.66, status: 'pouring' }
{ type: 'POUR_PROGRESS', step: 'garnish',  pct: 1.00, status: 'pouring' }
{ type: 'POUR_COMPLETE', drinkId: 'martini' }

// Either direction, on error
{ type: 'POUR_ERROR', code: 'OUT_OF_INGREDIENT', ingredient: 'gin' }
```

For now, `src/server/pour.js` exports `mockPour()` that emits the above progress events on timers. Real serial/GPIO control is a later task — stub it cleanly.

## Running on the Pi

The target image is **Raspberry Pi OS Lite (32-bit)** on a Pi 3 B+. We don't run the full LXDE desktop — just `xinit` + Openbox + Chromium, to keep RAM headroom for the browser.

First-time setup is two scripts. Run both in order on a fresh Pi OS Lite install:

```bash
# On the Pi, after cloning:
bash scripts/install-kiosk.sh    # X, Node, Chromium, systemd service
bash scripts/install-network.sh  # nmcli sudoers, captive portal AP plumbing
sudo reboot
```

`install-kiosk.sh` installs the minimal X stack, Node 20, and Chromium; sets up tty1 autologin; writes `~/.bash_profile`, `~/.xinitrc`, and `~/.config/openbox/autostart`; and registers `bartender-kiosk.service` (systemd) to run the backend on boot. After reboot the Pi auto-logs in on tty1, starts X via Openbox, and Chromium launches in `--kiosk` mode against `http://localhost:3000`.

`install-network.sh` adds the system bits the admin Network tab and AP/captive-portal mode depend on: a `NOPASSWD: /usr/bin/nmcli` sudoers entry for the kiosk user, a DNS-hijack config in `/etc/NetworkManager/dnsmasq-shared.d/`, and an iptables dispatcher script in `/etc/NetworkManager/dispatcher.d/` that flips on whenever the `Hotspot` connection comes up. Idempotent. See README "Network setup" for details.

For dev iteration on the Pi without the full kiosk flow, the backend can still be run by hand:

```bash
npm run start      # starts backend + serves frontend on :3000
```

To diagnose the running kiosk:
```bash
systemctl status bartender-kiosk     # backend status
journalctl -u bartender-kiosk -f     # backend logs
```

## What to build first (suggested order)

1. **Scaffolding** — `index.html`, `styles.css` with tokens, `app.js` with the router. Screens can return placeholder `<div>`s.
2. **Design tokens + header component** — the station header, back button, and ready indicator used everywhere.
3. **Drink data** — populate `drinks.js` with all 16 drinks.
4. **Glass SVG component** — placeholder art until real photos exist. The brief specifies the glass type and liquid color for each drink.
5. **Category screen + drink list screen** — the two most-used screens, share a lot of structure.
6. **Detail screen** — the customize-and-confirm step.
7. **Search screen + keyboard component** — keyboard is reusable even if we only use it once now.
8. **Pouring screen + mock backend** — wire up the WebSocket contract end-to-end with the mock.
9. **Complete + idle screens** — bookends of the flow.
10. **Inactivity timeout + polish** — the details that make it feel finished.

Don't try to build everything at once. Land each step in a working state before the next.

## What NOT to do

- Don't add a CSS framework. Tailwind would double the bundle and the design tokens above are sufficient.
- Don't add TypeScript. The codebase is too small to earn the build step.
- Don't design for other screen sizes. This is a single-purpose appliance.
- Don't use localStorage or sessionStorage for robot state — it belongs on the backend (ingredients loaded, machine status, etc.).
- Don't use emoji in the UI. The brief calls for SVG icons only.
- Don't use gradients, drop shadows, or blur effects. Flat only.

## Questions the brief doesn't answer — decide and document

If you encounter ambiguity the brief doesn't resolve, make a reasonable choice and note it in `docs/DECISIONS.md`. Examples of likely questions:
- What exact animation timing for the pour progress bar?
- How should the idle screen's featured drink rotate (time-based? random? manual curation)?
- What's the admin/refill flow?

Default to simplicity. We can always add complexity later.
