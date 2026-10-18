# UI audit summary

_Generated 2026-10-18T18:56:54.001Z. Re-run with `npm run ui:audit`. Per-target detail: [game](game.md), [lab](lab.md)_

| metric | game | lab |
|---|---:|---:|
| htmlFiles | 1 | 12 |
| jsFiles | 76 | 19 |
| cssLines | 5046 | 1792 |
| hexColours | 50 | 108 |
| fontSizes | 37 | 22 |
| radii | 29 | 17 |
| varsDefined | 4 | 8 |
| important | 54 | 4 |
| screens | 43 | 13 |
| buttons | 87 | 46 |
| inlineStyle | 103 | 23 |
| innerHTML | 82 | 21 |
| showHide | 239 | 22 |
| classToggle | 183 | 31 |
| customElements | 0 | 1 |
| tsCheckFiles | 0 | 7 |

## Colours shared by every target (7)

`#fff` `#000` `#ffffff` `#4488ff` `#888` `#ff5555` `#6f6`

## Dominant font stacks

- **game**: `var(--uf-font-ui)`, `inherit`, `ui-monospace, SFMono-Regular, Menlo, monospace`
- **lab**: `monospace`, `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`, `inherit`

## How to read this

- **hexColours / fontSizes / radii** — distinct literal values. A design system with tokens should drive each toward ≤ 12 / ≤ 8 / ≤ 5.
- **varsDefined** — CSS custom properties. Tokens live here; this number should grow as the literals shrink.
- **showHide / classToggle / innerHTML** — imperative DOM sites. Each one is a place a screen's state lives in JS rather than in a component. Should fall as screens become elements.
- **customElements / tsCheckFiles** — adoption of the typed Web Component pattern (packages/ui). Should rise.
