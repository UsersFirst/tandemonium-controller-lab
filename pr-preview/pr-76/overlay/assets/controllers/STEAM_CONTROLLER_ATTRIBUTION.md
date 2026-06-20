# Steam Controller (2026) — asset attribution

The shipped `steam-controller-split.glb` is a derivative of official
engineering CAD released by **Valve Corporation** for the **2026 Steam
Controller**, by way of the cleanly-componentized parts in
[ceski-1/3d-controller-overlay](https://github.com/ceski-1/3d-controller-overlay).

## Geometry source & license

- **3D model author**: **ivaniovine** — the per-component Steam Controller 3D
  model carried by ceski-1/3d-controller-overlay was created by ivaniovine.
  - X/Twitter: <https://x.com/ivaniovine>
  - Reddit: <https://www.reddit.com/u/ivanim13>
  - Reddit post (r/GyroGaming): <https://www.reddit.com/r/GyroGaming/s/PuEIf6zxhR>
- **Original CAD**: <https://gitlab.steamos.cloud/SteamHardware/SteamController>
- **Copyright**: © 2026 Valve Corporation
- **License**: **Creative Commons Attribution-NonCommercial-ShareAlike 4.0
  International (CC BY-NC-SA 4.0)** — <https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode>
- **Intermediate**: ceski-1/3d-controller-overlay, `models/Steam Controller/`
  — the project is MIT-licensed, but its Steam Controller model carries its
  own `license.txt`: still **CC BY-NC-SA 4.0, © Valve**, with the note
  *"These files have been modified to reduce their polygon count."* and split
  into per-component parts.
- **Modifications in this repo**: the per-part `.obj` files were merged into a
  single GLB (one named node per part) by `tools/build-steam-controller-glb.mjs`.

Per CC BY-NC-SA share-alike, this derivative remains **CC BY-NC-SA 4.0** and
must keep attribution to Valve.

## How it's built here

The vendored source parts live in
[`steam-controller-src/`](steam-controller-src/) (ceski's `*.obj` +
`info.txt` + `license.txt` + `license_attribution.txt`). To (re)build the GLB:

```bash
node tools/build-steam-controller-glb.mjs            # → steam-controller-split.glb
# optional meshopt compression (matches the rest of the pipeline):
npx -y @gltf-transform/cli optimize \
  packages/visualizer/assets/controllers/steam-controller-split.glb \
  packages/visualizer/assets/controllers/steam-controller-split.glb \
  --join false
```

The build names each glTF node by its source part filename (`top_shell`,
`left_trigger`, `south_button`, `left_stick_base/ring/cap`, `dpad_*`,
`paddle1-4`, `touchpad`, …); the `steam-controller` profile in
`controller-profiles.js` addresses those names for per-button animation.
`_setupModel` auto-fits the model to ~0.25 m, so the build's `--scale` only
affects the raw file, not the on-screen size.

## Implications for downstream users

The rest of `@usersfirst/controller-visualizer` is MIT-licensed. This asset
is **not** — it carries Valve's non-commercial + share-alike terms:

- **Personal use, lab experiments, open-source non-commercial projects**:
  fine — keep this attribution file alongside the GLB.
- **Commercial use** (paid overlays, productized/sold software): the GLB
  cannot ship; replace it or drop it and fall back to the default profile.
- **Derivatives of the GLB**: must also be CC BY-NC-SA 4.0 with Valve
  attribution.

## Legacy

The earlier `steam-controller.glb` (monolithic, from Valve's solid STL via
`tools/stl-to-glb.js`) and the hand-painted `steam-controller.regions.json` +
`tools/face-painter`/`tools/split-glb.js` pipeline produced the previous
`steam-controller-split.glb`. That split-from-a-fused-solid had rough seams;
ceski's per-component parts are cleaner, so the split GLB is now built from
them. The legacy files are retained for history.
