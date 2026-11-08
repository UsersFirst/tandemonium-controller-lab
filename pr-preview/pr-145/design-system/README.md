# Design system inventory — @usersfirst/ui 0.2.0

_Generated 2026-10-18T20:09:56.921Z. Re-run: `npm run ui:inventory`. Report page: [index.html](index.html)._

## Tokens (53)

### colour · surfaces

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-color-bg` | `#0b0d12` | 0 | lab: page gradient base |
| `--uf-color-surface` | `#1a1a2e` | 0 | game: panels / cards |
| `--uf-color-surface-2` | `rgba(255,255,255,.10)` | 2 | game .lobby-btn fill |
| `--uf-color-surface-3` | `rgba(255,255,255,.04)` | 1 |  |
| `--uf-color-line` | `rgba(255,255,255,.40)` | 1 | game .lobby-btn border |
| `--uf-color-line-soft` | `rgba(255,255,255,.16)` | 2 |  |
| `--uf-color-scrim` | `rgba(0,0,0,.60)` | 1 |  |

### colour · text

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-color-fg` | `#ffffff` | 4 | game: 61 uses of #fff |
| `--uf-color-fg-muted` | `#8a93a6` | 3 |  |
| `--uf-color-fg-on-accent` | `#06140c` | 2 |  |

### colour · semantic (game accent = the 37-use #44ff66 green)

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-color-accent` | `#44ff66` | 3 |  |
| `--uf-color-accent-soft` | `rgba(60,200,80,.25)` | 1 | game .lobby-btn-accent fill |
| `--uf-color-accent-line` | `rgba(60,200,80,.60)` | 1 |  |
| `--uf-color-accent-2` | `#ffd23f` | 0 | game gold, 26 uses |
| `--uf-color-warn` | `var(--uf-color-accent-2)` | 1 |  |
| `--uf-color-danger` | `#ff4444` | 2 |  |
| `--uf-color-danger-soft` | `rgba(255,68,68,.18)` | 2 |  |
| `--uf-color-info` | `#4488ff` | 0 | shared by game + lab |
| `--uf-color-info-soft` | `rgba(103,193,245,.16)` | 1 | game .cta-btn fill |
| `--uf-color-info-line` | `rgba(103,193,245,.50)` | 1 |  |
| `--uf-color-info-fg` | `#bfe6ff` | 1 |  |
| `--uf-color-versus` | `#c898ff` | 1 | game .lobby-btn-versus |
| `--uf-color-versus-soft` | `rgba(160,64,255,.18)` | 1 |  |
| `--uf-color-versus-line` | `rgba(160,64,255,.65)` | 1 |  |

### colour · seats & teams (game values; the lab's lobby adopts them)

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-color-captain` | `#7ae09a` | 1 |  |
| `--uf-color-stoker` | `#ff9e6b` | 1 |  |
| `--uf-color-team-a` | `#4c7dff` | 1 | game --versus-team-a · P1/P3 lightbar blue |
| `--uf-color-team-b` | `#ff4560` | 1 | game --versus-team-b · --tandem-player2 |

### type

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-font-ui` | `'Helvetica Neue', Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | 3 |  |
| `--uf-font-mono` | `ui-monospace, 'Cascadia Mono', SFMono-Regular, Menlo, monospace` | 2 |  |
| `--uf-size-xs` | `10px` | 3 | 24 uses |
| `--uf-size-sm` | `12px` | 3 | 11px+12px+13px = 100 uses in the game: collapse to one |
| `--uf-size-md` | `16px` | 1 | game .lobby-btn |
| `--uf-size-lg` | `18px` | 1 |  |
| `--uf-size-xl` | `22px` | 1 |  |
| `--uf-size-2xl` | `28px` | 0 |  |
| `--uf-size-hero` | `64px` | 0 |  |

### spacing (4px grid)

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-space-1` | `4px` | 2 |  |
| `--uf-space-5` | `24px` | 1 |  |

### radius (game today: 50%, 10px, 999px, 8px, 3px, 6px, 2px, 12px … 29 distinct)

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-radius-sm` | `6px` | 3 |  |
| `--uf-radius-md` | `10px` | 1 |  |
| `--uf-radius-lg` | `14px` | 1 | game .lobby-btn |
| `--uf-radius-pill` | `999px` | 0 |  |

### elevation / focus

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-shadow-card` | `0 12px 34px -14px rgba(0,0,0,.8)` | 1 |  |
| `--uf-focus-ring` | `0 0 0 3px var(--uf-color-accent)` | 1 |  |
| `--uf-glow-accent` | `0 0 18px -4px var(--uf-color-accent)` | 0 |  |

### motion

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-motion-fast` | `120ms` | 1 |  |
| `--uf-motion-base` | `180ms` | 2 |  |
| `--uf-ease` | `cubic-bezier(.2,.8,.2,1)` | 2 |  |

### layering (game today: ad-hoc 11 / 56 / 100 …)

| token | value | used by elements | note |
|---|---|---:|---|
| `--uf-z-hud` | `10` | 0 |  |
| `--uf-z-sheet` | `50` | 0 |  |
| `--uf-z-modal` | `60` | 0 |  |
| `--uf-z-toast` | `90` | 0 |  |

### Overrides

| token | value | when |
|---|---|---|
| `--uf-size-sm` | `14px` | `@media (min-width: 1600px)` |
| `--uf-motion-fast` | `0ms` | `@media (prefers-reduced-motion: reduce)` |

## Controls (5)

### `<uf-button>` — the one button: every CTA, menu entry and option in both repos.

_UfButton · packages/ui/src/elements/uf-button.js · 139 lines · owns its DOM · 12 gallery states_

| prop | attribute | type | default |
|---|---|---|---|
| `label` | `label` | string | `""` |
| `variant` | `variant` | `primary` \| `accent` \| `ghost` \| `danger` \| `versus` | `primary` |
| `size` | `size` | `xs` \| `sm` \| `md` \| `lg` | `md` |
| `disabled` | `disabled` | boolean | `false` |
| `selected` | `selected` | boolean | `false` |

- events: —
- methods: `click()`
- data attributes: —
- tokens used: 28 · literal colours in styles: none
- usage: game 45 in HTML + 4 in JS · lab 74 in HTML + 18 in JS

### `<uf-chip>` — a small status tag (READY, ASSIGNED, AVAILABLE, P1).

_UfChip · packages/ui/src/elements/uf-chip.js · 45 lines · owns its DOM · 5 gallery states_

| prop | attribute | type | default |
|---|---|---|---|
| `label` | `label` | string | `""` |
| `tone` | `tone` | `neutral` \| `accent` \| `info` \| `warn` \| `danger` | `neutral` |

- events: —
- methods: —
- data attributes: —
- tokens used: 14 · literal colours in styles: none
- usage: game 0 in HTML + 0 in JS · lab 9 in HTML + 7 in JS

### `<uf-flow>` — hosts uf-steps; exactly one is active; go()/back() with history.

_UfFlow · packages/ui/src/elements/uf-flow.js · 164 lines · keeps authored children · 1 gallery states_

| prop | attribute | type | default |
|---|---|---|---|
| `current` | `current` | string | `""` |

- events: `uf-flow:change`
- methods: `steps()`, `step(id)`, `go(id, opts = {})`, `back()`, `reset()`, `attachFocus(controller)`, `refreshFocus()`
- data attributes: `data-flow-back`, `data-flow-go`
- tokens used: 0 · literal colours in styles: none
- usage: game 0 in HTML + 0 in JS · lab 2 in HTML + 12 in JS

### `<uf-seat>` — a seat in the lobby: who sits here, on what controller, and whether they are ready.

_UfSeat · packages/ui/src/elements/uf-seat.js · 86 lines · owns its DOM · 5 gallery states_

| prop | attribute | type | default |
|---|---|---|---|
| `seat` | `seat` | string | `Captain` |
| `who` | `who` | string | `OPEN` |
| `dev` | `dev` | string | `""` |
| `state` | `state` | `open` \| `joined` \| `ready` \| `locked` | `open` |
| `tone` | `tone` | `captain` \| `stoker` \| `team-a` \| `team-b` | `captain` |
| `badge` | `badge` | string | `""` |

- events: —
- methods: —
- data attributes: —
- tokens used: 19 · literal colours in styles: none
- usage: game 0 in HTML + 0 in JS · lab 6 in HTML + 15 in JS

### `<uf-step>` — one screen of a flow: optional prompt above and hint below the authored content.

_UfStep · packages/ui/src/elements/uf-step.js · 90 lines · keeps authored children · 3 gallery states_

| prop | attribute | type | default |
|---|---|---|---|
| `prompt` | `prompt` | string | `""` |
| `hint` | `hint` | string | `""` |
| `active` | `active` | boolean | `false` |

- events: —
- methods: `focusables()`
- data attributes: `data-focusable`
- tokens used: 9 · literal colours in styles: none
- usage: game 0 in HTML + 0 in JS · lab 7 in HTML + 9 in JS

## Adoption

| | game | lab |
|---|---|---|
| tokens.css linked | ✓ | ✓ |
| kit loaded | ✓ | ✓ |
| uf-* elements in HTML | 45 | 98 |
| uf-* created in JS | 4 | 61 |
| raw <button> in HTML | 87 | 0 |
| raw buttons created in JS | 8 | 0 |
| var(--uf-*) references in page CSS | 99 | 318 |
| literal hex colours in page CSS (distinct / total) | 50 / 146 | 74 / 121 |
| literal font stacks in page CSS | `ui-monospace, SFMono-Regular, Menlo, monospace`<br>`Georgia, 'Times New Roman', serif`<br>`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`<br>`'Noteworthy', 'Bradley Hand', fantasy` | `var(--mono)`<br>`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`<br>`ui-monospace, SFMono-Regular, Menlo, monospace` |

## Unused tokens (12)

`--uf-color-bg` `--uf-color-surface` `--uf-color-accent-2` `--uf-color-info` `--uf-size-2xl` `--uf-size-hero` `--uf-radius-pill` `--uf-glow-accent` `--uf-z-hud` `--uf-z-sheet` `--uf-z-modal` `--uf-z-toast`

_Unused by elements is fine for page-level tokens (z-index, scrim); it is a smell for colours._
