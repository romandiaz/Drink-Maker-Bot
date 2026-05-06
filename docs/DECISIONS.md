# Design Decisions

Decisions made where the brief or screen spec left an ambiguity, per the
"Questions the brief doesn't answer — decide and document" guidance in
[CLAUDE.md](../CLAUDE.md). Append as decisions arise; revisit when assumptions change.

## Step 5 — Category + drink list

- **Drink card glass size: 88px wide.** The brief says "58–60px wide" *and*
  "fills most of card vertical space" — at 60px the glass looks lost in a
  ~180px-wide card. 88px reads better while still leaving room for name +
  ingredients below. Trivial to revisit once real photos drop in.
- **Category tile glow: solid circle, not radial gradient.** The brief calls
  for a "subtle radial glow" but also bans gradients. A solid accent-colored
  circle at 6% opacity, positioned off the corner, gives the same visual
  signal flat — no gradient.
- **Footer metadata: real counts.** Showing
  `${drinks.length} drinks · ${unique ingredients} ingredients`
  (16 · 21 today) instead of the brief's example "16 DRINKS · 12 INGREDIENTS LOADED".
  The "LOADED" wording implies backend stock state, which doesn't exist yet —
  swap when the backend lands.
- **Drink list footer meta = category descriptor.** No firm spec; the descriptor
  ("TIMELESS", "LIGHT & CRISP", …) reads well next to the centered pagination
  dots and right-aligned hint.
- **Glass placeholders are throwaway.** User intends to swap to real photos.
  Glass paths/strokes intentionally left rough — the swap point is one
  `wrap.innerHTML = …` line in `src/components/glass.js`.

## Step 6 — Detail screen

- **No ice or garnish toggles.** The machine pours liquid only; the user adds
  ice and garnish themselves after the pour. Strength is the sole customization.
  Ingredient line still shows the garnish so the user knows what to grab.
- **Pour-time estimator drops ice/garnish terms.** Time is `20 + 5×ingredients`,
  scaled ±10% for light/strong. Tunable once real hardware exists.
- **Complete screen (step 9) gets a garnish reminder.** "Grab a lime wedge from
  the tray" or similar, only for drinks with a `garnish` field. Open question:
  do drinks with `needsIce: true` also get an ice reminder? Decide when building
  the complete screen.

## Step 7 — Search + keyboard

- **Shift is a sticky toggle, visual only.** The brief says capitalization
  doesn't affect search; tapping shift just flips the on-screen letter case.
  Keyboard DOM is mounted once and persists across keystrokes so the shift
  state survives.
- **Search results capped at 4 cards.** Spec says "max 4 visible"; if more
  drinks match, the rest are hidden. Adequate for a 16-drink corpus.
- **Match highlighting only on the drink name.** When the match is in an
  ingredient (e.g. "lime" → Daiquiri), the name has nothing to highlight; the
  category label below acts as the only accent. Could add a "matches: lime"
  hint later if it confuses users.
- **Search pill is global on browsing screens.** It appears in the header on
  idle, category, drinkList, and detail. Not on search itself, pouring (machine
  is busy), or complete (user has their drink — "ANOTHER" sends them back to
  category if they want more). When step 9 builds the real idle and complete
  screens, idle keeps the pill, complete does not.

## Step 8 — Pouring + mock backend

- **WebSocket contract simplified.** POUR drops `ice` (machine is liquid-only
  per the project memory); POUR_PROGRESS drops the "garnish" terminal step.
  CLAUDE.md's contract example still shows the old shape — update there when
  convenient.
- **POUR_CANCELLED is a new event.** The original spec only described
  POUR_CANCEL as client → server; the backend now echoes POUR_CANCELLED back so
  the frontend knows when the pour has actually stopped before navigating.
- **POUR_PROGRESS adds `stepIndex` + `totalSteps`.** Needed to drive the step
  dot list. Otherwise the frontend would have to look up the index from the
  step name on every event.
- **Mock pour runs at 4× real time** (`SPEED_MULT` in `src/server/pour.js`).
  Shrinks a typical 30s pour to ~7s for dev iteration. Set to 1 for
  hardware-accurate timing.
- **Glass fill animation deferred.** The spec calls for a `clip-path` reveal
  on the SVG liquid layer as `pct` advances. With photo replacement coming,
  this would be built twice; the progress bar carries the visual signal until
  photos land.
- **Per-step duration weighted by volume.** A 150ml soda step takes longer
  than a 5ml bitters dash, instead of dividing total time evenly across
  ingredients. Reads more believably as a real pour.

## Step 8 follow-ups

- **Strength shifts ratios; total volume stays constant.** `adjustedIngredients`
  in `drinks.js` scales the primary spirit by ±30% and absorbs the change
  inversely across the modifiers, so a "strong" Martini is drier (more gin,
  less vermouth) at the same 70ml glass — not a bigger pour. Modifier total
  has a 2ml floor so vermouth-style drinks don't go to zero on strong, and
  individual ingredients have a 1ml floor so Old Fashioned bitters survive.
  Rounding drift is absorbed into the primary so the displayed total matches
  exactly across strength changes.
- **Pour-time estimate is now strength-independent.** It's derived from total
  volume, which strength no longer changes. Same drink → same time, regardless
  of strength. Donut and ingredient list communicate the strength change visually.

## Step 9 — Idle + complete

- **Idle features a curated rotation** of six well-known drinks (Martini,
  Negroni, Margarita, G&T, Cosmo, Old Fashioned). 30s rotation with a
  ~400ms cross-fade. Easy to swap to "all drinks" if the rotation feels
  stale, or to time-of-day-aware curation per the brief's later note.
- **Idle tap-anywhere navigation skips real buttons.** A click anywhere on
  the screen → category, but if `event.target.closest('button, .tappable')`
  matches, the click is left to its own handler — keeps the search pill in
  the header working without a separate tap zone.
- **Complete shows a garnish reminder** when the drink has one — "Don't forget
  to add a lime wedge". Skips for garnish-less drinks. No ice reminder yet;
  decide if needed once we see real usage.
- **Complete auto-returns after 20s** with a live countdown in the footer.
  Tapping Another (primary) → category; Done (secondary) → idle.
- **No back button on complete.** The pour just happened; there's nothing
  to go back to. Two explicit forward actions (Another / Done) plus the auto
  timer cover the exit paths.

## Admin / Inventory backend

- **Inventory = 12 fixed pump slots.** Each slot holds one `ingredientId`
  (nullable), a `capacityOz` (default 25 oz ≈ 750ml bottle) and a
  `remainingOz`. Changing slot count is a single `SLOT_COUNT` constant in
  `src/server/inventory.js`.
- **Persisted as plain JSON** at `src/server/state/inventory.json`. Auto-seeded
  on first boot so the admin screen has content; git-ignore later if the Pi's
  live state shouldn't land in the repo.
- **REST, not WebSocket.** `GET /api/inventory` and `PUT /api/inventory` only.
  Admin is assumed single-user; no live broadcast of changes. The PUT replaces
  the whole document (simpler than diffing and plenty fast for 12 rows).
- **Auto-save on every edit.** No Save/Cancel flow — every slot change fires
  a PUT. Fewer states to get wrong; the only failure mode is a transient
  network error which the footer surfaces as "Save failed — retry".
- **Inventory consumed on `POUR_COMPLETE`, not per step.** A cancelled pour
  leaves physical state ambiguous (how much actually dispensed?); halving the
  decrement on cancel would be guesswork. We accept the rare overstatement
  and clamp remaining to zero on underflow so the UI never shows negatives.
- **Ingredient catalog derived from `drinks.js` + `shotIngredients`.** No
  separate catalog table — the picker lists exactly what some drink or shot
  references. Adding a new drink with a new ingredient name automatically
  makes that ingredient pickable; no parallel list to maintain.
- **Access: `#admin` URL + 5-tap on idle "Station 01" eyebrow.** The hash
  route is for the dev case (keyboard attached); the 5-tap is the kiosk
  path — discoverable by the owner, unlikely to trigger by accident. Reset
  window is 800ms between taps.
- **Capacity is fixed at 25 oz for now.** In-UI capacity editing deferred
  until we know whether real hardware uses mixed bottle sizes. The seed lets
  you edit the JSON directly in the meantime.

## Recipe CRUD backend

- **`drinks.js` stays the single public import surface.** Instead of moving
  every screen to a new module, `drinks.js` now exports a mutable `drinks`
  array (seeded from a static `SEED_DRINKS`) plus a `replaceDrinks()` mutator.
  Existing `import { drinks }` / `getDrinkById` consumers get live updates
  because we mutate in place (`drinks.length = 0; drinks.push(...new)`) rather
  than reassign.
- **Backend and frontend each hydrate separately.** Backend loads
  `src/server/state/drinks.json` (auto-seeded from `SEED_DRINKS` on first boot)
  and calls `replaceDrinks()` on its own module instance. Frontend fetches
  `/api/drinks` at `DOMContentLoaded` and does the same. CRUD writes go
  through the backend only; `reloadDrinks()` in `app.js` lets the admin
  screen refresh the frontend copy after each save.
- **REST shape: plural resource, singular mutations.** `GET /api/drinks` →
  `{ drinks, updatedAt }`, `POST /api/drinks` to create, `PUT
  /api/drinks/:id` to replace, `DELETE /api/drinks/:id` to remove. PUT
  replaces the whole drink (no PATCH) to match the inventory pattern.
- **IDs are server-generated slugs.** Posting `{ name: "My Drink" }` yields
  `id: "my-drink"`; collisions get `-2`, `-3`, etc. Admin never types an ID.
- **Shots are not CRUD-able from the UI.** The shots category is generated
  from a separate `shotIngredients` list and has its own pour path; the
  editor's category picker omits it. The four cocktail categories remain
  hard-coded — they're structural, not content.
- **Admin screen is one screen with internal tabs.** Inventory and Recipes
  are views inside the existing `admin` route, not separate routes. Keeps
  the 5-tap / `#admin` entry points unchanged and lets the shared header +
  footer stay stable across tabs. Recipes tab landing state = the drink
  list; tapping a card opens a full-screen editor overlay.
- **Text input = modal with extended keyboard.** Each text field (name,
  tagline) launches a `textInputModal` covering the whole screen: display
  line on top, keyboard (extended to include space / `.` / `'`) below,
  Cancel / Done at the bottom. Inline typing would have forced scrolling
  the form under the keyboard — the modal is simpler and more reliable on
  touch.
- **Color is a fixed 12-swatch palette, not a free hex picker.** Free hex
  entry on a touchscreen is fiddly and the existing drinks only use a small
  range of colors anyway. Anyone who needs a custom color can edit
  `drinks.json` directly for now.
- **Volumes edit via ±0.25 oz steppers.** No numeric keypad — the finest
  real-world dispenser resolution is ~0.25 oz, and the stepper UI is the
  same pattern shots already use. Clamps 0.1–12 oz.
- **Delete is two-tap, not hold-to-confirm.** The hold-to-confirm pattern is
  used for pour-cancel (interrupting hardware) where a brief, deliberate
  signal matters. For a destructive-but-undo-via-re-add action like deleting
  a recipe, "tap, then tap again within 3s to confirm" is lighter-weight.
- **Pour decrement still works after edits.** The backend's pour.js gets
  its drink via the live `drinks` array in `drinks.js`; since CRUD calls
  `replaceDrinks()` on the same module instance, edited recipes pour with
  the new ingredients without a restart.

## Navigation history stack

- **Real history, not hardcoded back destinations.** `navigate()` pushes
  `{ screen, props }` entries onto a stack in `app.js`; `goBack()` pops. Replaces
  the previous "every back button hardcodes its target" approach where, e.g.,
  detail's back button always went to drink-list — even when the user got to
  detail via search or the idle featured drink.
- **Four primitives:** `navigate` (push), `goBack(n=1)` (pop), `replaceWith`
  (swap top), `resetStack(...entries)` (clear and rebuild). The header's back
  button defaults to `goBack`; screens omit `onBack` unless they need a custom
  action.
- **`replaceWith` for one-shot screens.** Pouring → complete uses
  `replaceWith("complete")` so the finished pour can't be reached via back.
  Same reasoning would apply to any future modal-ish flow.
- **`resetStack` for end-of-flow returns.** Complete's "Done", the inactivity
  timeout, and the auto-return-to-idle countdown all call `resetStack("idle")`
  rather than pushing idle onto an ever-growing stack. Complete's "Another"
  uses `resetStack("idle", ["detail", { drinkId }])` (or the shotPicker +
  shotDetail pair for shots) so back from the new detail lands on idle, not
  on the prior pour.
- **Pour cancel/error rewinds the stack.** Cancelling a regular drink calls
  `goBack()` (= pop pouring → land on detail). Cancelling a shot calls
  `goBack(2)` (= pop pouring + shotDetail → land on shotPicker). Two-step
  rewind for shots matches the prior behaviour and gets the user back to the
  spirit selector rather than the same shotDetail they just aborted.
- **`#admin` direct entry resets the stack** (`resetStack("admin")` on first
  mount). Back from admin then falls through to `resetStack("idle")` because
  the stack is at its root — matches the prior hardcoded behaviour without a
  per-screen check.
- **Search query doesn't survive back-into-search yet.** `search.js` still
  clears `appState.searchQuery` in unmount, so navigating search → detail →
  back rebuilds search with an empty query. Acceptable for v1; revisit by
  storing the query on the stack entry's props if user feedback says
  otherwise.

## Step 10 — Polish

- **Inactivity returns to idle after 60s.** Lives in `app.js` so every screen
  inherits it without per-screen wiring. Reset on any `pointerdown` and on
  every `navigate()`. Idle and pouring are exempt — pouring because we don't
  abort an active pour, idle because that's the destination.
- **WS-disconnect overlay only after first connect.** `ws.js` tracks
  `hasEverConnected`; the "Reconnecting" overlay only appears if a session
  was established and then dropped. Boot-time failures (e.g. running over a
  static dev server with no WS backend) stay silent so the rest of the UI is
  still usable.
- **Overlay is a subtle pulsing dot, not a spinner.** The brief bans gradients
  and bouncy motion; a single dot pulsing 0.85→1.1× over 1.4s reads as "alive,
  retrying" without competing with the rest of the UI.
- **Drink-list grid: `minmax(180px, 1fr)` auto-rows.** Single-row categories
  fill the available height; multi-row categories drop to 180px per row and
  scroll. Scrollbar is hidden but the partial second row signals scrollability.
- **Donut chart shows total ml in the hole.** Updates live as strength
  changes. Donut SVG is wrapped in a positioned div with the centered label
  layered on top so the SVG's `rotate(-90deg)` doesn't flip the text.

## Admin PIN protection

- **Admin entry is PIN-gated at every entry point.** Idle gear button, idle
  5-tap eyebrow, category gear button, and `#admin` hash route all funnel
  through `requestAdminAccess()` in `src/admin-auth.js`, which mounts the PIN
  modal and only navigates on success. Single chokepoint = no backdoors.
- **PIN stored in plaintext at `src/server/state/admin-pin.json`.** Default
  `1234` on first boot. Edit the file directly to change for now; an in-app
  Settings tile can land later. Plaintext is fine for a home kiosk —
  physical access to the device is the actual security boundary, and a hash
  here would just be theatre on a 4-digit PIN.
- **Verification is one POST.** `POST /api/admin/verify-pin {pin}` →
  200/401. No rate limiting: brute-forcing 10,000 combinations on a
  touchscreen keypad is implausible, and the threat model is "guest pokes
  around", not "attacker with API access".
- **Modal dismisses on inactivity.** A user who walks away mid-PIN doesn't
  leave the modal hovering on top of the auto-returned idle screen — the
  60s inactivity reset calls `dismissAdminPrompt()` before `resetStack`.
- **Cog icon swap.** The previous admin glyph was a circle with eight rays
  + a center dot — read as a sun, not settings. Replaced with the Lucide
  `settings` cog (8 rounded teeth + inner circle). Generic class renamed
  `idle-admin-btn` → `admin-btn` since the same button now appears on
  category too.
- **Same gear on category.** Cluster pattern (`.header-right-cluster`)
  factored out so both idle (gear + clock + ready) and category
  (gear + ready) compose the same way.

## Build-your-own + submissions

- **Guest builds land in their own store, not the canonical drinks list.**
  `src/server/state/submissions.json` is separate from `drinks.json`. The
  guest flow only POSTs `{name, ingredients}`; everything else (category,
  glass, color, garnish) is decided at promote time by an admin. Keeping
  the two stores apart lets guests freely build whatever without polluting
  what the machine offers by default.
- **Promote = drinks-store create + submissions remove, atomically server-side.**
  `POST /api/submissions/:id/promote` runs `drinksStore.create(payload)` first
  (so a malformed promote bounces with 400 before we drop the original) then
  removes the submission. The admin's promote payload merges defaults from
  the editor on top of the guest's name + ingredients.
- **Promote opens the existing recipe editor pre-filled.** Reusing
  `drinkEditor` in the Submissions tab gives admins one editing surface
  instead of two. The editor's `title` prop is now optional so the same
  modal can read "Promote submission" instead of "Edit drink".
- **Build-your-own picker is restricted to loaded ingredients.**
  `ingredientPicker` gained `ids`, `allowNew`, `allowEmpty`, `title` props
  so the guest flow can show only what's physically in a pump (no
  "+ New ingredient" tile, no null/empty option). Admin recipe editor still
  uses defaults — full catalog, new-ingredient affordance.
- **Pour also saves the submission.** Pressing Pour POSTs to
  `/api/submissions` *then* navigates to the pouring screen — failure to
  save logs a toast but doesn't block the pour. We don't expose a
  save-without-pouring path; if a guest aborts before pouring the recipe
  was never committed.
- **Pouring's abort-rewind keyed on `isShot`, not `customDrink`.** Shots
  rewind two stack entries (past shotDetail, back to shotPicker); build-
  your-own and any future custom flow rewind one (back to the editor to
  retry). Single-flag check beats listing custom-drink kinds.
- **Custom drink color is a static placeholder.** `#888888` for now —
  picking a meaningful color from a freeform mix is harder than it's
  worth, and the glass renders fine without it. Admin can set a real
  color when promoting.
- **Submissions tab sits between Recipes and Maintenance.** Admin browses
  Recipes most often; Submissions is reviewed in batches; Maintenance is
  the rare-but-physical operation. Ordering reflects access frequency.

## History tab

- **Raw log, not analytics.** The Dashboard tab already aggregates pours
  into donuts and top-N lists; History is the read-only log behind those
  numbers. Newest pour first, every entry visible without paging — the
  backend already caps `pour-history.json` at 500 rolling entries so the
  list can't grow unbounded.
- **One destructive action: Clear all.** Two-tap confirm pattern (matches
  Submissions discard) — first tap arms, second commits, auto-resets after
  3s. No per-row delete: the log is meant to be append-only between
  intentional wipes, and the dashboard would silently lose data if rows
  could vanish individually.
- **Time formatting flips at the day boundary.** Within 24h: relative
  (`5m ago`, `3h ago`); older: absolute (`May 4 · 2:14 PM`). Relative is
  fine for a glance at recent activity; older entries need a date so you
  can tell Tuesday from Sunday without counting hours.
- **Tab order: last.** History is the rarest tab to open (read-only,
  diagnostic). Sits after Maintenance; Dashboard / Inventory / Recipes
  remain the daily-use tabs at the front.
