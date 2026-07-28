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

## Persistent ingredient attributes

- **ABV, bottle size, and cost are attributes of the ingredient, not the
  slot.** They moved out of the inventory slot into a new persisted store,
  `src/server/state/ingredients.json` (`server/ingredients-store.js`), keyed by
  ingredient ID. A slot now records only what's physical to it —
  `{ slot, ingredientId, remainingOz }`. The attributes survive an ingredient
  being unloaded from every slot, so re-loading gin later restores its bottle
  size and cost instead of resetting to defaults.
- **ABV was promoted from a hardcoded map to editable data.** The old static
  `INGREDIENT_ABV` table in `ingredients.js` moved to `ingredient-defaults.js`
  where it now seeds the store and acts as the fallback for ingredients with no
  record. `ingredientAbv()` is re-exported from `ingredient-store.js` so the
  detail screen's estimate reflects admin edits.
- **Upgrade is migrated automatically.** On first boot with no
  `ingredients.json`, `ingredients-store.js` harvests each slot's legacy
  `capacityOz` / `costPerBottle` from `inventory.json` into per-ingredient
  records. `inventory.js` strips those legacy slot fields the first time it
  loads the file; the store loads first at boot so the migration wins the race.
- **Two editing surfaces.** The Inventory tab's level-column tap still opens the
  attributes editor (now also carrying ABV) for the loaded ingredient; a new
  **Ingredients** admin tab lists every known ingredient — loaded or not — so
  attributes can be set before an ingredient is ever loaded. Both write through
  `PUT /api/ingredients/:id`, which broadcasts `INGREDIENTS_UPDATED`.
- **remainingOz is no longer clamped to capacity server-side.** Bottle size
  lives on the ingredient now, so a payload can't be cross-checked against it in
  `inventory.js`. Downsizing a bottle below its current fill just caps the
  display (fill bar at 100%, bar-value fraction at 1) until the next refill.
- **Ingredients tab is grouped, not a flat alphabetical list.** Three sections —
  Spirits, Liqueurs & Aperitifs, Mixers & Juices — sorted by name within each.
  Group assignment needs no name-parsing: base spirits come from the existing
  `shotIngredients` list, anything else with ABV > 0 is a liqueur/aperitif, and
  ABV 0 is a mixer. An admin-added ingredient lands in the right group the
  moment its ABV is set.
- **One add-ingredient flow, used everywhere.** `components/new-ingredient.js`
  (`promptNewIngredient`) is the single path for introducing an ingredient —
  the Ingredients tab's "+ Add ingredient" button and the ingredient picker's
  "+ New" tile both call it. It collects a name, slugifies an ID, and `PUT`s an
  empty patch so a default attribute record is persisted immediately. That
  record is enough for `allIngredientIds()` to surface the ingredient (it now
  also reads the attribute-store keys), so a freshly-added ingredient appears in
  the catalog and picker even before it's used in any recipe or slot. Adding
  from the Ingredients tab drops straight into the attribute editor; adding from
  the picker stays low-friction and hands the ID back to the recipe/slot.
- **Delete is offered for orphan ingredients only.** The Ingredients tab shows a
  two-tap delete (`DELETE /api/ingredients/:id`) only on ingredients no recipe,
  top-up, shot, or pump slot references — i.e. ones that exist purely as a
  catalog record. An in-use ingredient can't be deleted: removing its record
  wouldn't unlink it (the recipe still points at it) and it would just reappear
  with default attributes, so the button is simply absent rather than disabled.

## Drink queue — shared, server-side

A queue lets guests stack drinks: tapping Pour while the machine is busy adds
the drink to a shared queue instead of being blocked. The queue is used from
the kiosk *and* from guests' phones on the AP, so it lives on the **server**.
(An earlier per-tablet frontend version was scrapped — a second phone had no
idea a queue existed, so its pour button stayed disabled while busy.)

- **The queue is server-owned and broadcast.** `src/server/queue.js` holds the
  waiting drinks; `index.js` orchestrates pours from it. The state is pushed
  to every client as a `QUEUE_STATE` broadcast (and on connect), exactly like
  `MACHINE_STATE`. The server is the single authority — which keeps
  multi-device use race-free with no client-side coordination.
- **The server orchestrates; clients never drive pours.** A client sends
  `QUEUE_ADD` (and `QUEUE_CONTINUE` / `POUR_CANCEL`); the server decides what
  pours and when. The old client-initiated `POUR` message and per-connection
  cancel are gone. Pour events (`POUR_PROGRESS` etc.) are now *broadcast*
  rather than unicast to the originating socket, so whichever device is on the
  pouring screen — kiosk or phone — follows along.
- **`QUEUE_ADD` routes itself.** If the machine is free the server pours the
  drink immediately; otherwise it waits in line. The server replies to the
  adding client with `QUEUE_ADDED { pouringNow, position }` so that client
  knows whether to open the pouring screen or just show an "Added to the
  queue — #N in line" toast. A guest who adds to a busy machine stays browsing
  (the chosen UX) — they aren't pulled onto the pour screen.
- **The pour button is reused, never disabled-for-busy.** On detail /
  shot-detail / build-your-own the confirm-pour button reads **Pour** when the
  machine is free and **Add to queue** when it isn't — the same button doing
  the queue's job. The only disabled state left is **Queue full** (`MAX_QUEUE`
  = 10, server-enforced) plus each screen's own recipe/stock blocks.
- **`src/queue-store.js` is a thin queue client.** It just mirrors `QUEUE_STATE`
  and sends `QUEUE_*` actions — no local queue, no pour orchestration. Screens
  read `getQueue()` / `onQueueChange()`. (Renamed from `round.js`, whose name
  didn't telegraph its job, to match the other `*-store.js` frontend caches.)
- **One queue screen, not a separate swap-glass screen.** `src/screens/queue.js`
  is the full list of stacked drinks *and* the between-pours pause. An earlier
  build had a separate focused swap-glass prompt; it was merged because there
  was no way to see the whole queue. The screen lists every waiting drink
  (glass, name, ingredients), marks the next one, and — when the machine is
  idle with drinks waiting — offers **Pour next**.
- **The queue lives in the header's status pill — reachable from every
  screen.** Rather than a separate header element, the queue folded into the
  existing machine-status indicator (`readyIndicator`): it now reads
  "Ready" / "Pouring" / "Maintenance" / "Paused" and appends "· N" when N
  drinks are waiting, and it's a button that taps through to the queue screen.
  So the queue is reachable from anywhere without hunting — which matters when
  multiple terminals each order a drink and then navigate away (an earlier
  idle-only banner, and then a separate count chip, both left gaps). One pill
  instead of two elements; it pulses in an accent colour when the round is
  parked for a Continue tap. The pill is on every screen except the queue
  screen itself (which shows the same state in-body).
- **Between pours: a manual Continue (chosen over auto-advance).** After each
  pour the server parks (`awaitingContinue`) instead of auto-starting the
  next; the pouring screen routes to the queue screen, where someone swaps the
  glass and taps Pour next (`QUEUE_CONTINUE`, valid from any device). The
  pouring / queue / complete screens are all passive views that route off
  `MACHINE_STATE` + `QUEUE_STATE`.
- **Adding to a busy machine lands on the queue screen.** That is the feedback
  for a queued drink — the guest sees it drop into the list — and it doubles
  as "see the full queue". (A toast was tried first and wasn't noticeable
  enough.) Pouring immediately still goes straight to the pouring screen.
- **The queue is manageable, not just viewable.** The queue screen removes any
  waiting drink (`QUEUE_REMOVE`) and clears the whole queue (`QUEUE_CLEAR`).
  This is also the **recovery path**: Pour next / Clear get a stuck or
  abandoned round moving again without a server restart. No auto-clear timer —
  it would silently drop a slow party's legit queue; an explicit Clear is
  safer, and the queue screen is always one tap away (the header status pill).
- **The pouring screen no longer owns the pour.** It renders the current pour
  from the shared machine job (`job.order`), and the pour continues
  server-side regardless of frontend navigation. So it now has a normal back
  button, and leaving it (e.g. via "Add drink" → the menu) is safe — no
  cancel-on-unmount.
- **Cancel and errors skip, they don't wipe the queue.** `POUR_CANCEL` (from
  any device) cancels the current pour; the server then parks for the next
  drink. A failed pour behaves the same. At a party one bad drink shouldn't
  nuke everyone else's, so the rest of the queue survives.
- **`startQueuedPour` releases the lock in a `finally`.** A terminal pour
  event always releases the machine even if broadcasting it throws — otherwise
  one bad `client.send()` could strand the machine "pouring" forever. It also
  guards against a driver that fires its terminal event synchronously (an
  unknown drink) overwriting the cancel handle with a stale value.
- **The queue is not cleared on inactivity.** It is shared across devices —
  one tablet's 60s auto-return-to-idle must not wipe everyone's drinks. It
  drains by pouring through it, or via Clear. (It is in-memory, so a server
  restart clears it — acceptable; no persistence was requested.)
- **Known limitation: a disconnected viewer can briefly lag.** If a client's
  socket drops and it misses a `POUR_COMPLETE`, it catches up from the next
  `MACHINE_STATE` / `QUEUE_STATE` on reconnect. The server never misses
  anything (it owns the pour), so the queue stays globally correct.

## On-device backups

Backups were download-only. Now `GET /api/backup` also writes a copy onto the
Pi, and the Maintenance tab browses, restores, and deletes those copies.

- **Backups live in `src/server/backups/`, a sibling of `state/` — never
  inside it.** `createBackup()` bundles every `state/*.json`; a backup file
  dropped in `state/` would get recursively re-bundled into the next backup.
  The folder is gitignored, like `state/`.
- **Export does both — download and on-device save in one tap.** The export
  endpoint streams the download (`Content-Disposition`) and writes the Pi copy
  in the same request. The saved filename rides back in an `X-Backup-Saved`
  response header so the client reports honestly whether the on-device copy
  landed; a failed disk write (full/read-only SD card) is logged and the
  download still proceeds rather than failing the whole export.
- **Restore-by-name reads the bundle server-side** (`POST
  /api/backups/:name/restore`) instead of round-tripping it through the
  client. Filenames are validated with the same `SAFE_NAME` slug rule that
  filters `state/`, which doubles as the path-traversal guard. The file-upload
  restore (`POST /api/restore`) stays for restoring a bundle that isn't on the
  Pi (e.g. one downloaded to a laptop).
- **No auto-pruning — delete is manual.** The browse list gives each backup a
  Delete action; the server never removes a backup on its own. Restore and
  Delete both use a two-tap arm-to-confirm, since both are destructive.


## Mobile order page: category filter

The horizontal scroll of pill chips was replaced with a single-select dropdown.

- **Single-select, `null` = "All".** `state.activeCategory` holds one category
  id or `null` (no filter, show everything). The "All drinks" row sets it back
  to `null`. (A multi-select version was tried and rejected — one category at a
  time keeps the picker simple.)
- **The dropdown closes on pick.** Single-select means one tap finishes the
  choice, so selecting a row closes the menu. It also closes on a tap outside (a
  transparent full-screen catcher) or a second tap of the trigger. `filterOpen`
  lives in `state` so it survives the rerenders that picking — and background WS
  updates — trigger.
- **Cards animate only on a filter change.** A one-shot `filterChanged` flag,
  consumed by `renderList()`, gates a staggered fade-and-rise. Background
  rerenders (queue, machine status, pour progress) fire constantly; animating on
  every one would make the list flicker, so they leave the flag false. The
  per-card stagger is capped at 8 steps so a long list doesn't trail off.
- **Flat per the design rules.** No drop shadow or blur — the panel reads as a
  surface via its border + `--bg-surface` fill. A dark scrim dims the rest of
  the page while the menu is open (matching the drink sheet's backdrop); a flat
  semi-transparent overlay is consistent with "flat only" in CLAUDE.md.

## Pre-pour glass wait has a timeout

The real-hardware pour driver waits for a glass on the platform before
dispensing (`serialPour.js`). That wait used to be unbounded.

- **The glass wait caps at 120s, then fails with `POUR_ERROR { code: "NO_GLASS" }`.**
  An unbounded wait holds the machine-state lock for as long as it runs, which
  blocks the entire shared queue — and the pouring screen is exempt from the
  60s inactivity auto-return, so a guest who taps Pour with no glass and walks
  away would strand the machine until someone did the 2s hold-to-cancel. The cap
  routes through the normal terminal-event path, so the lock releases and the
  queue advances/parks on its own. 120s is generous enough that fetching a glass
  never trips it, short enough that an abandoned pour self-recovers. Mock mode is
  unaffected — it proceeds after a fixed 3s and never enters this loop.
- **`pouring.js` carries matching copy** for the `NO_GLASS` code ("No glass
  detected — place a glass on the tray and try again") so the failure reads
  clearly instead of falling through to the generic "Pour failed" branch.

## Server REST layer split into route modules

`index.js` had grown to ~950 lines, two-thirds of which was one `handleApi`
route table. This is structure only — no endpoint behavior or contract changed.

- **Routes live in `src/server/routes/*`, one module per domain**, dispatched by
  a slim `handleApi` loop in `index.js`. Each module exports a
  `(req, res, urlPath, ctx) => bool` handler that claims the requests it
  recognises. Shared `sendJson` / `readJsonBody` plus a `jsonRoute` helper (folds
  the repeated try/catch-to-JSON shape) live in `src/server/http-util.js`;
  `withMachineLock` (acquire → 409-if-busy → release) lives in the maintenance
  route module, its only consumer. `ctx` carries `broadcast` so routes don't
  import `index.js` (no cycle).
- **GET routes now return a JSON 400 on error** instead of an unhandled
  rejection — a strict improvement that fell out of wrapping every handler in
  `jsonRoute`. The admin Maintenance view was split the same way
  (`components/maint-ui.js`, `calibrate-modal.js`, `scale-modals.js`,
  `screens/admin-backup.js`).

## Addressable LED strip

A WS2812B strip on the Pi shows pour progress and a celebration held until the
finished drink is lifted off. Wiring is documented in
[led-wiring.html](led-wiring.html).

- **Driven from the Pi, not the Arduino.** The Nano has no free pin — all 16
  relay channels plus the HX711 consume every usable GPIO (D0/D1 are USB serial,
  A6/A7 are analog-input-only). So the strip hangs off the Pi's GPIO and
  `src/server/leds.js` owns it end to end; no firmware or serial-protocol change.
- **Mock-first, like `mockPour`.** With `LED_STRIP` unset the same animation
  state machine runs against a no-op sink (laptop dev, or a Pi before the strip
  is wired). `LED_STRIP=ws2812` switches to the real `rpi-ws281x-v2` binding; if
  that binding is missing or fails to init, it falls back to the mock sink so the
  backend still boots — LEDs are non-essential.
- **The strip is driven by a Python helper, not a Node binding.** The
  Node-native WS2812 bindings are unmaintained and fail to compile against
  modern Node/V8 (they call removed APIs — `v8::Object::Get`,
  `ArrayBuffer::GetContents`). `scripts/led-helper.py` uses the maintained
  `rpi_ws281x` Python library; `leds.js` spawns it once and streams one frame
  per line (LED_COUNT hex triplets). Animation stays in JS — the helper is a
  dumb sink. `install-kiosk.sh` installs the lib via `pip3
  --break-system-packages` (Bookworm is externally-managed), so nothing lands
  in `package.json` to break cross-platform `npm install`.
- **Data pin GPIO21 (PCM, pin 40), not GPIO18 (PWM).** Both are valid
  rpi-ws281x outputs, but PWM (GPIO18) shares the onboard analog-audio block —
  using it would force disabling audio; PCM (GPIO21) leaves audio alone. GPIO18
  is kept as a documented alternate (`LED_GPIO=18`). SPI (GPIO10), the only
  root-free option, was skipped because the SPI method is unreliable on the 3B+
  (core-clock drift).
- **The backend runs as root when LEDs are enabled.** The PCM/DMA path needs
  `/dev/mem`, so `install-kiosk.sh` flips the service `User` to root only when
  LEDs are turned on. A deliberate trade for a single-purpose appliance;
  switching to an APA102 (SPI) strip would remove it, changing only
  `realStrip()` in `leds.js`.
- **Modes driven off existing signals.** Pour lifecycle → `waiting` / `pouring`
  (bar tracks `POUR_PROGRESS.pct`) / `ready` / `error`, hooked in the single
  pour callback in `index.js`; the `ready` celebration holds until glass-watch
  reports the drink removed (`glassPresent` false). No new sensing.
- **Bring-up aid: a "Test LED strip" button** in admin Maintenance
  (`POST /api/maintenance/led-test`) cycles every mode for ~7s under the machine
  lock, so wiring can be verified without pouring a drink.
- **Strip sizes are code constants, not env vars.** `BAR_COUNT` (60) and
  `DISP_COUNT` (20, the chained dispenser strip) live in `leds.js` with
  `LED_COUNT` derived from their sum — a single-purpose appliance sizes its
  hardware in version control, like `SLOT_COUNT`. The only device env the
  service needs is `LED_STRIP=ws2812` (set by `install-kiosk.sh`);
  `LED_BAR_COUNT` / `LED_DISP_COUNT` remain as optional overrides for a
  different build. Earlier this lived in systemd env, which split the config
  off-repo and made the two counts easy to set inconsistently.

## Dispenser zone pours in the ingredient's color

The dispenser strip flowed a fixed green for every ingredient. It now tints to
whatever is actually coming out of the spout, driven by the `step` already on
every `POUR_PROGRESS` event — no new signal.

- **Only the dispenser is tinted; the bar stays green.** The bar is the
  progress indicator, and re-coloring it per step would trade a readable
  "how far along am I" signal for decoration. Splitting the two zones by job
  (bar = progress, dispenser = what's flowing) keeps both legible.
- **The palette moved to `ingredient-defaults.js`.** `INGREDIENT_COLORS` lived
  in `src/ingredients.js`, which imports the browser-only WS stores and so
  can't be loaded from Node. `ingredient-defaults.js` was already the shared
  DOM-free module for exactly this reason, so the map moved there and
  `ingredients.js` re-exports `ingredientColor()` unchanged — `glass.js` and
  every other consumer were untouched. The module's remit widened slightly
  (it's now "static per-ingredient data", not only attribute-store seeds).
- **Colors are normalized to full brightness for the strip.** The catalog
  palette is tuned for a dark screen, which wants the opposite of what a strip
  wants: a screen renders kahlua `#3A2418` as dark brown, but an LED can only
  emit light, so that value is a pixel that's essentially off. `ledColorFor()`
  scales each color until its brightest channel hits 255, preserving hue and
  relative saturation — kahlua becomes a warm amber (4.4× boost), cola and
  bitters likewise. Genuinely clear spirits (gin, vodka, soda) land near-white,
  which is honest but does mean they're not distinguishable from each other on
  the strip. Accepted: the alternative is inventing colors for colorless
  liquids. The `ready` glitter is still distinct from them by motion, not hue.
- **Unknown ingredients keep the old green, not the catalog's grey.**
  `ingredientColor()` falls back to `#888888`, which on a strip is a murky
  off-white that reads as a fault rather than a pour. An admin-added ingredient
  with no palette entry simply pours green, as everything did before.
- **The step change drives its own crossfade.** Switching gin → campari isn't a
  mode change, so `setLedMode`'s existing fade never fired for it; the
  ingredient branch calls `startFade()` itself when already in `pouring`. The
  resolve is guarded on the id actually changing, so it runs once per step
  rather than on every progress event — which also keeps the new
  `[leds] dispenser <id> -> rgb(...)` log as quiet as the mode log.
- **The self-test sweeps campari / midori / blue-curaçao.** Three far-apart
  hues, so a GRB-vs-RGB strip miswiring is obvious at a glance during bring-up
  instead of showing up as one subtly wrong drink later.

## The scale closes the loop on inventory and calibration

Three changes that all cash in the same asset: on real hardware every pour
already weighs itself, and until now we threw that measurement away once the
progress bar had used it.

### Bottle levels bill the measurement, not the recipe

- **`consume()` deducts `actualOz` when the caller supplies it.** `serialPour`
  parses the firmware's `DONE <grams>` and attaches it per ingredient; `mockPour`
  supplies nothing and keeps the old recipe-volume behavior, so dev and hardware
  stay consistent in shape if not in precision. The point is drift: per-pour
  error used to accumulate in one direction across a whole bottle, so a level
  that started accurate slowly stopped being. Billing the measurement makes it
  self-correcting.
- **An absurd measurement falls back to the recipe volume** (`MAX_MEASURED_RATIO`
  = 2× requested). The firmware stops the pump at target-minus-guard, so a
  healthy pour always lands near target; a value twice that came from someone
  leaning on the platform, not from the pump. Bounds what one bad reading can do
  to a bottle level without discarding honest small variance.
- **Pour history still records recipe volumes, not measured ones.** History
  feeds the dashboard, and `mockPour` can't produce measurements — mixing
  sources would make the same drink read differently depending on where it
  poured. Worth revisiting if the dashboard ever needs true consumption.
### Interrupted pours bill for what actually left the bottle

This reverses the earlier "inventory is consumed on `POUR_COMPLETE`, not per
step" decision for the hardware path. That rule existed because a cancelled
pour left physical state ambiguous — *how much actually dispensed?* — and
halving the decrement would have been guesswork. It isn't guesswork any more:
the scale measures every step, so the question the original decision couldn't
answer now has a number attached.

- **`consume()` runs from a `.finally()` on the pour promise**, so every exit
  path — finished, failed, cancelled, or thrown — charges the bottles for what
  they gave up. A drink that dies on its third ingredient still physically
  emptied two into the glass. Guarded to run exactly once, and it swallows its
  own errors: it runs after the outcome has been reported, so a failure here
  must not resurface as a bogus `SERIAL_ERROR`.
- **A `.finally()` rather than a `try` block inside the pour body.** Identical
  guarantee, without re-indenting ~200 lines of unrelated pour logic under an
  extra level.
- **The firmware reports grams on its failures too**, not just on `DONE` —
  `no-flow`, `pour-timeout`, `glass-removed`, and `scale-timeout` all carry the
  weight delivered before they gave up. `parsePouredOz()` reads the last token
  of any reply, so one function covers every form: replies that don't know the
  volume (`ERR aborted` from a STOP, `ERR bad-slot`) end on a word, which parses
  as NaN and answers null. No per-reason table to keep in sync with the sketch.
- **A cancelled pour is billed from the last `PROGRESS` line.** A STOP makes the
  firmware abort without reporting grams, so the stream is the only measurement
  left — and at a 250ms cadence it's at most a quarter-second stale.
- **An interrupted step never falls back to the recipe volume.** This is the
  one asymmetry worth stating plainly: a *completed* step with an unreadable
  reply bills the recipe volume (it finished, so the liquid left the bottle),
  but an *interrupted* step with no measurement bills nothing. A failed pour may
  have delivered none of what was asked for, and charging a bottle for liquid
  that never left it is the only direction that makes levels worse rather than
  better. Under-billing self-corrects at the next refill; over-billing compounds.
- **Pour history still records only completed drinks, at recipe volumes.** So a
  failed drink now moves inventory without appearing in history. That's a real
  divergence, and it's the honest one: the bottle genuinely emptied, and the
  drink genuinely wasn't made. Revisit if the dashboard ever needs to reconcile
  the two.

## "Your usual" on the mobile order page

A returning phone gets one-tap repeats of what it has ordered before, above the
drink list.

- **Stored on the phone, not the server.** `clientId` already reaches the live
  pour job, so server-side attribution was available — but it would have meant
  threading the id through both pour drivers into `recordPour`, and it would
  have de-anonymised the admin History tab as a side effect. A guest's drinking
  history is a personal convenience, not the machine state CLAUDE.md's
  localStorage rule is about. `src/order-usual.js` sits alongside
  `order-client-id.js`, which already owns per-device state. Cost: clearing site
  data forgets it, and the kiosk can't show it.
- **A "usual" is drink + strength + amount**, not just the drink. One tap has to
  reproduce what the guest actually had, so a strong double Margarita is a
  different usual from a plain single.
- **Recorded only once the queue accepts the order**, so a rejected (queue-full)
  order never becomes someone's usual.
- **Ranked by count, tie-broken by recency**, showing at most three.
- **The list is kept newest-first by construction rather than sorted on a
  timestamp.** Two orders in the same millisecond share a `lastAt`, and a stable
  sort then falls back to array order — which is oldest-first, so pruning the
  tail would drop exactly the entries worth keeping. Unshifting on write removes
  the failure mode instead of making it rarer. (A test caught this; a guest
  ordering 25 drinks in one millisecond would not have.)
- **Hidden while a category filter is active**, and hidden for usuals whose
  drink was deleted or is currently unpourable — the same availability rule the
  main list uses. A shortcut that ignored the filter would read as a bug.
- **One tap goes straight to the queue.** The full sheet is still one tap away
  on the drink's own card below, so nothing is lost by skipping it here.

## QR code on the idle screen

A corner card on the attract screen gets guests onto the order page.

- **It encodes Wi-Fi credentials, not a URL.** This is the whole point and the
  easiest thing to get wrong: the feature exists for guests who *haven't joined
  the network yet*, and those phones cannot reach `http://10.42.0.1:3000/order`
  at all. A URL QR would scan straight into a dead end — worse than no QR. The
  card emits a `WIFI:T:WPA;S:…;P:…;;` join string, which iOS 11+ and Android
  read natively from the camera app; joining trips the captive portal, which
  already lands them on `welcome.html`.
- **It appears only in AP ("host") mode.** Every other network state renders
  nothing. Client mode — the Pi on the house Wi-Fi — was briefly built to show
  a plain `/order` URL instead, and that does work, since guests there are
  already on the network. It was removed in favour of a quieter attract screen:
  on a home network the people using the machine are generally the ones who set
  it up, so the discovery problem the QR solves isn't really present. Restoring
  it means reading `ip` from `/api/network/status` and emitting
  `http://<ip>:<port>/order`; the reasoning is recorded in `order-qr.js` so the
  branch can come back without re-deriving it.
- **The encoder is vendored** (`src/components/qr.js`), the only borrowed
  algorithm in the tree. Shelling out to the `qrencode` apt package — the way
  `network.js` already shells out to `nmcli` — was the alternative and would
  have been ~15 lines, but it wouldn't work on a dev laptop and adds a system
  dependency. Vendoring keeps the project's no-npm-dependency rule intact and
  works everywhere.
- **It is deliberately narrow: byte mode, EC level M, versions 1-10.** That's
  what keeps the spec tables small enough to audit — a general encoder needs all
  four EC levels across 40 versions. 213 bytes is far more than a join string or
  a LAN URL needs, and it throws rather than silently truncating past that.
- **It exceeds the 200-line file guideline, knowingly.** It is transcribed
  ISO/IEC 18004, not authored logic, and splitting it would only scatter one
  algorithm across files. It is not meant to be maintained by hand — the check
  is the test, which round-trips encode→decode, verifies Reed-Solomon syndromes
  vanish, and compares the block-structure table, BCH version strings, and
  free-module counts against published spec values. Re-run it if this is ever
  touched.
- **A white card on a black UI.** Scanners want dark modules on a light field,
  so this is the one deliberately pale surface in the kiosk. Kept small and
  pinned bottom-right, absolutely positioned so the centred featured drink
  doesn't move and its absence costs no layout.
- **The payload is read once per mount.** A network-mode change mid-idle isn't
  picked up, which is fine: changing it means visiting the admin Network tab,
  and leaving admin re-mounts idle.
- **The Wi-Fi passphrase is on an always-on screen.** Deliberate — it's a party
  appliance whose AP password is meant to be shared, and the alternative is
  reading it aloud. Worth knowing before pointing the kiosk at a network whose
  password isn't disposable.

### `no-flow` takes the slot out of service

- **`ERR no-flow` zeroes the slot and files a notification.** The firmware
  already distinguishes "pump ran, weight never moved" from every other failure;
  nothing consumed that distinction. Now the slot is marked empty, which is what
  actually stops the bleeding: the UI shows it empty and drinks needing it are
  blocked, instead of each guest in turn rediscovering the same dead bottle.
- **Zeroing is a claim, and it's the right one even when the cause is a clog.**
  no-flow means empty, kinked, or detached; we can't tell which from here, but
  all three mean the slot can't deliver. Zero is the honest "unavailable"
  signal, and a refill or a fixed line is followed by an inventory edit anyway.
- **The notification uses the raw ingredient ID** ("Slot 6 (campari)…"). The
  pretty-name map lives in the browser-only `ingredients.js`; moving it for one
  admin-facing diagnostic line wasn't worth a second module migration.
- **`serialPour` announces via its `send` callback, not a broadcast handle.**
  It mirrors `mockPour`'s signature so `index.js` can swap the two on one env
  check, and threading `broadcast` in would have meant changing both. `send` is
  already the driver's channel to every client, and `index.js` relays anything
  non-terminal through untouched.

### Flow rates learn from ordinary pours

- **Every successful step folds its measured rate into that slot's
  calibration**, so the manual wizard becomes a first-run tool rather than
  routine maintenance. It still works, and is still the right way to seed a
  brand-new slot.
- **The rate is measured across the PROGRESS window, never total command
  time.** This is the whole reason `flow-learn.js` exists as its own module. A
  `POUR` spends roughly 1.7s per call on things that aren't pumping: a 10-sample
  baseline average (~1s at the cell's 10Hz), a 50ms settle, then 150ms plus a
  5-sample settling read at the end. Dividing volume by total duration would
  report every pump as far slower than it is, worst on small pours — a 0.25oz
  dash from a true 0.25 oz/s pump measures as ~0.09 oz/s, and would drag that
  slot down every time someone ordered an Old Fashioned. First-to-last PROGRESS
  sample excludes both ends.
- **Small pours teach nothing, and that's reported as `null`.** Gates are ≥3
  samples, ≥1s span, ≥5g moved. The two span gates cover opposite failure
  modes: the time gate stops serial jitter dominating a fast pump's short
  window, the weight gate stops load-cell noise dominating a slow one's light
  window. A dash of bitters simply doesn't qualify.
- **One pour nudges, it doesn't set** (`LEARN_ALPHA` = 0.2). A slot with no
  stored rate takes its first observation whole — there's nothing to average
  against and the seeded default is a guess worth replacing immediately. After
  that, ~20 pours converge on a changed rate, which is fast enough to track new
  tubing or a thicker syrup and slow enough that one odd pour doesn't move much.
- **Observations more than 3× off the stored rate are discarded.** A pump
  doesn't triple in speed between drinks; a reading that says so came from a
  bumped platform or a mid-pour top-up. Real drift is gradual and well inside
  the band.
- **A step that succeeded inside a drink that later failed still teaches.** Its
  measurement is valid regardless of what happened two ingredients later.
- **Learning writes are fire-and-forget**, like `consume` and `recordPour`. A
  calibration write must never delay or fail a drink.
- **No provenance flag on learned-vs-manual rates.** The admin UI shows a rate;
  where it came from doesn't change what it means. Worth adding only if someone
  is ever surprised by a rate moving under them.
