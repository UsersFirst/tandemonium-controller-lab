# @usersfirst/overlay

Reference overlay app that wires [`@usersfirst/controller-core`](../../packages/core) (gamepad drivers + slot/claim manager) to [`@usersfirst/controller-visualizer`](../../packages/visualizer) (3D renderer). It exists to validate the package boundaries end-to-end and to serve as the canonical example of how a host app should consume the lab's packages.

The app is a transparent, always-on-top Electron overlay with a real-time 3D controller model: button presses, trigger pulls, stick deflection, gyro orientation, and (DualSense) touchpad tracking. There are two entry points:

- **Single-controller (`src/index.html` → `js/app.js`)** — one 3D model + gyro HUD, the classic streamer overlay.
- **Multi-controller (`src/multi.html` → `js/multi-app.js`)** — drives the `ControllerManager` slot/claim model from `@usersfirst/controller-core/manager` to show how two players can each claim a slot.

## Run it

From the repo root:

```bash
npm install                # hoists three + electron + workspace links
npm --workspace @usersfirst/overlay run start         # single-controller overlay
npm --workspace @usersfirst/overlay run start:multi   # two-player slot/claim demo
```

`prestart` runs `scripts/copy-three.js` (vendors Three.js into `src/lib/`) and `scripts/copy-workspace.js` (copies `@usersfirst/controller-core` and `@usersfirst/controller-visualizer` source into `src/lib/`, plus GLB models into `src/assets/controllers/`). This keeps the no-bundler ESM + importmap pattern from the original `petegordon/tandemonium` overlay — the HTML resolves bare specifiers like `three` and `@usersfirst/controller-core/manager` via a dynamic importmap.

## Build installers

```bash
npm --workspace @usersfirst/overlay run make           # ZIP + Windows Squirrel installer
npm --workspace @usersfirst/overlay run make:dmg       # macOS DMG (uses hdiutil)
```

## How it talks to the packages

| File                          | Imports from                                            |
| ----------------------------- | ------------------------------------------------------- |
| `src/js/app.js`               | `three`, `@usersfirst/controller-visualizer`, `@usersfirst/controller-core/drivers/controller-registry`, `@usersfirst/controller-core/sensor-fusion` |
| `src/js/multi-app.js`         | `@usersfirst/controller-visualizer`, `@usersfirst/controller-core/drivers/controller-registry`, `@usersfirst/controller-core/manager` |
| `electron/main.js`            | Electron only — handles `select-hid-device`, transparency, tray, click-through |

## Origin

Extracted from `petegordon/tandemonium`'s `controller-overlay/` directory. The behavior, button-combo defaults, and gyro calibration UX should match upstream pre-extraction.
