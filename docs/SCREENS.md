# Screen Specifications

Behavior spec for each of the seven screens. Pair this with `DESIGN_BRIEF.md` for visual details.

All screens: 800 × 480. All screens except idle have the back button (36×36 circle, top-left) and ready indicator (top-right) unless otherwise noted.

---

## 1 · Idle / attract

**Purpose:** Draw the user in when the kiosk is unattended. Acts as the default state.

**Layout:**
- Centered featured drink illustration (large, ~60px glass)
- "TONIGHT'S FEATURE" label above, drink name and tagline below
- "Touch anywhere to begin" pill near the bottom
- Station ID and ingredient count in the footer corners
- Ready indicator top-right, time top-right

**Behavior:**
- Tapping anywhere on screen → navigate to category
- Featured drink rotates every 30 seconds (simple array cycle, no animation needed beyond a 400ms cross-fade)
- Clock updates every minute
- Returns here automatically after 60s inactivity on any other screen

**State dependencies:** none (read-only from drink data)

---

## 2 · Category select

**Purpose:** Primary navigation. User picks a category, or initiates a search.

**Layout:**
- Header: station label, "Choose a category" title, search bar (center), ready indicator
- 4 category tiles in a horizontal grid
- Footer: drink count, instructional hint

**Behavior:**
- Tap category tile → navigate to drink-list with that category
- Tap search bar → navigate to search
- Each category tile shows the category's accent color as border and decorative glow
- Tile content: number (01-04), name on two lines, descriptor, representative glass SVG, "4 drinks" label

**State dependencies:** none

---

## 3 · Search (active)

**Purpose:** Let users find a drink by name or ingredient when they don't know the category.

**Layout:**
- Header: back button, active search field (with × clear button), match count
- Horizontal row of result cards (max 4 visible, compact horizontal layout)
- On-screen QWERTY keyboard fills the bottom half

**Behavior:**
- Each keypress updates the query and filters live
- Results match against drink names AND ingredient names (e.g., "lime" surfaces Daiquiri, Gimlet, Margarita)
- Matched substring highlighted in the category's accent color (background 25% opacity, text brighter stop)
- Tap result → navigate to detail for that drink
- Tap × → clear query, show empty state ("type to search")
- Tap back → previous screen (history-stack pop)
- No results state: "No drinks match 'xyz'. Try an ingredient like 'lime' or 'gin'."

**Keyboard:**
- Letters only (3 rows: QWERTY / ASDFGHJKL / ZXCVBNM)
- Shift key (capitalization doesn't affect search; purely visual)
- Backspace key
- 42px key height minimum
- Keys use `:active` styling for press feedback (no hover)

**State dependencies:** `appState.searchQuery`

---

## 4 · Drink list (single category)

**Purpose:** Browse drinks within one category.

**Layout:**
- Header: back button, category label ("CATEGORY 01") in accent color, category name, drink count
- 4 drink cards in a horizontal grid (all drinks in category visible at once)
- Footer: pagination dots for the 4 categories, hint text

**Behavior:**
- Tap drink card → navigate to detail
- Tap back button → previous screen (history-stack pop)
- Tap pagination dot → swap this screen's contents to show that category's drinks (same screen, different category — don't re-navigate, don't push onto history)
- Active pagination dot is a 20px bar in the current category's accent color; others are 8px bars at 15% white opacity
- Each card: centered glass SVG (or photo eventually), drink name, ingredient list

**State dependencies:** `appState.currentCategory`

---

## 5 · Drink detail / confirm

**Purpose:** Show the user exactly what they're about to get, let them customize, and confirm.

**Layout (split ~45/55):**
- Left: large glass illustration of the drink (photo when available)
- Right: controls column
  - Drink name (larger, prominent)
  - Ingredient breakdown with volumes ("60ml gin · 10ml vermouth · olive")
  - **Strength** slider: light / regular / strong, with text readout
  - **Ice** toggle: chilled / on rocks (only shown for drinks where it applies)
  - **Garnish** toggle: yes / no (only for drinks with a garnish)
  - Large "POUR · READY IN ~45s" button, full accent color (category's color), dark text

**Behavior:**
- Sliders and toggles update `appState.pendingOrder` live
- Time estimate recalculates based on strength (stronger = slightly longer pour)
- Pour button → send `POUR` message to backend via WebSocket → navigate to pouring
- If any required ingredient is missing, show a non-blocking warning above the button: "⚠ Out of vermouth — this drink is unavailable" and disable the button
- Back button → previous screen (history-stack pop — drink-list, search, idle, etc.)

**State dependencies:** `appState.selectedDrink`, `appState.pendingOrder`

---

## 6 · Pouring

**Purpose:** Show live progress while the robot works. Reassuring, not frantic.

**Layout:**
- "NOW POURING" label, drink name (centered top)
- Large centered glass, filling in real-time as ingredients are added
- Progress bar with current step label ("Pouring vermouth")
- Step dots: gin ✓ · vermouth ● · garnish ○
- Cancel affordance at the bottom ("CANCEL — HOLD 2s")

**Behavior:**
- Receives `POUR_PROGRESS` events from backend via WebSocket
- Glass fill animates smoothly based on `pct` field of progress events (use `clip-path` on a rect inside the glass SVG)
- Ready indicator is HIDDEN on this screen (the machine is busy, not ready)
- **Cancel requires a 2-second hold**, not a tap — prevents accidental cancellation mid-pour
  - On `touchstart`: start a 2000ms timer, animate a progress ring around the cancel label
  - On `touchend` before timer fires: cancel the timer, reset the ring
  - On timer fire: send `POUR_CANCEL` to backend; pouring pops off the history stack (regular drinks land on detail, shots rewind two entries to the shotPicker)
- On `POUR_COMPLETE`: navigate to complete
- On `POUR_ERROR`: show error modal, offer retry or return to detail

**State dependencies:** `appState.pourProgress` (updated by WebSocket handler)

---

## 7 · Complete

**Purpose:** Signal the drink is ready, invite another, then return to idle.

**Layout:**
- Full glass illustration, centered
- "✓ READY" label in status green
- "Enjoy your [drink name]"
- "Please lift glass from the tray" instruction
- Two buttons: "ANOTHER" (bordered, white) and "DONE" (lower-emphasis)
- Auto-return countdown in footer

**Behavior:**
- Auto-returns to idle after 20 seconds
- "ANOTHER" → navigate to category (keeps the machine engaged)
- "DONE" → navigate to idle immediately
- Optional: detect glass-lift via a load sensor on the tray; if detected within 20s, show a subtle "cheers" acknowledgment

**State dependencies:** `appState.lastDrink`

---

## Global behaviors (all screens)

### Inactivity timeout
- Any screen other than idle resets a 60-second timer on every touch event
- When timer fires, navigate to idle
- Pouring screen is EXEMPT — we don't interrupt an in-progress pour

### Touch feedback
- Every tappable element gets `.tappable` class
- CSS applies `transform: scale(0.97)` and `opacity: 0.85` on `:active`
- Transition: `transform 150ms ease-out, opacity 150ms ease-out`

### Error handling
- Lost connection to backend: show a full-screen overlay "RECONNECTING..." with a spinner; auto-dismisses when WebSocket reconnects
- Out of stock: disable affected drinks on category and drink-list screens; show "Missing: gin" label on the drink card

### Accessibility
- Even though this is a kiosk, use semantic HTML (`<button>` not `<div onclick>`)
- ARIA labels on icon-only buttons ("Go back", "Clear search")
- Focus styles via `:focus-visible` only (so they don't show on touch)
