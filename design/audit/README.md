# UI audit summary

_Generated 2026-10-18T20:10:39.724Z. Re-run with `npm run ui:audit`. Per-target detail: [lab](lab.md)_

| metric | lab |
|---|---:|
| htmlFiles | 12 |
| jsFiles | 21 |
| cssLines | 1792 |
| hexColours | 108 |
| fontSizes | 22 |
| radii | 17 |
| varsDefined | 8 |
| important | 4 |
| screens | 13 |
| buttons | 46 |
| inlineStyle | 23 |
| innerHTML | 21 |
| showHide | 22 |
| classToggle | 31 |
| customElements | 1 |
| tsCheckFiles | 9 |

## How to read this

- **hexColours / fontSizes / radii** — distinct literal values. A design system with tokens should drive each toward ≤ 12 / ≤ 8 / ≤ 5.
- **varsDefined** — CSS custom properties. Tokens live here; this number should grow as the literals shrink.
- **showHide / classToggle / innerHTML** — imperative DOM sites. Each one is a place a screen's state lives in JS rather than in a component. Should fall as screens become elements.
- **customElements / tsCheckFiles** — adoption of the typed Web Component pattern (packages/ui). Should rise.
