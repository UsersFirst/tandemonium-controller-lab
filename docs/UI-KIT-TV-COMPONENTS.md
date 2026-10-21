# UI kit: components for the TV lobby

Status: proposal, 2026-10-20. Nothing here is built yet.
Source: the Tandemonium desktop/TV review ([petegordon/Tandemonium#428](https://github.com/petegordon/Tandemonium/issues/428), mockups on draft PR [#429](https://github.com/petegordon/Tandemonium/pull/429), `scripts/ui-audit/layouts/` rounds 1–5).
Builds on: [UI-DESIGN-SYSTEM-PLAN.md](UI-DESIGN-SYSTEM-PLAN.md) (D1–D4, "Next" item 5: `uf-card` / `uf-sheet` "when the second use appears").

The review settled on one TV/desktop lobby layout:
- The painting is a fixed panel on the right, with the wordmark on it.
- The menus take the remaining 1385px.
- A bottom system bar holds Back, Help, Leaderboard, Profile, a Controls pill and Music.
- Seats are team boxes, with a strip of every connected controller under them.
- Controls, phone pairing and help open as sheets.

Building it screen by screen would repeat what already happened: the lab lobby and the game both hand-built the same team box, seat card and "controllers not seated yet" strip. This document lists what to build once, which layer it belongs in, and the order.

## Summary

| # | Piece | Layer | Status | Replaces (game · lab) |
|---|---|---|---|---|
| 1 | Device display identity (`shortName`, `glyphFamily`, connection) | core | new fields | game `_prettyGamepadName`, mock name maps · lab `devName()` |
| 2 | Roster snapshot (every controller + state + seat) | core | new function | game `_versusCandidates` + `_renderVersusControllers` · lab lobby-app `cstate/gstate` derivation |
| 3 | `uf-controller-glyph` | kit | new | hand-typed `<b>A</b>` / `✕` in hints, spinner icons, seat hints |
| 4 | `uf-button` `sub` + `icon` | kit | extend | game two-line mode buttons, `.lobby-toggle` round icons, bar pills |
| 5 | `uf-seat` TV size, `candidate` state, glyph hint | kit | extend | game `.versus-player-card` (+ `.vp-join` / `.vp-empty`), `.lobby-btn-p2-*` join buttons |
| 6 | `uf-team` | kit | new | game `.versus-team*` · lab `.team` / `.tandem` / `.tandem-seats` |
| 7 | `uf-controller-roster` (strip / list) | kit | new | game "Controllers ▴" list · lab `.lounge` chips + Controllers panel |
| 8 | `uf-sheet` | kit | new | game: about 15 shells (`#phone-pad-panel`, `#help-modal`, `#leaderboard-modal`, `#profile-popup`, `#motion-recal-popup`, `#keyboard-confirm-popup`, `#options-overlay`, `#quick-menu-sheet`, `#daily-mode-overlay`, …) |
| 9 | `uf-system-bar` (system bar / step footer) | kit | new | game `.lobby-toggle-col`s, `.gamepad-back-hint`, `.lobby-credits` footer |
| 10 | `uf-setting` (setting row) | kit | new | game Stick / Gyro / Music toggles, Motion popup slider row |
| 11 | `uf-card` | kit | new (planned) | game `.level-card` |
| 12 | `uf-keypad` + `uf-join-code` | kit | new | game `.code-spinner` ×4 + `.room-code-prefix-vert`, `.room-code` display |
| 13 | `uf-qr` | kit | new, optional | game `.ppp-qr`, `#room-qr` |
| — | TV type scale, stage inset | tokens | change | the game's `calc(N * var(--ls))` system (about 400 rules) |

Compositions built from these pieces (not new elements): **Seat select** (co-op, versus, lab lobby), the **Controls sheet**, **Join with a code**, and the **Invite** column.

## Core (`packages/core`)

### 1. Device display identity
`DEVICES` already has a full `name` and a `protocol` for every controller. The UI needs three more things, and today each screen works them out itself.

- **`shortName`**: the name a seat or chip shows, for example "DualSense", "DualShock 4", "Switch Pro", "Super Nova", "Steam Controller" or "Xbox". Today the game shows the full name in caps ("STEAM CONTROLLER 2026 (DIRECT USB-C)"), and the mockups had to keep their own map.
- **`glyphFamily`**: `'playstation' | 'xbox' | 'nintendo' | 'steam' | 'generic'`. It defaults from `protocol` (`dualsense` → playstation, `switch-pro` → nintendo, `xbox` → xbox, `steam-controller` → steam). An entry overrides it when needed: GameSir DS4 mode → playstation, Cyclone Switch mode → nintendo. `quirks.swapAB` stays where it is and `uf-controller-glyph` reads it, so confirm is always the button the player thinks of as confirm.
- **`connection`** on the live slot: `'usb' | 'bluetooth' | 'puck' | 'webhid' | 'steam-input' | 'gamepad-api' | 'keyboard'`. The Controls sheet list shows it, so it stops being baked into the name.

Bug to fix while doing this: with a Puck (`28de:1304`) the game labels the controller "Steam Controller 2026 (direct USB-C)". The registry has the right `via Puck` entry, so the lookup picks the wrong one. It was seen with the review's simulated Puck, so confirm it on real hardware.

### 2. Roster snapshot
Both the strip and the list need the same thing: every controller the page can see, its state, and its seat. The lab lobby derives this in `lobby-app.js` (`STATE_LABEL`: CONNECTED → JOINED → SEATED → READY), and the game derives it again in `_renderVersusCards` / `_renderVersusControllers`. Move it into core:

```js
manager.controllerRoster() → [{ id, device /* DEVICES entry */, shortName, glyphFamily, connection,
                      state: 'connected' | 'joined' | 'seated' | 'ready',
                      seat?: { team: 'a' | 'b' | 'coop', role: 'captain' | 'stoker' | null, player: 1..4 },
                      active: boolean /* input in the last ~1 s */ }]
```

The keyboard is a row too, so the roster is complete (the game's versus list already lists it). Seat assignment stays with the app. Core only reports it.

## Kit (`packages/ui`)

Every new element goes through `npm run ui:new-element`: typed props, a gallery section with every state, and a screenboard capture at phone, desktop and TV. Shared rules:
- Light DOM.
- Token-only styles.
- `render()` is a pure function of props.
- Lists take data through a property, not authored children.

### 3. `uf-controller-glyph`: button prompts
```html
<uf-controller-glyph button="confirm"></uf-controller-glyph>           <!-- ✕ on PlayStation, A on Xbox, B-position A on Nintendo -->
<uf-controller-glyph button="back" family="nintendo"></uf-controller-glyph>
<uf-controller-glyph button="delete"></uf-controller-glyph> Delete     <!-- □ / X / Y -->
```
- **Props:** `button` (`confirm | back | alt | menu | start | dpad | dpad-h | dpad-v | lb | rb | lt | rt | ls | rs`), `family` (`auto` by default, which follows the active P1 controller through a document-level `uf:glyph-family` event the app dispatches), `size`.
- **Renders:** the shape glyph (✕ ◯ □ △), the Xbox letter colours, the Nintendo letters in Nintendo positions, and Steam's letters. On the keyboard it shows the key (`Enter`, `Esc`, `Backspace`).
- **Fixes:** finding 13 (Switch Pro and Steam Controller show generic glyphs; the ride hint says "LB/RB" whatever the pad).
- **Unlocks:** `uf-step`'s `hint` and `uf-seat`'s hint can say `<uf-controller-glyph button="confirm">` instead of hard-coding `<b>A</b>`.

### 4. `uf-button`: `sub` and `icon`
- **`sub="Couch co-op, online or versus"`**: a second, smaller line. The kit's CSS already styles a `.sub` child, so this makes it a prop. Used by the mode buttons, level-select CTAs and Controls rows.
- **`icon`**: a leading icon slot (an `<svg>` or a `uf-controller-glyph`). With `size="pill"` it's the bar pill: icon + label, 56px high at TV scale. It replaces the 64px round `.lobby-toggle`s, whose icons ("ALL", joystick) the review found unreadable without a label.

### 5. `uf-seat`: extend, don't replace
`uf-seat` (seat / who / dev / state / tone / badge) already covers the lab lobby and the game's room step. The game's versus step doesn't use it: it builds `.versus-player-card` by hand, which is why its labels ended up near-black and 9.9px. Extensions:
- **`state="candidate"`**: a connected, unseated controller offered for this seat ("Switch Pro · press ✕ / A"). It replaces `.vp-join` and the stack of "JOIN AS PLAYER 2" buttons. `open` stays the plain empty seat.
- **`hint`**: the `dev` line can hold a `uf-controller-glyph` ("press <uf-controller-glyph button=confirm> on any controller").
- **TV sizing:** the role, who and dev lines move from `xs` / `sm` to `sm` / `lg`, so the TV token scale (below) carries them. The mockups used 26px for who and 18px for dev at 1080p.
- **`focus` styling:** the seat is focusable when `candidate` or `open` (FocusController picks it up through `uf-step.focusables()`).

### 6. `uf-team`: the team box
```html
<uf-team tone="team-a" heading="TEAM BLUE"> <uf-seat …></uf-seat><uf-seat …></uf-seat> </uf-team>
<uf-team tone="coop"   heading="YOUR TANDEM"> <uf-seat seat="Captain" tone="captain" …> <uf-seat seat="Stoker" tone="stoker" …> </uf-team>
```
- A titled, tinted frame that lays out its `uf-seat` children in a row (TV) or a column (narrow).
- **Props:** `tone` (`team-a | team-b | coop`), `title`, `capacity`, `layout` (`row | column | auto`).
- **Used by:** versus (two, with a `vs` separator from the parent layout), local co-op (one: Captain + Stoker; the review's round 4–5 "Local multiplayer" column), and the lab lobby (it replaces `.teams` / `.team` / `.tandem` / `.tandem-seats`).

### 7. `uf-controller-roster`: every connected controller
One element, two densities, fed by core's `controllerRoster()`.
- **`variant="strip"`** (seat-select screens): one chip per controller. Seated chips carry the seat badge in their team or role colour (Captain, P1–P4). Spare chips say "press ✕ / A", or "seats full" once the screen is full. The header reads "Connected controllers · 8" and "4 of 4 seats taken". It's always visible and wraps to a second row.
  - This settles the review's question: the expandable list hid controllers, and a one-line "Also connected" didn't scale to 8.
  - It replaces the lab's `.lounge` chips and the game's collapsed list.
- **`variant="list"`** (the Controls sheet, the lab's Controllers panel): one row per controller with `shortName`, connection (`Gamepad`, `WebHID · gyro`, `Steam`) and state chips (the existing `uf-chip` tones and the CONNECTED / JOINED / SEATED / READY words). This is the troubleshooting view: "does the game see my controller?"
- **`active`** pulses the lab's "being used now" dot.
- **Events:** `uf-controller-roster:select` (`detail.id`), for "Change controller".

### 8. `uf-sheet`: one shell for panels and dialogs
- The game has about 15 hand-made overlays with different backdrops, close rules and focus handling. Several don't close on ◯ / B (finding: Garage), and the phone sheet re-implements its own pad polling to close.
```html
<uf-sheet id="controls" heading="Controls" placement="center" open> …content… <div slot="actions">…</div> </uf-sheet>
```
- **Props:** `title`, `open`, `placement` (`center | side | bottom`), `size` (`sm | md | lg`), `dismissible` (default true).
- **Behaviour:** a scrim plus a card. It covers only the stage (`inset-inline-end: var(--uf-stage-inset)`), so a lobby painting stays visible. Back (◯ / B / Esc) closes it. It's its own FocusController scope while open, with focus restored on close.
- **Events:** `uf-sheet:open`, `uf-sheet:close`.
- **Header:** title plus a "◯ Close" `uf-controller-glyph`. The `actions` slot is a right-aligned footer row.
- **Used by:** the Controls sheet, phone as controller, help, leaderboard, profile, settings, and the in-ride options / quick menu. End-of-ride screens can use `placement="center" size="lg"` with one shared action bar; the review found game over, victory and demo end all different.

### 9. `uf-system-bar`: the system bar
```html
<uf-system-bar>
  <uf-controller-glyph slot="back" button="back"></uf-controller-glyph>            <!-- "◯ Back", hidden on the root step -->
  <uf-button size="pill" icon="help">Help</uf-button> … <uf-button size="pill" id="controls-pill">…</uf-button>
</uf-system-bar>
```
- Fixed to the stage bottom (84px at TV scale).
- **Layout:** Back on the left (reads `uf-flow`'s history: hidden when there's nothing to go back to), a start group, and an end group.
- **Focus (decided):** no dedicated button. The bar is a focus row below the step, reached with ↓ on the d-pad or the left stick (FocusController already reads both) from the step's last row.
  - ↑ returns to the item you left, because the step's focus is remembered.
  - ← / → move along the bar.
  - Long steps don't get in the way: Back (◯ / B) is the most-used bar action and is a button already, and nothing else in the bar is urgent.
  - A shortcut can be added later if playtests show players hunting for it.
  - This is the "toggle columns outside the steps need a home" problem in the plan's "Next" item 1, solved by giving them one.
- **Also absorbs:** the version and credits, which move into Help, ending the overlap between the footer and Back.

### 10. `uf-setting`: a setting row
- Label, a muted description, and an On/Off pill. Variants: `toggle` and `value` ("Automatic ›").
- An optional `slot="detail"` holds an indented sub-row (the gyro "Steering feel" slider + Recalibrate).
- Confirm toggles it. **Event:** `change`.
- **Used by:** the Controls sheet, settings and music volume. A `uf-slider` can wait until a second slider exists.

### 11. `uf-card`: selectable content card (already planned)
- Icon, title, description, a footer line (record / medal), `selected`, `locked`, `tone` (the game's tutorial dashed style and the gold Today's Road style become tones).
- Laid out by the parent in a row: four across fits 1385px. It fixes finding 1 (level select ran 140px off a 1080 screen while START RIDE had focus).
- **Also used by:** Garage items and Slingshot upgrades.

### 12. `uf-keypad` + `uf-join-code`: entering and showing short codes
- **`uf-join-code`**:
  - Display mode (`value="TNDM-K9NE"`): mono, tone-coloured; the captain's room code.
  - Entry mode (`prefix="TNDM–" length="4"`): empty slots with a cursor; the stoker's join screen.
  - Because both screens use the same element, they visibly match.
- **`uf-keypad`**:
  - An on-screen keyboard for d-pads. `alphabet` defaults to the room-code set `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, which fills an 8×4 grid exactly.
  - Delete and Done keys; a physical keyboard types straight into the linked `uf-join-code`.
  - About 4 moves per character, against up to 16 spinner steps today.
  - Events: `input` and `submit`.
  - Generic enough for profile names later.

### 13. `uf-qr`
- A QR code at couch-scanning size (≥ 420px at 1080p, white quiet zone), a caption, and a short link line.
- An optional "Can't scan?" disclosure shows the full link with its secret.
- Takes either `value` (the link; the kit draws it with a vendored QR encoder, as the game already does with `qrcode-generator`) or a prebuilt `svg`.
- **Decided: lives in the lab.** It's used by both the room invite and phone as remote controller.

### Tokens
- **TV scale:** the existing `@media (min-width: 1600px)` block in `tokens.css` sets `sm 14 / md 18 / lg 22 / xl 26 / 2xl 34`. The review's mockups needed `xs 16 / sm 20 / md 26 / lg 30 / xl 36 / 2xl 44` at 1080p to read from a couch.
  - **Decided: automatic on larger screens.** No opt-in. The sizes ramp with the viewport (`clamp()` on `vw`) instead of jumping at one breakpoint: phone values below about 1024px, reaching the TV values at 1920px and growing to 4K.
  - A 1080p desk monitor gets the TV sizes too. That's accepted: one look on every large screen.
  - The game's `--ls` scaling (`calc(N * var(--ls))`, from 1.8px at 1080p) then goes away screen by screen.
- **`--uf-stage-inset`:** the width reserved for an art panel (Tandemonium: 535px). Sheets, the bar and the stage all respect it.
- Existing tones cover the seats: `--uf-color-captain`, `-stoker`, `-team-a`, `-team-b`. `uf-team tone="coop"` uses captain's colour for its frame.

## Kit 0.4 (added 2026-10-20): room, Garage, end of ride

The review's remaining screens, built in the lab (#127) and then adopted in the game:
- `uf-player-card`: who a player is (avatar or initials, name, seat line, stats, extra content). Replaces the room's video seats; video sharing has been off since Tandemonium #400 D7.
- `uf-achievement`: earned · new · locked · progress. Used in the room, the end-of-ride "unlocked this ride" list and the toast.
- `uf-stat`, `uf-ledger`: figures and earnings. Used for victory stats, versus team results and every coin breakdown.
- `uf-pips`, plus `uf-card layout=row` with `meta` and levels: Garage upgrades.
- `uf-sheet tone` + `headline`: every result screen (game over, victory, demo end, versus, slingshot) with one action row.

## Compositions (documented, not new elements)

| Composition | Built from | Where |
|---|---|---|
| **Seat select** | `uf-team` ×1 (co-op) or ×2 (versus) + `uf-controller-roster variant=strip` + `uf-step hint` with `uf-controller-glyph` | game versus + local co-op, lab lobby. The lab lobby adopts it first (it has the most state), then the game. |
| **Controls sheet** | `uf-sheet` + `uf-seat` (you) + `uf-controller-roster variant=list` + `uf-setting` rows (stick, gyro + feel/recalibrate, prompts, use phone) | game bottom bar "DualSense · stick" pill. The lab overlay can reuse it for per-controller settings. |
| **Join with a code** | `uf-join-code` (entry) + `uf-keypad` + `uf-controller-glyph` hints | game stoker step |
| **Online invite** | `uf-join-code` (display) + `uf-qr` + a status line ("Waiting for partner…") | game captain step, left column |
| **Lobby frame** | stage + art panel (`--uf-stage-inset`) + `uf-system-bar` | game only; the painting and wordmark are Tandemonium's |

## Stays in Tandemonium
- The art panel, the wordmark placement and the mode-button copy.
- Level content and level rules.
- The game's seat vocabulary (captain / stoker, team colours). Core and the kit take seat words from the app: core's roster passes the app's `seat` object through untouched, and the roster UI shows the `label` / `tone` the app supplies.
- End-of-ride content: only the sheet and action bar are shared.
- The bike preview (also fix: it sizes its renderer once at startup and never on resize).

## Moves to the lab after the UI step: rooms, join codes, phone remote
**Decided (Pete, 2026-10-20):** the room / join-code logic and the phone-as-controller remote move into the lab as shared packages. They are controller and multiplayer plumbing, not game rules, and the lab is where controllers are already proven.
- **Phone remote:** the game's `js/remote/` (`pad-protocol.js`, `phone-pad.js`, `phone-pad-host.js`, `phone-pad-ui.js`), the `remote/` phone page and the relay client become a lab package (working name `@usersfirst/controller-remote`). A phone then shows up as one more controller in `controllerRoster()` (connection `'phone'`), seated like any pad, and the lab overlay can pair phones too. The game keeps only where its "Use your phone instead" entry sits.
- **Rooms and join codes:** creating a room, the `TNDM-XXXX` code format, joining by code or link, and partner presence become a lab package (working name `@usersfirst/rooms`). The game supplies its prefix and what a room carries (bike, level). `uf-join-code`, `uf-keypad` and `uf-qr` are its UI.
- **Order:** after the UI kit (steps 1–5) lands in the lab and the game. Each move is its own lab PR plus a game PR that deletes the game-side copy, same as the controller drivers before it (`sync-controller-core`).
- **Until then:** the game keeps running its own room and remote code. The kit components only display what it hands them, so nothing is blocked.

## Bugs found by the review that these components must not hide
These are filed under #428. They're behaviour, not layout, and the new components should surface them correctly rather than draw over them.
1. With several pads connected at boot, P1 is never claimed. In versus the last joiner becomes P1. On the captain step the game shows "Player 1: —" and offers every pad, the captain's own included, as Player 2.
2. A fifth versus controller appears nowhere once the teams are full. `uf-controller-roster` lists it, but the candidate logic should also stop dropping it.
3. The Puck is labelled "direct USB-C" (see §1).
4. Unplugging a controller mid-ride does nothing. The seat should go to `open` with a "reconnect" prompt.

## Order of work
1. **Core:** `shortName`, `glyphFamily`, `connection`, `controllerRoster()`, with tests in `packages/core/test`. The lab lobby switches its `devName()` / state derivation to them.
2. **Kit basics:** `uf-controller-glyph`, `uf-button` `sub` / `icon` / `pill`, the TV token block. Small, and used everywhere after.
3. **Seats:** `uf-seat` extensions, `uf-team`, `uf-controller-roster`. The lab lobby migrates first (its `.teams` / `.tandem` / `.lounge` CSS goes away), then the game's versus and the captain step (round 5 of the mockups).
4. **Shells:** `uf-sheet`, `uf-system-bar`, `uf-setting`, then the Controls sheet composition. The game's toggle columns, back hint and footer go away, and plan item 1 (focus scoping) is closed by the bar's scope.
5. **Entry and cards:** `uf-join-code`, `uf-keypad`, `uf-card`, and `uf-qr` if the lab needs it.
6. **Game layout A** on top: the art panel, the wordmark on the art, the level row, the TV scale opt-in. Re-run `node scripts/ui-audit/capture.mjs` and `layout-mock.mjs` and compare against the mockups.

Each step is one lab PR (kit version bump plus a `ui-vX` tag) and one game PR (`npm run sync-ui` plus adoption). `ui:audit --check` ratchets the counts down as hand-built shells disappear.

## Naming
The rule:
- **Generic UI pieces** keep a short noun.
- **Domain pieces** spell out their domain as a word.
- **No abbreviations** (`cntrl`, `mp`): they don't read in markup, and `mp` could mean several things.

Everything keeps the `uf-` prefix, since it all ships from `@usersfirst/ui`.

| Kind | Elements | Why |
|---|---|---|
| Generic UI | `uf-button`, `uf-chip`, `uf-sheet`, `uf-card`, `uf-setting`, `uf-system-bar`, `uf-keypad`, `uf-qr` | Nothing about them is specific to controllers or multiplayer. `uf-setting` (was `uf-switch`): a row can be a toggle or a value. `uf-system-bar` (was `uf-bar`): "bar" alone says nothing. |
| Controllers | `uf-controller-glyph` (was `uf-glyph`), `uf-controller-roster` (was `uf-roster`) | Both are about physical controllers. "Roster" alone was ambiguous; "controller roster" says it is every controller and its seat, and it shares its name with core's `controllerRoster()`, so the element and its data are easy to find together (Pete's suggestion). |\| "list"` reads naturally on `uf-controller-roster`. |
| Multiplayer | `uf-seat`, `uf-team`, `uf-join-code` (was `uf-code`) | "Seat" and "team" are already multiplayer words, so `uf-mp-seat` would add nothing. `uf-seat` also ships already, in the lab lobby and the game's room. "Join code" says what the code is for. |

Core field names (`shortName`, `glyphFamily`, `connection`) stay short, because they sit on device entries inside `@usersfirst/controller-core`. The roster function is `controllerRoster()`, the same words as `uf-controller-roster`, so searching for one finds the other.

## Decisions (Pete, 2026-10-20)
1. **`uf-qr` lives in the lab.** It's used by the room invite and by phone as remote controller (§13).
2. **TV text size is automatic** on larger screens, ramping with the viewport. No opt-in (Tokens).
3. **No button jumps to the system bar.** You reach it with ↓ on the d-pad or the left stick, and ↑ returns where you were (§9).
4. **Lab first, then the game.** Each component is built in `packages/ui` and proven in the lab's apps (the lobby for seats, teams and the controller list; the overlay pages for the sheet, settings and glyphs). Then it's vendored into Tandemonium with `npm run sync-ui` and adopted there (Order of work).
5. **Naming** as in the section above, with Pete's "controller roster" (`uf-controller-roster` + core `controllerRoster()`).
6. **No game vocabulary in shared packages.** Core's roster types a seat's `team` / `role` as the app's own strings (passed through, with optional `label` / `tone` for display), not Tandemonium's captain / stoker. Fixed in #125.
7. **Rooms, join codes and the phone remote move into the lab** after the UI step (section above). Supersedes the earlier "stays in Tandemonium" line.
