# UI audit — lab

_Generated 2026-10-18T20:10:39.721Z from `C:\Users\pete\SoftwareDev\tandemonium-controller-lab`_

## Totals

| metric | value |
|---|---:|
| htmlFiles | 12 |
| jsFiles | 21 |
| cssLines | 1792 |
| distinctColours | 177 |
| hexColours | 108 |
| fontSizes | 22 |
| radii | 17 |
| varsDefined | 8 |
| important | 4 |
| screens | 13 |
| buttons | 46 |
| inlineStyle | 23 |
| customTags | 9 |
| innerHTML | 21 |
| showHide | 22 |
| classToggle | 31 |
| customElements | 1 |
| tsCheckFiles | 9 |
| getById | 126 |

## Files

| file | lines | style blocks | css lines | screens/overlays | buttons | inline style= | custom tags |
|---|---:|---:|---:|---:|---:|---:|---:|
| apps/overlay/src/axis-window.html | 48 | 1 | 30 | 0 | 1 | 0 | 0 |
| apps/overlay/src/button-hud-window.html | 208 | 1 | 142 | 0 | 1 | 0 | 0 |
| apps/overlay/src/controllers-window.html | 50 | 1 | 32 | 1 | 1 | 0 | 0 |
| apps/overlay/src/gyro-window.html | 60 | 1 | 24 | 0 | 1 | 0 | 0 |
| apps/overlay/src/index.html | 1510 | 1 | 968 | 8 | 32 | 15 | 0 |
| apps/overlay/src/inventory.html | 53 | 1 | 24 | 0 | 2 | 1 | 0 |
| apps/overlay/src/lobby.html | 163 | 1 | 83 | 2 | 0 | 1 | 4 |
| apps/overlay/src/multi-controllers-window.html | 60 | 1 | 42 | 1 | 1 | 0 | 0 |
| apps/overlay/src/multi.html | 453 | 2 | 357 | 0 | 6 | 1 | 0 |
| apps/overlay/src/roll-window.html | 66 | 1 | 40 | 0 | 1 | 0 | 0 |
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

### Hex colours (108 distinct)

| value | uses |
|---|---:|
| `#3388ff` | 24 |
| `#fff` | 21 |
| `#ccc` | 13 |
| `#eee` | 11 |
| `#6ce08f` | 11 |
| `#888` | 6 |
| `#6a7184` | 6 |
| `#8af` | 5 |
| `#2ec27e` | 4 |
| `#ed333b` | 4 |
| `#f6c343` | 4 |
| `#cfd` | 4 |
| `#39404e` | 4 |
| `#2a9d4f` | 4 |
| `#e8e8ee` | 4 |
| `#2a2a3e` | 4 |
| `#e7ecf5` | 3 |
| `#9fb0c6` | 3 |
| `#8894a8` | 3 |
| `#06140c` | 3 |
| `#c9d6ff` | 3 |
| `#104` | 3 |
| `#8fffc1` | 3 |
| `#000` | 3 |
| `#9aa3b4` | 3 |
| `#44dd66` | 2 |
| `#ee4455` | 2 |
| `#4488ff` | 2 |
| `#999` | 2 |
| `#777` | 2 |
| … 78 more | |
### rgba() colours (69 distinct)

| value | uses |
|---|---:|
| `rgba(255,255,255,0.12)` | 23 |
| `rgba(255,255,255,0.08)` | 15 |
| `rgba(255,255,255,0.15)` | 9 |
| `rgba(255,255,255,0.05)` | 7 |
| `rgba(255,255,255,0.06)` | 7 |
| `rgba(255,255,255,0.25)` | 6 |
| `rgba(255,255,255,0.1)` | 5 |
| `rgba(51,136,255,0.65)` | 4 |
| `rgba(255,255,255,0.09)` | 4 |
| `rgba(255,255,255,0.04)` | 3 |
| `rgba(110,168,255,0.18)` | 3 |
| `rgba(110,168,255,0.4)` | 3 |
| `rgba(255,255,255,0.2)` | 3 |
| `rgba(46,194,126,0.65)` | 2 |
| `rgba(237,51,59,0.65)` | 2 |
| … 54 more | |
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
| `monospace` | 10 |
| `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | 10 |
| `inherit` | 3 |
| `var(--uf-font-ui)` | 1 |
| `var(--mono)` | 1 |
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
### CSS custom properties used (42 distinct)

| value | uses |
|---|---:|
| `--mono` | 12 |
| `--hl-color` | 11 |
| `--uf-size-xs` | 11 |
| `--muted` | 9 |
| `--roll-label-color` | 8 |
| `--roll-label-bright` | 8 |
| `--uf-size-sm` | 6 |
| `--uf-color-warn` | 5 |
| `--uf-space-4` | 5 |
| `--accent` | 4 |
| `--uf-color-line-soft` | 4 |
| `--uf-color-fg` | 3 |
| `--uf-font-mono` | 3 |
| `--uf-color-fg-muted` | 3 |
| `--uf-space-3` | 3 |
| `--uf-radius-md` | 3 |
| `--team-a` | 3 |
| `--team-b` | 3 |
| `--ax-pitch` | 2 |
| `--ax-roll` | 2 |
| … 22 more | |
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
