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
├── package.json                 ← Node deps for the backend
├── docs/
│   ├── DESIGN_BRIEF.md          ← full visual spec (read this!)
│   ├── SCREENS.md               ← per-screen behavior spec
│   └── DECISIONS.md             ← log of ambiguous-call decisions
├── firmware/
│   ├── bartender/bartender.ino  ← Arduino sketch driving the pumps
│   └── diag/diag.ino            ← pump diagnostic sketch
├── scripts/
│   ├── install-kiosk.sh         ← Pi: X + Chromium + systemd service
│   ├── install-network.sh       ← Pi: nmcli sudoers + captive-portal plumbing
│   ├── dnsmasq-captive.conf     ← DNS-hijack snippet for AP mode
│   ├── nm-dispatcher-captive.sh ← iptables flip on Hotspot up/down
│   └── serial-bridge.js         ← dev-only USB ↔ WebSocket bridge
├── src/
│   ├── index.html               ← kiosk entry point, all screens
│   ├── order.html               ← mobile order page entry (phones on the AP)
│   ├── welcome.html             ← captive-portal landing page (AP mode)
│   ├── styles.css               ← global styles, design tokens
│   ├── app.js                   ← bootstrap, screen router
│   ├── state.js                 ← appState + action fns (transient UI state)
│   ├── api.js                   ← REST client for the backend
│   ├── ws.js                    ← WebSocket client (pour progress, machine state, queue)
│   ├── drinks.js                ← built-in drink + category catalog
│   ├── ingredients.js           ← canonical ingredient ID list (derived from drinks)
│   ├── ingredient-defaults.js   ← seed ABV / bottle-size values (shared frontend + backend)
│   ├── clean-stages.js          ← deep-clean stage spec + durations (shared frontend + backend)
│   ├── icons.js                 ← inline SVG icon set
│   ├── format.js                ← oz/ml formatting helpers
│   ├── slug.js                  ← name → id slug helper
│   ├── queue-store.js           ← live drink-queue mirror (reflects server/queue.js)
│   ├── admin-auth.js            ← admin PIN session (frontend)
│   ├── inventory-store.js       ← live inventory subscription (SLOT_COUNT lives here)
│   ├── calibration-store.js     ← live calibration subscription
│   ├── ingredient-store.js      ← live per-ingredient attribute cache (ABV, size, cost)
│   ├── category-store.js        ← admin-hidden categories cache
│   ├── machine-status.js        ← ready / busy / error indicator state
│   ├── order.js                 ← mobile order page (served at /order)
│   ├── order-sheet.js           ← mobile order: drink-detail sheet + strength
│   ├── order-tray.js            ← mobile order: bottom queue tray
│   ├── order-status.js          ← mobile order: sticky status + pour progress
│   ├── order-notify.js          ← mobile order: sound + title + Notification + Wake Lock on "ready"
│   ├── order-client-id.js       ← mobile order: stable per-device id (localStorage)
│   ├── screens/
│   │   ├── idle.js                ← attract screen
│   │   ├── idle-timeofday.js      ← time-of-day featured-drink buckets
│   │   ├── category.js            ← four-category grid
│   │   ├── drink-list.js          ← drinks in a category
│   │   ├── search.js              ← search + keyboard
│   │   ├── detail.js              ← drink detail / customize
│   │   ├── shot-picker.js         ← straight-shot ingredient picker
│   │   ├── shot-detail.js         ← shot size + confirm
│   │   ├── build-your-own.js      ← custom recipe builder
│   │   ├── surprise.js            ← "surprise me" random-drink reel
│   │   ├── queue.js               ← shared drink-queue view (kiosk)
│   │   ├── pouring.js             ← live pour progress
│   │   ├── complete.js            ← pour done, "garnish & enjoy"
│   │   ├── admin.js               ← admin tab shell
│   │   ├── admin-dashboard.js     ← admin home with donut charts
│   │   ├── admin-inventory.js     ← bottle assignments + levels
│   │   ├── admin-ingredients.js   ← ingredient attribute editor (ABV, size, cost)
│   │   ├── admin-recipes.js       ← drink / category editor
│   │   ├── admin-history.js       ← pour log
│   │   ├── admin-submissions.js   ← user-submitted custom recipes
│   │   ├── admin-maintenance.js   ← prime, purge, calibrate
│   │   ├── admin-backup.js        ← backup & restore section of the Maintenance view
│   │   ├── admin-network.js       ← Wi-Fi / AP mode
│   │   └── admin-notifications.js ← low-stock / error alert log
│   ├── components/
│   │   ├── header.js              ← back button + status indicator
│   │   ├── glass.js               ← SVG glass renderer (fallback art)
│   │   ├── keyboard.js            ← on-screen QWERTY
│   │   ├── donut.js               ← admin-dashboard donut chart
│   │   ├── toast.js               ← transient bottom-of-screen messages
│   │   ├── confetti.js            ← canvas confetti burst (drink-ready celebration)
│   │   ├── status-pill.js         ← shared machine-status / queue pill (kiosk + mobile)
│   │   ├── abv-readout.js         ← shared "≈X% ABV · Y standard drinks" readout
│   │   ├── pin-modal.js           ← admin PIN entry
│   │   ├── text-input-modal.js    ← modal text field (uses keyboard)
│   │   ├── capacity-editor.js     ← bottle-size picker
│   │   ├── ingredient-picker.js   ← search / pick from ingredient catalog
│   │   ├── new-ingredient.js      ← shared "add an ingredient" flow
│   │   ├── drink-editor.js        ← recipe editor (admin + build-your-own)
│   │   ├── editor-fields.js       ← shared form-row primitives
│   │   ├── maint-ui.js            ← shared maintenance UI primitives (actionBtn / sectionHead / formatRate)
│   │   ├── calibrate-modal.js     ← slot pump-calibration modal
│   │   ├── clean-cycle-modal.js   ← guided deep-clean driver (view over server state)
│   │   └── scale-modals.js        ← load-cell calibrate + live-read modals
│   ├── server/
│   │   ├── index.js               ← node:http + WebSocket entry; static serving, WS/queue, dispatches to routes/
│   │   ├── http-util.js           ← sendJson / readJsonBody / jsonRoute helpers
│   │   ├── pour.js                ← pour orchestrator (calls serialPour)
│   │   ├── serialPour.js          ← per-pump serial dispatch
│   │   ├── serial.js              ← serial port open / reconnect
│   │   ├── queue.js               ← server-side shared drink queue (data + change notify)
│   │   ├── inventory.js           ← inventory state + REST handlers
│   │   ├── calibration.js         ← pump-rate calibration
│   │   ├── maintenance.js         ← prime / purge / clean routines
│   │   ├── clean-cycle.js         ← guided deep-clean state machine (owns the machine lock)
│   │   ├── cleaning-store.js      ← persisted line contents + last-cleaned stamp
│   │   ├── machine-state.js       ← ready / busy / error state machine
│   │   ├── pour-history.js        ← persisted log of every pour
│   │   ├── notifications.js       ← low-stock + error alerts
│   │   ├── network.js             ← nmcli wrapper for Wi-Fi + AP
│   │   ├── captive-portal.js      ← welcome.html intercept in AP mode
│   │   ├── glass-watch.js         ← ambient glass-presence detection via scale
│   │   ├── admin-pin.js           ← PIN storage + verify
│   │   ├── drinks-store.js        ← persisted user drinks
│   │   ├── categories-store.js    ← persisted user categories
│   │   ├── submissions-store.js   ← persisted user-submitted recipes
│   │   ├── ingredients-store.js   ← persisted per-ingredient attributes (ABV, size, cost)
│   │   ├── backup.js              ← whole-state backup / restore + on-device snapshots
│   │   ├── routes/                ← REST route modules, one per domain (index.js dispatches)
│   │   │   ├── inventory.js      ← pump-slot inventory + per-slot calibration
│   │   │   ├── catalog.js        ← drinks, categories, ingredient attributes
│   │   │   ├── submissions.js    ← user-submitted recipes + promote-to-catalog
│   │   │   ├── history.js        ← pour stats + raw pour log
│   │   │   ├── notifications.js  ← low-stock / error alerts
│   │   │   ├── maintenance.js    ← prime / flush, pump + load-cell calibration
│   │   │   ├── auth.js           ← admin PIN verify
│   │   │   ├── network.js        ← nmcli Wi-Fi / AP endpoints
│   │   │   └── backup.js         ← state backup download / list / restore / delete
│   │   └── state/                 ← JSON state persisted to disk
│   │       ├── drinks.json        ← persisted user drinks
│   │       ├── categories.json    ← persisted user categories
│   │       ├── inventory.json     ← pump-slot assignments + levels
│   │       ├── calibration.json   ← per-slot pump flow rates
│   │       ├── cleaning.json      ← what the lines contain + last-cleaned stamp
│   │       ├── ingredients.json   ← per-ingredient attributes (ABV, size, cost)
│   │       ├── pour-history.json  ← log of every pour
│   │       ├── notifications.json ← low-stock / error alerts
│   │       ├── submissions.json   ← user-submitted recipes
│   │       ├── orders.json        ← persisted drink queue
│   │       ├── pump-usage.json    ← cumulative pump run-time per slot
│   │       └── admin-pin.json     ← admin PIN
│   └── assets/
│       └── drinks/              ← drink photos (~70 PNGs)
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

## Adding new ingredients

When a new ingredient is added to the catalog (via `INGREDIENT_COLORS` / `PRETTY_NAMES` in `src/ingredients.js`, or seeded by a new recipe), evaluate whether it belongs in `shotIngredients` in `src/drinks.js`. The rule:

- **Add it if** the ingredient is a spirit or liqueur that a person would plausibly drink straight: vodkas (incl. flavored), rums, whiskeys, gins, tequilas, mezcals, brandies/cognacs, schnapps, amari, and most cordials/liqueurs (kahlua, midori, cointreau, st-germain, etc).
- **Skip it if** it's a mixer, modifier, or non-drinkable-straight item: juices, sodas, syrups (simple/grenadine/orgeat), bitters, coconut cream, beer, dairy.
- **Default `defaultOz`:** `1.5` for ~35%+ ABV spirits, `1.0` for liqueurs and lower-ABV cordials.
- **`color`:** mirror the value already defined in `INGREDIENT_COLORS` for that ID so the shot-tile preview matches the rest of the UI.

This keeps the shots menu in sync with the catalog automatically rather than requiring a separate ask.

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

## AI Behavioral Guidelines

These guidelines bias toward caution over speed to reduce common LLM coding mistakes. For trivial tasks, use judgment.

### 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**
When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
**Define success criteria. Loop until verified.**
Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:
`1. [Step] → verify: [check]`
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
