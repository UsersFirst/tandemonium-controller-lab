# GLB Face Painter

A standalone Three.js tool for splitting monolithic controller GLBs into per-button meshes.

Some controller GLBs ship as a single welded surface — Valve's Steam Controller STL has 259K triangles in one piece, GameSir's Super Nova is similar from photogrammetry. To get per-button highlight animation parity with DualSense / Xbox (which have separately-named meshes in their GLBs), the source mesh needs to be split. This tool lets you click+drag on a 3D model to "paint" faces, assign them to named regions, and save the region map as JSON. A companion CLI script (`tools/split-glb.js`) then consumes the JSON + the source GLB and emits a new GLB where each region is its own named mesh.

## Run

The painter is a vanilla HTML page that imports Three.js from a CDN — no build step. But ES-module imports need HTTP (file:// blocks them), so serve the directory first:

```bash
npx serve tools/face-painter
```

Open the printed URL (usually <http://localhost:3000>) in your browser.

## Workflow

1. **Load a GLB**: click *Open GLB…* and pick the source mesh (e.g. `packages/visualizer/assets/controllers/steam-controller.glb`).
2. **Add regions**: click *+ Add region* in the right panel — one per controller button / stick / d-pad direction.
3. **Rename + recolor**: click the ✎ or ● icons next to a region. Names become mesh names in the output GLB (use `face_a`, `dpad_up`, etc. matching the visualizer's `buttonMap` convention).
4. **Paint**: select the active region (click its row), then click on the model to paint that triangle into the region. Click+drag to paint multiple. Shift+click to remove a triangle from its region.
5. **Save**: click *Save region map…* — downloads a JSON file like `steam-controller.regions.json`.

## Export to split GLB

```bash
node tools/split-glb.js \
  packages/visualizer/assets/controllers/steam-controller.glb \
  ~/Downloads/steam-controller.regions.json \
  packages/visualizer/assets/controllers/steam-controller-split.glb
```

The output GLB has one `Mesh` per region, named exactly what you typed in the painter. Faces NOT assigned to any region become a `body` mesh.

## Using the split GLB

1. Replace the `model` path in `packages/visualizer/src/controller-profiles.js` for the target controller (e.g. `'steam-controller'`).
2. Populate `buttonMap`, `triggerMap`, `stickMap` with the region names you authored.
3. Optionally remove the `highlightMarkers` block — once real per-button meshes animate, procedural markers become redundant.

## Tips

- **Iterate small**: paint a few faces, save, reload to verify the JSON shape and your naming. Catching mistakes early is much cheaper than after assigning hundreds of faces.
- **Orbit + zoom**: drag rotates the camera, mouse wheel zooms. Paint only fires on left-click+drag, so the camera and painter don't conflict.
- **Unassigned faces are gray**: anything you don't paint into a region falls through to the `body` mesh in the export.

## JSON schema

`schema: 'glb-region-map/v1'`

```json
{
  "schema": "glb-region-map/v1",
  "sourceFile": "steam-controller.glb",
  "totalFaces": 259347,
  "savedAt": "2026-05-24T...",
  "regions": [
    { "name": "face_a", "color": "#33dd55", "faces": [42, 43, 117, ...] }
  ]
}
```

Face indices are triangle indices into the source mesh AFTER non-indexing (each triangle has its own three vertices). The split script applies the same non-indexing step before bucketing, so the index space stays consistent.
