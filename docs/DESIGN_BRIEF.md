# Drink Dispenser Robot — Interface Design Brief

## Project overview

A touchscreen kiosk interface for a home-built drink dispensing robot. The user selects a drink from a menu, and the machine dispenses the correct ingredients automatically. The interface needs to feel premium and effortless — like a high-end cocktail bar, not a vending machine.

## Hardware constraints

- **Display:** Raspberry Pi 7" Touch Screen Display
- **Resolution:** 800 × 480 pixels (fixed, native)
- **Orientation:** Landscape
- **Touch:** 10-finger capacitive
- **Design implication:** Every mockup must be built to exactly 800×480. Touch targets should be minimum 44px with generous padding. Fonts should not drop below 10px for labels or 13px for body text.

## Visual design system

### Aesthetic
Sleek, modern, minimalist. Dark theme. No gradients, no drop shadows, no skeuomorphic effects. Flat surfaces. The interface should feel like it belongs in a high-end bar or hotel lobby.

### Color palette
- **Background (primary):** `#0a0a0a` — near-black, warmer than pure black
- **Surface (cards):** `#141414` — one step lighter for cards and elevated elements
- **Keyboard keys:** `#1a1a1a` — one step lighter again
- **Primary text:** `#f5f5f5` — off-white
- **Secondary text:** `#888` — muted gray for labels and metadata
- **Tertiary text:** `#666` or `#555` — for footer text and hints
- **Divider lines:** `rgba(255,255,255,0.08)` to `rgba(255,255,255,0.1)`
- **Card borders:** `rgba(255,255,255,0.08)` default, `rgba(255,255,255,0.2)` on emphasis
- **Status green (ready):** `#4ade80`

### Category accent colors
Each drink category has its own accent color, used consistently across the system (category header, border, highlight, pagination dot):
- **The Classics:** `#D4A574` (warm amber)
- **The Refreshers:** `#5DCAA5` (teal green)
- **The Sours:** `#F0C040` (bright yellow)
- **The Party:** `#E85D9B` (hot pink)

Accent colors appear as: thin 0.5px colored borders on category tiles, small numeric prefixes (01, 02, 03, 04), section underlines, and subtle radial glows (top-right circular fills at ~6% opacity).

### Typography
- **Font:** System sans-serif stack
- **Weights:** 400 regular, 500 medium only — never 600 or 700
- **Titles:** 18-22px, weight 500, letter-spacing -0.3 to -0.5px
- **Drink names:** 15-17px, weight 500
- **Body / descriptions:** 10-13px, weight 400, color `#777`
- **Labels:** 9-11px, uppercase, letter-spacing 1.5-2.5px, color `#888`
- **Sentence case** everywhere except UPPERCASE labels. No Title Case.

### Layout tokens
- **Screen padding:** 18-28px (tight, but the screen is small)
- **Card border radius:** 10px (not 8 or 12 — this specific value)
- **Card padding:** 14-16px internal
- **Card gaps in grid:** 10-12px
- **Pill / button radius:** 999px (fully rounded)

## Information architecture

### Category structure
- **The Classics** (timeless): Martini, Manhattan, Negroni, Old Fashioned
- **The Refreshers** (light & crisp): Gin & Tonic, Cuba Libre, Vodka Soda, Tom Collins
- **The Sours** (tart & bright): Margarita, Whiskey Sour, Daiquiri, Gimlet
- **The Party** (bright & bold): Cosmopolitan, Tequila Sunrise, Sea Breeze, Screwdriver

Total: **16 drinks** across **4 categories**, **12 ingredients loaded** (typical status).

### Navigation flow
1. **Idle / attract screen** (not yet designed) — what shows when no one is using the machine
2. **Category selection** (designed) — 4 tiles, search bar in header
3. **Search active** (designed) — live results + on-screen QWERTY keyboard
4. **Drink list for a category** (designed) — 4 drinks per category, back button, pagination dots to swipe between categories
5. **Drink detail / confirm** (not yet designed) — customize strength, ice, garnish, and confirm pour
6. **Pouring / dispensing** (not yet designed) — live progress while the robot works
7. **Complete / enjoy** (not yet designed) — "your drink is ready"

## Drink photography

Each drink is represented by a real photograph, but shot to extremely specific specifications so the images blend seamlessly into the dark UI rather than fighting it. The goal: every drink appears to float on the interface with no visible photographic "frame" — only the glass, the liquid, and the garnish are visible. This gives you the warmth and appetite-appeal of real photography with the visual cohesion of an illustration system.

### Shoot specifications (mandatory — every drink must follow these)

**Background**
- Seamless matte black sweep/backdrop, no gloss, no texture
- Post-process to exactly match `#0a0a0a` (the UI background)
- Goal: when composited into the UI, there should be no visible seam between photo background and interface

**Lighting**
- Single key light from upper-left at ~45° elevation
- Soft-diffused (large softbox or scrim), producing a gentle highlight along the glass's left edge
- Optional: subtle rim light from the right at low intensity, to separate glass from background
- No fill light — shadow side of glass should fall into near-black
- Color temperature: 3200K (warm tungsten) to harmonize with amber/coral accent system
- Lock white balance manually; use the identical value for every drink

**Camera**
- Focal length: 85-100mm equivalent (minimizes glass distortion)
- Aperture: f/5.6 to f/8 (full glass and garnish in sharp focus)
- Angle: eye-level or very slightly above (~10° downward), consistent across every drink
- Never top-down, never from below

**Composition**
- No props, no bar surface, no bottles, no shakers, no napkins — just the glass
- No cast shadow on a surface beneath the glass (shoot on glass/acrylic with backdrop far behind, or remove shadow in post). A cast shadow reveals the "table" and breaks the floating illusion.
- Garnish styling unified across drinks: if one lime wedge sits on the rim at 2 o'clock, every lime wedge sits there. Pick a rule per garnish type and apply it everywhere.
- Fill level unified: all coupes filled to 5mm from rim, all rocks glasses to half-rim over ice, all highballs to 10mm from rim.
- Aspect ratio: ~3:4 portrait, glass centered horizontally, ~10% padding top and bottom.

**Post-processing**
- Mask out background cleanly with 3-5px gaussian feather at the mask edge (prevents the "cut out with scissors" look)
- Replace background with flat `#0a0a0a`
- Minor color correction for consistency — match the warm tone across all drinks
- Preserve a hint of subtle ambient occlusion beneath the glass base (~30% opacity soft ellipse) so the glass feels grounded, not pasted

### File format & sizes

- Export as PNG with transparency (preferred — lets you change UI background later) or JPEG with `#0a0a0a` baked in (smaller files, faster on Pi)
- Master size: 600×800px per drink
- Display sizes on the Pi:
  - Category tile preview: ~85×110px
  - Drink list card: ~140×200px
  - Drink detail screen: up to 280×400px
- WebP is preferred for delivery if the Pi's browser supports it

### Glass types per drink (so the shoot list is unambiguous)

- **Coupe glass:** Martini, Manhattan, Daiquiri, Gimlet, Cosmopolitan, Whiskey Sour
- **Rocks / old-fashioned glass:** Negroni, Old Fashioned
- **Highball / Collins glass:** Gin & Tonic, Cuba Libre, Vodka Soda, Tom Collins, Sea Breeze, Screwdriver, Tequila Sunrise
- **Margarita glass:** Margarita

### Garnish rules (unified across the menu)

- Olive → coupe rim, skewered vertically, 2 o'clock position (Martini)
- Cherry → resting in glass (Manhattan)
- Orange peel / twist → draped over rim, 2 o'clock (Negroni, Old Fashioned, Screwdriver, Tequila Sunrise)
- Lime wedge → on rim, 2 o'clock (Gin & Tonic, Cuba Libre, Vodka Soda, Margarita, Daiquiri, Gimlet)
- Lemon wedge → on rim, 2 o'clock (Tom Collins, Whiskey Sour)
- Salt rim → Margarita only, full rim

### Fallback

If real photography isn't immediately feasible, the interim SVG system used during design mockups works as a placeholder. Swapping SVG → real photography later is a drop-in replacement since the dimensions and backgrounds are identical.

## Component patterns

### Header (category screen)
- Left: station label + screen title
- Center: pill-shaped search bar with magnifying glass icon
- Right: ready-status dot (green) + "READY" label

### Header (drink list screen)
- Left: 36×36 circular back button (< chevron) + category label + category name
- Right: "N DRINKS" count label

### Category tile (4 per row on category screen)
- 0.5px colored border using the category's accent color at 30% opacity
- Decorative radial glow in top-right corner (80×80 circle, 6% opacity of accent)
- Numeric prefix (01-04) in accent color, 9px uppercase
- Category name on two lines, 16-17px weight 500
- Descriptor label ("TIMELESS", "LIGHT & CRISP", etc.) in 9px uppercase muted
- Centered SVG glass illustration
- Preview of 4 drinks in category at 9-10px in muted color

### Drink card (4 per row on drink list screen)
- Neutral gray border (no category color — the header already establishes context)
- Centered SVG glass illustration (58-60px wide, fills most of card vertical space)
- Drink name below, centered, 15px weight 500
- Ingredient list below, centered, 10-11px muted, separated by middle dots (·)

### Search result card (horizontal variant)
- Small SVG glass illustration (34×44) on the left
- Drink name with matched letters highlighted in the category's accent color (background at 25% opacity, text at brighter stop)
- Category label below drink name in accent color, 9px uppercase

### On-screen keyboard
- QWERTY layout only (letters, shift, backspace — no numbers/punctuation needed)
- Keys are 42px tall × auto-width via CSS grid
- Key background `#1a1a1a`, 0.5px border at 8% opacity, 6px radius
- Modifier keys (shift, backspace) use darker `#0f0f0f` background

### Footer (category & drink list screens)
- Top: 0.5px divider at 8% opacity
- Left: metadata (e.g., "16 DRINKS · 12 INGREDIENTS LOADED") in 10px uppercase `#666`
- Right: instructional hint ("Tap a category →", "Tap a drink to begin") in 10px uppercase `#666`

### Pagination dots (drink list footer)
Four small horizontal bars — the active one is 20px wide in the category's accent color, the others are 8px wide at 15% white opacity. Tapping a dot jumps to that category.

### Toast banner (error / status feedback)
A single shared banner pinned to the bottom-center, 60px from the bottom edge so it clears the pour-cancel button and any footer hints. Surface background `#141414` with a 1px subtle border and a 3px left accent bar that signals variant — `--accent-shots` (coral) for errors, `--text-secondary` (muted gray) for neutral status. 13px regular text, single-line preferred but wraps to two if needed (max-width 540px). Fades in over 200ms, auto-dismisses after 4s, dismissible early by tap.

Only one toast is ever visible — a new call replaces the current one rather than queuing, since stacked failures are confusing and the latest is almost always the most relevant. A toast is the right surface for **after-the-fact failures the user couldn't have prevented** (pour failed, save failed, hardware fault). It is **not** for in-flow validation (use inline errors) and **not** for connection loss (the dedicated reconnect overlay at z:100 sits above the toast and takes priority).

### WebSocket reconnect overlay
Full-screen 92%-opacity scrim with a centered pulsing dot and "RECONNECTING" label, shown only after the first successful connect drops — never on initial page load against a static dev server. Blocks all interaction until the backend returns. This is intentionally heavier than a toast because the kiosk is genuinely non-functional without the backend.

## Interaction principles

- **Every action is one tap.** No long-press, no double-tap, no multi-touch gestures. Users may be holding a glass.
- **Touch targets minimum 44×44px** with padding between them.
- **Feedback is immediate.** A tap should visually commit in <100ms, even if the robot takes longer.
- **Always provide escape.** Every screen after the category screen has a visible back button.
- **Live, not modal.** Search results update as the user types. No "submit" button.
- **Status is always visible.** The "READY" indicator in the top-right persists across screens so users know the machine is operational.
- **Failures are never silent.** Every backend error (failed pour, hardware fault, save failure) surfaces as a toast banner with a plain-language message — e.g. "Out of gin" or "No vermouth loaded — check inventory". A swallowed `catch {}` is a bug, not a polish item.

## Screens still to design

Feed this brief plus the following request to Claude Design to continue:

### 1. Drink detail / confirm screen (priority)
After a user taps a specific drink, they should see:
- Large glass illustration of the chosen drink
- Drink name and tagline
- Customization options: **strength** (light / regular / strong slider), **ice** (yes / no toggle), optional **garnish**
- Ingredient breakdown with volumes (e.g., "60ml gin, 10ml vermouth, 1 olive")
- Big "Pour" confirmation button (full-width, amber or white accent)
- Estimated pour time ("Ready in ~45 seconds")
- Back button

### 2. Pouring / dispensing screen
While the robot is working:
- Calm animated progress indicator (maybe a glass filling up in SVG)
- Ingredient-by-ingredient progress ("Pouring gin... Adding vermouth... Garnishing...")
- Overall progress percentage or time remaining
- A cancel button (but make it slightly harder to reach — the user shouldn't hit it by accident)

### 3. Complete / enjoy screen
When the drink is ready:
- Celebratory but understated — matches the premium aesthetic, not a confetti explosion
- "Your [drink name] is ready" message
- A way to rate the drink or start another
- Auto-returns to idle after ~20 seconds

### 4. Idle / attract screen
When no one is using the kiosk:
- Should draw people in from across the room
- Could feature: subtly animated glass illustrations, a rotating featured drink, today's "house special", or ambient motion
- Large touch-anywhere prompt to begin
- Consider: time of day affecting the featured suggestion (coffee-cocktails in the morning, spritzes in the afternoon, martinis in the evening)

### 5. Admin / low-stock states
- When an ingredient runs out, affected drinks should gray out with a "Missing: gin" label
- Admin screen for refilling / calibration (PIN-protected, accessed by long-pressing a corner or similar)

## Technical notes for implementation

- The interface should be built as a web app (HTML/CSS/JS) running in fullscreen browser kiosk mode on the Pi. This gives you the easiest path to the visual fidelity described here.
- All SVG illustrations should be inlined — no external image files needed.
- Use CSS custom properties for the color palette and category accents so theming stays consistent.
- The keyboard should be a custom component, not the OS virtual keyboard (the OS one is ugly and takes too much space).
- Animations should be subtle: 200-300ms ease-out transitions for taps, nothing bouncy or playful.

## One-line summary

> A dark, minimalist cocktail kiosk for a 7" Raspberry Pi touchscreen, organized into four color-coded drink categories with live search, featuring photographs of each drink shot on a matched near-black background so they float seamlessly into the UI — premium bar aesthetics, no visual bling.
