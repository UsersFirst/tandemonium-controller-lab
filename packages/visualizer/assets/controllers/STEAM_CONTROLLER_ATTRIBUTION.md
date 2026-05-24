# Steam Controller (2026) — asset attribution

`steam-controller.glb` is derived from official engineering CAD released
by Valve Corporation for the **2026 Steam Controller**:

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

## Known limitation

The upstream STL is a single solid body — no separated parts for face
buttons, sticks, triggers, trackpads, or paddles. The matching
`PROFILES['steam-controller']` entry in
[`packages/visualizer/src/controller-profiles.js`](../../src/controller-profiles.js)
therefore wires gyro/body rotation only; button presses won't animate
against this asset. A properly separated version would need a Blender
pass over the STEP file (`SC_solid_stp_20260429.stp` in the upstream
repo) — STEP preserves the original assembly hierarchy where individual
components (buttons, triggers, sticks) are distinct solids.
