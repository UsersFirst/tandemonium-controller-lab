# Optimizing controller GLB models

Photogrammetry tools (Polycam, Trellis, Meshroom, Luma) produce gigantic GLBs — one big mesh, millions of triangles, full-resolution PBR textures. A raw output is typically 50–200 MB. The visualizer renders at ~600×400 px, so most of that detail is invisible at runtime, and a 50 MB binary is too big to commit to git anyway.

**Target for a controller GLB**: under **2 MB**, under **50,000 triangles**, textures at **1024² or smaller**. The existing `dualsense.glb` / `xbox.glb` / `switch-pro.glb` in this repo are all under 200 KB.

This guide covers the easiest path: a one-command optimization with [`gltf-transform`](https://gltf-transform.dev), Don McCurdy's Node-based CLI. No GUI, no Blender. If you want hand-tuned results (or to separate meshes for button animations), see the [Blender path](#blender-path-optional) at the bottom.

## Prerequisites

You already have Node installed (the lab uses it). `gltf-transform` is run via `npx` so nothing else to install:

```bash
npx -y @gltf-transform/cli inspect path/to/super_nova.glb
```

That `inspect` command tells you what's in the file before optimizing — total size, triangle count, texture resolution, mesh count. Run it first to see what you're working with.

## The one-command path

For a typical photogrammetry GLB, this is what you want:

```bash
npx -y @gltf-transform/cli optimize \
  path/to/super_nova.glb \
  path/to/super_nova_opt.glb \
  --texture-size 1024 \
  --simplify 0.03 \
  --texture-compress webp
```

What each flag does:

| Flag | Effect | Why |
| --- | --- | --- |
| `--texture-size 1024` | Downscale textures to max 1024×1024 | Photogrammetry textures are usually 4K+. At overlay size, 1024² is indistinguishable from 4K. Cuts most of the file weight. |
| `--simplify 0.03` | Keep ~3% of original triangles | 1.5 M → ~45 K. Visible quality is fine at small render sizes; the silhouette stays intact. |
| `--texture-compress webp` | Re-encode textures as WebP | 30–50% smaller than the PNG/JPEG photogrammetry usually exports. |

Run it, then `inspect` the output to confirm:

```bash
npx -y @gltf-transform/cli inspect path/to/super_nova_opt.glb
```

Expect to see file size in the 1–3 MB range, triangle count in the 30–50 K range. If still too large, drop `--texture-size` to `512` and/or `--simplify` to `0.01`.

## Iterating if the result looks wrong

`simplify` is the most likely culprit when the optimized model looks off. Adjust:

- **Too blob-y / lost detail** (`--simplify 0.03` was too aggressive): try `0.05` or `0.10`.
- **Still too large** (`--simplify 0.03` wasn't enough): try `0.01`.
- **Black or missing texture** (rare): `--texture-compress webp` can occasionally fail on weird PBR setups. Drop the flag and accept the larger size, or try `--texture-compress webp --texture-allow-lossy false`.

## Verify in the overlay before committing

Drop the optimized file into `packages/visualizer/assets/controllers/` with the name the dictionary references — for example `gamesir-super-nova.glb` — and follow steps 4–6 of [ADDING-A-CONTROLLER.md § "Adding a custom 3D visualizer"](./ADDING-A-CONTROLLER.md#7--adding-a-custom-3d-visualizer-for-the-controller) to wire up a `PROFILES` entry and the `controllerProfile` field on the dictionary entry. Launch the overlay and watch it load — both the size and the visual sanity are easier to judge in-app than in a viewer.

Then commit. Track the file size in the commit message so future-you can scan history for "GLB regressions."

## Blender path (optional)

If you need to **separate meshes for button animations** (Polycam/Trellis output is monolithic — you get one mesh per controller, not one per button), optimization alone won't get you there. You'll need Blender:

1. Open the raw GLB in Blender (File → Import → glTF).
2. Enter Edit mode, select faces of each button / stick / trigger by hand, use `P → Selection` to split each into its own mesh object.
3. Rename each new mesh object to the convention (`face_cross`, `face_circle`, `dpad_up`, `stick_left`, `stick_left_ring`, `stick_left_base`, `trigger_l2`, `trigger_r2`, `bumper_l1`, `bumper_r1`, `button_create`, `button_options`, `button_ps`, `body_top`, `body_bottom`). The existing `dualsense.glb` is the canonical reference — open it in [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com) to see its mesh tree.
4. Apply Decimate modifier per mesh (Properties → Modifier Properties → Add Modifier → Generate → Decimate, ratio 0.05 or whatever looks right).
5. File → Export → glTF 2.0 (.glb), enable "Include → Selected Objects" or "Visible Objects."
6. Then re-run the `gltf-transform optimize` pipeline above for the texture/compression pass.

This is significant manual work — typically 1–3 hours per controller — but it's the only way to get full button-press animation on a photogrammetry-sourced model. Alternatively, accept "body-only, gyro-tilts-but-buttons-don't-animate" as a known limitation per controller until a properly-modeled GLB shows up.

## Where this all goes

After optimization, the flow back into the lab is:

1. **File** lands at `packages/visualizer/assets/controllers/<your-profile-key>.glb`
2. **`PROFILES['<your-profile-key>']`** entry in [`packages/visualizer/src/controller-profiles.js`](../packages/visualizer/src/controller-profiles.js) — `model:` points to the file, `buttonMap` / `triggerMap` / `stickMap` reference mesh names found in the GLB
3. **`controllerProfile: '<your-profile-key>'`** added to the relevant [`devices.js`](../packages/core/src/devices.js) entry — without this the visualizer falls back to `entry.protocol` and loads the protocol-default model instead
