# @usersfirst/controller-visualizer

Three.js-based 3D controller renderer extracted from [Tandemonium](https://github.com/petegordon/Tandemonium). Turns a live `Gamepad` (and optional `SensorFusion` quaternion) into an animated on-screen controller — buttons depressing, sticks tilting, triggers pulling, gyro tilting the body, touchpad tracking finger strokes — suitable for overlays, debug tools, and tutorials.

## Exports

```js
import {
  ControllerOverlay,      // the renderer class
  GyroGimbal,             // small 3D gimbal HUD that visualises gyro orientation
  PROFILES,               // per-controller GLB + mesh-binding profiles
  detectControllerType,   // sniff "dualsense" | "switch-pro" | "xbox" from gamepad.id
} from '@usersfirst/controller-visualizer';
```

Subpaths (`/controller-overlay`, `/controller-profiles`, `/gyro-gimbal`) are exposed for callers who want a tighter dependency. The GLB assets are shipped at `@usersfirst/controller-visualizer/assets/controllers/{dualsense,switch-pro,xbox}.glb`.

## Peer dependency

`three@^0.161.0` — the host app provides it. The visualizer imports `three` and `three/addons/loaders/GLTFLoader.js` / `three/addons/loaders/OBJLoader.js` / `three/addons/controls/OrbitControls.js` via bare specifiers; either a bundler or an importmap must resolve them.

## GLB assets

`assets/controllers/{dualsense,switch-pro,xbox}.glb` derive from [larfingshnew/3d-controller-overlay](https://github.com/larfingshnew/3d-controller-overlay) (MIT). See [`ASSETS_ATTRIBUTION.md`](./ASSETS_ATTRIBUTION.md) for the upstream copyright + license text.

`PROFILES` references the models with relative paths (e.g. `assets/controllers/dualsense.glb`) — the host app is responsible for serving them at that URL. The reference app under `apps/overlay/` does this by copying the GLBs into its `src/assets/controllers/` directory at build time (see `apps/overlay/scripts/copy-workspace.js`).
