# @usersfirst/ui

Typed, build-free Web Components and design tokens shared by Tandemonium and the controller lab. Plan and rationale: [`docs/UI-DESIGN-SYSTEM-PLAN.md`](../../docs/UI-DESIGN-SYSTEM-PLAN.md).

- `src/tokens.css` — the only place a colour / size / radius is a literal. Host pages `<link>` it.
- `src/uf-element.js` — `UfElement` base: typed `static props`, attribute ↔ property reflection with coercion, batched render, `update()` fast path, `emit()`.
- `src/elements/uf-*.js` — one element per file, light DOM, token-only styles. Scaffold with `npm run ui:new-element -- uf-name --props "…"` from the lab root.
- `src/elements.d.ts` — tag → class map so `document.createElement('uf-button')` is typed.
- `src/focus-controller.js` — `FocusController`: controller-driven focus engine (linear + spatial), the same engine Tandemonium uses; `src/inputs.js` — `GamepadInput` / `ManualInput` sources. `uf-flow.attachFocus(fc)` scopes it to the active `uf-step`'s `focusables()`.
- `gallery.html` — every element in every state; captured by `npm run ui:screenboard -- --manifest ui-gallery`. Published at lab.housetandem.com/ui/gallery.html.
- `test/browser.test.mjs` — the elements in headless Chrome (skips without puppeteer).

## Elements (0.4)

| element | what it is |
|---|---|
| `uf-button` | the one button; `sub` (second line), `align="start"`, `size="pill"` (icon + label) |
| `uf-chip` | status tag |
| `uf-step` / `uf-flow` | a screen / one active screen with history; `attachFocus()` also scopes any linked `uf-system-bar` |
| `uf-seat` | a lobby seat: open · candidate · joined · ready · locked; `hint` may hold a glyph |
| `uf-team` | the team box around seats (`tone` team-a · team-b · coop) |
| `uf-controller-roster` | every connected controller: `variant="strip"` under seats, `"list"` in a Controls sheet; `rows` = core's `controllerRoster()` |
| `uf-controller-glyph` | a button prompt matching the controller (`button` role/position, `family` or page default via `UfControllerGlyph.setDefault`) |
| `uf-sheet` | one shell for panels and dialogs; Back/Esc/scrim close; `attachFocus()` |
| `uf-system-bar` | the bottom bar: Back + pills, linked to a `uf-flow` |
| `uf-setting` | a setting row (toggle or value) with an optional detail row |
| `uf-card` | a selectable content card (levels, garage) |
| `uf-join-code` + `uf-keypad` | show / type a join code with an on-screen keyboard |
| `uf-qr` | couch-sized QR (vendored `qrcode-generator`, MIT — `src/third_party/`) |
| `uf-player-card` | who a player is: avatar or initials, name, seat line, stats, extra content (room, level summary) |
| `uf-achievement` | one achievement: earned · new · locked · progress; sm row or md card |
| `uf-stat` | one figure (icon, value, label); `variant=card` for team results |
| `uf-ledger` | earnings: line items, total, balance (coins, points…) |
| `uf-pips` | a level as dots (3 of 10) |

0.4 also adds `uf-card layout=row` (+ `meta`, `level`/`levelMax` pips) for upgrade lists and `uf-sheet tone` + `headline` for result screens.

Text sizes ramp automatically from 1024px to TV sizes at 1920px (`tokens.css`); `--uf-stage-inset` reserves room for an art panel. Seat words (captain, team names…) always come from the app. Plan: [`docs/UI-KIT-TV-COMPONENTS.md`](../../docs/UI-KIT-TV-COMPONENTS.md).

```
npm run typecheck            # tsc --checkJs, no emit
npm test -w @usersfirst/ui   # node:test
```

Usage in a page (raw ESM, no build):

```html
<link rel="stylesheet" href="./lib/ui/tokens.css">
<uf-button label="START RIDE" variant="accent" size="lg"></uf-button>
<script type="module" src="./lib/ui/index.js"></script>
```
