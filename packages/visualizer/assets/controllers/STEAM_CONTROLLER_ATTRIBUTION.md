# Steam Controller (2026) — asset attribution

Both `steam-controller.glb` and `steam-controller-split.glb` are derived
from official engineering CAD released by Valve Corporation for the
**2026 Steam Controller**:

- **Source repository**: <https://gitlab.steamos.cloud/SteamHardware/SteamController>
- **Source file**: `sc_solid_stl_20260429.stl` (binary STL, ~79 MB, ~1.58 M
  triangles, snapshot dated 29 April 2026)
- **Copyright**: © 2026 Valve Corporation
- **License**: **Creative Commons Attribution-NonCommercial-ShareAlike 4.0
  International (CC BY-NC-SA 4.0)** — full text: <https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode>

## Conversion pipeline

The GLB shipped here was produced by:

1. Downloading the upstream STL from the GitLab project above.
2. Running `node tools/stl-to-glb.js <stl> <raw.glb> 0.001` to convert
   binary STL to indexed glTF (dedup + mm→m scaling).
3. Running `npx -y @gltf-transform/cli optimize <raw.glb> <out.glb>
   --simplify-ratio 0.03` to decimate (1.58 M → 259 K triangles) and
   weld duplicate vertices.

The resulting GLB inherits Valve's CC BY-NC-SA 4.0 license — it is a
derivative work of the upstream CAD geometry.

## Per-button mesh split

`steam-controller-split.glb` is the per-button-animation version, derived
from `steam-controller.glb` by hand-painting face regions in
`tools/face-painter/` and bucketing the triangles via `tools/split-glb.js`.
It has 29 named meshes (face buttons, bumpers, triggers, stick assemblies,
dpad-cardinal wedges, trackpads, back paddles, system buttons, residual
body) so each input animates independently.

The painted region map is checked in as
[`steam-controller.regions.json`](steam-controller.regions.json) — that's
the canonical hand-painted source. Edit it in the painter to refine
regions; the GLB is a deterministic derivation.

### Regenerating `steam-controller-split.glb` from the regions JSON

```bash
# 1. Auto-split the single `dpad` region into four cardinal wedges
node tools/split-dpad.js \
  packages/visualizer/assets/controllers/steam-controller.glb \
  packages/visualizer/assets/controllers/steam-controller.regions.json \
  /tmp/steam-controller.regions.dpad-split.json

# 2. Bucket triangles by region → one named mesh per region
node tools/split-glb.js \
  packages/visualizer/assets/controllers/steam-controller.glb \
  /tmp/steam-controller.regions.dpad-split.json \
  packages/visualizer/assets/controllers/steam-controller-split.glb

# 3. Compress (meshopt + simplify) to ~750 KB
npx -y @gltf-transform/cli optimize \
  packages/visualizer/assets/controllers/steam-controller-split.glb \
  packages/visualizer/assets/controllers/steam-controller-split.glb \
  --join false --simplify-ratio 0.10
```

## Implications for downstream users

The rest of `@usersfirst/controller-visualizer` is MIT-licensed. This
single asset (`steam-controller.glb`) is **not** MIT — it carries the
non-commercial and share-alike restrictions from Valve's license. In
practice:

- **Personal use, lab experiments, open-source non-commercial projects**:
  fine, just keep this attribution file alongside the GLB.
- **Commercial use** (paid streaming overlays, productized streaming
  software, anything sold or part of a commercial offering): the GLB
  cannot ship. Replace it with a self-modelled or differently-licensed
  asset, or drop it and let the visualizer fall back to the default
  protocol profile.
- **Derivative works of the GLB** (e.g. someone splits the monolithic
  mesh into per-button parts for animation): the derivative must also
  be CC BY-NC-SA 4.0, and must keep attribution to Valve.

## Notes on the source mesh

The upstream STL is a single solid body — no separated parts for face
buttons, sticks, triggers, trackpads, or paddles. The split version
(`steam-controller-split.glb`) recovers per-part animation by painting
regions on the surface rather than from CAD hierarchy. A Blender pass
over the STEP file (`SC_solid_stp_20260429.stp` in the upstream repo)
could potentially do the same from real assembly geometry, but the
face-painter approach is faster to iterate and easier to refine.
