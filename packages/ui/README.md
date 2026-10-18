# @usersfirst/ui

Typed, build-free Web Components and design tokens shared by Tandemonium and the controller lab. Plan and rationale: [`docs/UI-DESIGN-SYSTEM-PLAN.md`](../../docs/UI-DESIGN-SYSTEM-PLAN.md).

- `src/tokens.css` — the only place a colour / size / radius is a literal. Host pages `<link>` it.
- `src/uf-element.js` — `UfElement` base: typed `static props`, attribute ↔ property reflection with coercion, batched render, `update()` fast path, `emit()`.
- `src/elements/uf-*.js` — one element per file, light DOM, token-only styles. Scaffold with `npm run ui:new-element -- uf-name --props "…"` from the lab root.
- `src/elements.d.ts` — tag → class map so `document.createElement('uf-button')` is typed.
- `gallery.html` — every element in every state; captured by `npm run ui:screenboard -- --manifest ui-gallery`.

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
