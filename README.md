# tandemonium-controller-lab

Controller driver lab extracted from [Tandemonium](https://github.com/petegordon/Tandemonium). Vendor-agnostic gamepad drivers, a 3D visualizer, and a slot/claim manager for multi-controller coordination.

Pre-1.0 — the API will change.

## Packages

- [`@usersfirst/controller-core`](./packages/core) — vendor-agnostic gamepad drivers (DualSense, Switch Pro, Xbox) plus the WebHID sensor-fusion runtime and the slot/claim `ControllerManager` (exported at `@usersfirst/controller-core/manager`, drivers at `@usersfirst/controller-core/drivers/*`, sensor fusion at `@usersfirst/controller-core/sensor-fusion`).
- [`@usersfirst/controller-visualizer`](./packages/visualizer) — Three.js-based 3D controller overlay/visualizer. Ships per-vendor GLB models and the `controller-profiles` that bind Gamepad-API indices to mesh names. `three` is a peer dependency.
- [`apps/overlay`](./apps/overlay) — reference Electron overlay app that consumes both packages. Mirrors the original `petegordon/tandemonium/controller-overlay` UX (transparent always-on-top window, button-combo settings, gyro HUD, multi-player slot/claim demo).

A Steam companion package (`@usersfirst/controller-steam`) will land in a later pass. The Steamworks SDK is never bundled or auto-downloaded by this repo.

## Run the overlay locally

```bash
npm install
npm --workspace @usersfirst/overlay run start         # single controller
npm --workspace @usersfirst/overlay run start:multi   # two-player slot/claim
```

See [`apps/overlay/README.md`](./apps/overlay/README.md) for build/packaging.

## Asset attribution

The GLB controller models in `packages/visualizer/assets/controllers/` derive from [larfingshnew/3d-controller-overlay](https://github.com/larfingshnew/3d-controller-overlay) (MIT). See [`packages/visualizer/ASSETS_ATTRIBUTION.md`](./packages/visualizer/ASSETS_ATTRIBUTION.md) for the upstream license text.
