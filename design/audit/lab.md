# UI audit — lab

_Generated 2026-10-18T20:11:18.472Z from `C:\Users\pete\SoftwareDev\tandemonium-controller-lab`_

## Totals

| metric | value |
|---|---:|
| htmlFiles | 12 |
| jsFiles | 21 |
| cssLines | 1792 |
| distinctColours | 139 |
| hexColours | 74 |
| fontSizes | 22 |
| radii | 17 |
| varsDefined | 8 |
| important | 4 |
| screens | 13 |
| buttons | 0 |
| inlineStyle | 23 |
| customTags | 18 |
| innerHTML | 21 |
| showHide | 22 |
| classToggle | 31 |
| customElements | 1 |
| tsCheckFiles | 9 |
| getById | 126 |

## Files

| file | lines | style blocks | css lines | screens/overlays | buttons | inline style= | custom tags |
|---|---:|---:|---:|---:|---:|---:|---:|
| apps/overlay/src/axis-window.html | 50 | 1 | 30 | 0 | 0 | 0 | 1 |
| apps/overlay/src/button-hud-window.html | 210 | 1 | 142 | 0 | 0 | 0 | 1 |
| apps/overlay/src/controllers-window.html | 52 | 1 | 32 | 1 | 0 | 0 | 1 |
| apps/overlay/src/gyro-window.html | 62 | 1 | 24 | 0 | 0 | 0 | 1 |
| apps/overlay/src/index.html | 1512 | 1 | 968 | 8 | 0 | 15 | 1 |
| apps/overlay/src/inventory.html | 55 | 1 | 24 | 0 | 0 | 1 | 1 |
| apps/overlay/src/lobby.html | 163 | 1 | 83 | 2 | 0 | 1 | 4 |
| apps/overlay/src/multi-controllers-window.html | 62 | 1 | 42 | 1 | 0 | 0 | 1 |
| apps/overlay/src/multi.html | 455 | 2 | 357 | 0 | 0 | 1 | 1 |
| apps/overlay/src/roll-window.html | 68 | 1 | 40 | 0 | 0 | 0 | 1 |
| packages/ui/gallery.html | 113 | 1 | 13 | 1 | 0 | 5 | 5 |
| web/index.html | 71 | 1 | 37 | 0 | 0 | 0 | 0 |

| js file | lines | getElementById ids | innerHTML= | createElement | style.display= | class toggles | custom elements | @ts-check | jsdoc tags |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|---:|
| apps/overlay/src/js/app.js | 3452 | 100 | 7 | 3 | 21 | 25 | 0 |  | 1 |
| apps/overlay/src/js/axis-window.js | 30 | 3 | 0 | 0 | 0 | 0 | 0 |  | 0 |
| apps/overlay/src/js/button-hud-window.js | 136 | 2 | 0 | 0 | 0 | 2 | 0 |  | 0 |
| apps/overlay/src/js/controllers-window.js | 51 | 2 | 1 | 0 | 0 | 0 | 0 |  | 0 |
| apps/overlay/src/js/gyro-window.js | 47 | 1 | 0 | 0 | 0 | 0 | 0 |  | 0 |
| apps/overlay/src/js/hud-window-chrome.js | 53 | 1 | 0 | 0 | 0 | 0 | 0 |  | 0 |
| apps/overlay/src/js/inventory.js | 115 | 4 | 2 | 0 | 0 | 0 | 0 |  | 0 |
| apps/overlay/src/js/lobby-app.js | 618 | 0 | 4 | 0 | 0 | 0 | 0 |  | 4 |
| apps/overlay/src/js/multi-app.js | 469 | 5 | 1 | 0 | 1 | 4 | 0 |  | 0 |
| apps/overlay/src/js/multi-controllers-window.js | 55 | 2 | 1 | 0 | 0 | 0 | 0 |  | 0 |
| apps/overlay/src/js/roll-window.js | 109 | 6 | 2 | 0 | 0 | 0 | 0 |  | 0 |
| apps/overlay/src/js/test-report.js | 410 | 0 | 0 | 1 | 0 | 0 | 0 |  | 11 |
| packages/ui/src/elements/uf-button.js | 139 | 0 | 1 | 1 | 0 | 0 | 0 | ✓ | 17 |
| packages/ui/src/elements/uf-chip.js | 45 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ | 6 |
| packages/ui/src/elements/uf-flow.js | 164 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ | 14 |
| packages/ui/src/elements/uf-seat.js | 86 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ | 14 |
| packages/ui/src/elements/uf-step.js | 90 | 0 | 1 | 1 | 0 | 0 | 0 | ✓ | 13 |
| packages/ui/src/focus-controller.js | 368 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ | 41 |
| packages/ui/src/index.js | 15 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ | 0 |
| packages/ui/src/inputs.js | 61 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ | 9 |
| packages/ui/src/uf-element.js | 208 | 0 | 1 | 3 | 0 | 0 | 1 | ✓ | 46 |

## Screens / overlays by id

- **apps/overlay/src/controllers-window.html**: `#panel`
- **apps/overlay/src/index.html**: `#settings-panel`, `#green-screen-toggle`, `#green-screen-color`, `#layout-editor-popup`, `#test-report-modal`, `#tr-step-title`, `#tr-step-prompt-title`, `#tr-step-prompt`
- **apps/overlay/src/lobby.html**: `#ctrl-panel`, `#lobby`
- **apps/overlay/src/multi-controllers-window.html**: `#panel`
- **packages/ui/gallery.html**: `#uf-step`

## Style tokens in the wild

### Hex colours (74 distinct)

| value | uses |
|---|---:|
| `#ccc` | 13 |
| `#8af` | 5 |
| `#cfd` | 4 |
| `#39404e` | 4 |
| `#e8e8ee` | 4 |
| `#2a2a3e` | 4 |
| `#9fb0c6` | 3 |
| `#c9d6ff` | 3 |
| `#104` | 3 |
| `#000` | 3 |
| `#9aa3b4` | 3 |
| `#777` | 2 |
| `#222` | 2 |
| `#66bbff` | 2 |
| `#1a1205` | 2 |
| `#bbb` | 2 |
| `#ddd` | 2 |
| `#e8ecf2` | 2 |
| `#cfe0ff` | 2 |
| `#8aa` | 2 |
| `#aaa` | 1 |
| `#26262c` | 1 |
| `#ff5555` | 1 |
| `#ff9999` | 1 |
| `#1a1a20` | 1 |
| `#9ad` | 1 |
| `#34b85a` | 1 |
| `#f88` | 1 |
| `#6f6` | 1 |
| `#c44` | 1 |
| … 44 more | |
### rgba() colours (65 distinct)

| value | uses |
|---|---:|
| `rgba(255,255,255,0.25)` | 6 |
| `rgba(51,136,255,0.65)` | 4 |
| `rgba(255,255,255,0.09)` | 4 |
| `rgba(110,168,255,0.18)` | 3 |
| `rgba(110,168,255,0.4)` | 3 |
| `rgba(255,255,255,0.2)` | 3 |
| `rgba(46,194,126,0.65)` | 2 |
| `rgba(237,51,59,0.65)` | 2 |
| `rgba(246,195,67,0.65)` | 2 |
| `rgba(0,0,0,0.8)` | 2 |
| `rgba(12,15,20,0.98)` | 2 |
| `rgba(255,255,255,0.28)` | 2 |
| `rgba(108,224,143,.4)` | 2 |
| `rgba(30,30,35,0.95)` | 2 |
| `rgba(0,0,0,0.5)` | 2 |
| … 50 more | |
### Font sizes (22 distinct)

| value | uses |
|---|---:|
| `12px` | 14 |
| `13px` | 14 |
| `10px` | 13 |
| `11px` | 10 |
| `9px` | 6 |
| `8px` | 6 |
| `14px` | 6 |
| `15px` | 4 |
| `18px` | 3 |
| `0.8rem` | 2 |
| `0.95rem` | 2 |
| `12.5px` | 2 |
| `10.5px` | 2 |
| `28px` | 1 |
| `24px` | 1 |
| `20px` | 1 |
| `1.3rem` | 1 |
| `1.5rem` | 1 |
| `0.85rem` | 1 |
| `0.7em` | 1 |
| `46px` | 1 |
| `26px` | 1 |
### Font families (6 distinct)

| value | uses |
|---|---:|
| `var(--uf-font-mono)` | 10 |
| `var(--uf-font-ui)` | 10 |
| `inherit` | 3 |
| `var(--mono)` | 1 |
| `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | 1 |
| `ui-monospace, SFMono-Regular, Menlo, monospace` | 1 |
### Border radii (17 distinct)

| value | uses |
|---|---:|
| `50%` | 18 |
| `6px` | 10 |
| `4px` | 9 |
| `10px` | 6 |
| `5px` | 5 |
| `8px` | 5 |
| `12px` | 3 |
| `9px` | 3 |
| `999px` | 3 |
| `var(--uf-radius-md)` | 3 |
| `1px` | 2 |
| `14px` | 2 |
| `var(--uf-radius-sm)` | 2 |
| `2px` | 1 |
| `3px` | 1 |
| … 2 more | |
### Spacing values (padding/margin/gap) (82 distinct)

| value | uses |
|---|---:|
| `8px` | 27 |
| `0` | 24 |
| `6px` | 16 |
| `10px` | 12 |
| `4px` | 9 |
| `14px` | 6 |
| `2px` | 5 |
| `9px` | 5 |
| `12px` | 4 |
| `8px 10px` | 4 |
| `5px` | 4 |
| `16px` | 3 |
| `1px` | 3 |
| `3px` | 3 |
| `var(--uf-space-4)` | 3 |
| `-1px` | 2 |
| `9px 12px` | 2 |
| `7px 12px` | 2 |
| `3px 5px` | 2 |
| `0 0 14px` | 2 |
| `18px` | 2 |
| `0.5rem` | 2 |
| `0 2rem` | 2 |
| `4px 12px` | 2 |
| `7px 9px` | 2 |
| … 57 more | |
### z-index (16 distinct)

| value | uses |
|---|---:|
| `51` | 5 |
| `100` | 5 |
| `200` | 4 |
| `110` | 4 |
| `101` | 4 |
| `50` | 3 |
| `1` | 2 |
| `55` | 2 |
| `210` | 2 |
| `0` | 1 |
| `120` | 1 |
| `500` | 1 |
| `40` | 1 |
| `45` | 1 |
| `5` | 1 |
| … 1 more | |
### CSS custom properties defined (8 distinct)

| value | uses |
|---|---:|
| `--roll-label-color` | 2 |
| `--roll-label-bright` | 2 |
| `--team-a` | 1 |
| `--team-b` | 1 |
| `--accent` | 1 |
| `--versus` | 1 |
| `--mono` | 1 |
| `--muted` | 1 |
### CSS custom properties used (45 distinct)

| value | uses |
|---|---:|
| `--uf-color-fg` | 43 |
| `--uf-color-line-soft` | 36 |
| `--uf-font-mono` | 30 |
| `--uf-color-accent` | 29 |
| `--uf-color-info` | 28 |
| `--uf-color-fg-muted` | 28 |
| `--uf-color-surface-2` | 19 |
| `--uf-color-surface-3` | 16 |
| `--uf-color-warn` | 12 |
| `--mono` | 12 |
| `--uf-font-ui` | 11 |
| `--hl-color` | 11 |
| `--uf-size-xs` | 11 |
| `--uf-color-danger` | 10 |
| `--muted` | 9 |
| `--roll-label-color` | 8 |
| `--roll-label-bright` | 8 |
| `--uf-size-sm` | 6 |
| `--uf-space-4` | 5 |
| `--uf-color-bg` | 4 |
| … 25 more | |
### Media queries (2 distinct)

| value | uses |
|---|---:|
| `(hover: hover)` | 1 |
| `(prefers-reduced-motion: reduce)` | 1 |
### Component-ish class selectors (31 distinct)

| value | uses |
|---|---:|
| `bh-btn` | 16 |
| `setting-row` | 15 |
| `settings-action-btn` | 5 |
| `row` | 4 |
| `lounge-chip` | 4 |
| `slot-btn` | 4 |
| `ovl-ctrl-row` | 3 |
| `slot-prompt` | 3 |
| `hint` | 2 |
| `dialog-buttons` | 2 |
| `btn-cancel` | 2 |
| `btn-exit-yes` | 2 |
| `status-badge` | 2 |
| `gyro-hud-footer` | 2 |
| `card` | 2 |
| `tandem-seats` | 2 |
| `btn` | 2 |
| `btn-primary` | 2 |
| `btn-ghost` | 2 |
| `color-row-stacked` | 1 |
| `lep-hint` | 1 |
| `hide-roll-hud` | 1 |
| `splash-hint` | 1 |
| `show-button-hud` | 1 |
| `show-gyro-hud` | 1 |
| `lounge-chips` | 1 |
| `lc-hint` | 1 |
| `cp-row` | 1 |
| `slot-hint` | 1 |
| `hid-badge` | 1 |
| `type-row` | 1 |
### Keyframes (2 distinct)

| value | uses |
|---|---:|
| `idle` | 1 |
| `pulse` | 1 |
