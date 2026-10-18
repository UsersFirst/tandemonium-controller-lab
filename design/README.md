# design/ — UI-kit measurement + regression captures

See `docs/UI-DESIGN-SYSTEM-PLAN.md`.

| folder | written by | contents |
|---|---|---|
| `audit/` | `npm run ui:audit` | measured UI inventory of the game + lab (markdown + json): the scoreboard |
| `screenboard/<manifest>/` | `npm run ui:screenboard -- --manifest <name>` | every registered screen at phone / desktop / TV. PNGs are git-ignored (regenerable); `run.json` + `index.html` are kept |
