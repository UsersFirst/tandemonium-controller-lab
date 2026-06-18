# @usersfirst/controller-core

Vendor-agnostic gamepad drivers, WebHID sensor fusion, and the slot/claim `ControllerManager` extracted from [Tandemonium](https://github.com/petegordon/Tandemonium).

## Subpath exports

| Specifier                                                  | What it exports                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@usersfirst/controller-core`                              | Barrel: `ControllerManager`, `SensorFusion`, all drivers + registry, `DEVICES`, `PROTOCOLS`, helpers     |
| `@usersfirst/controller-core/manager`                      | Slot/claim manager + synthetic-gamepad helpers (the headless P1/P2/... lifecycle)                        |
| `@usersfirst/controller-core/sensor-fusion`                | `SensorFusion` (gyro orientation + bias calibration + drift correction)                                  |
| `@usersfirst/controller-core/drivers/controller-registry`  | Registry lookup (`getEntry`, `getDriver`, `identifyFromGamepadId`, `getGamepadQuirks`, ...)              |
| `@usersfirst/controller-core/drivers/base-driver`          | Abstract `ControllerDriver` (protocol interface)                                                         |
| `@usersfirst/controller-core/drivers/playstation-driver`   | PlayStation (DualSense + DualShock 4) protocol — gyro, accel, touchpad, lightbar. Registered under the `'dualsense'` protocol key. |
| `@usersfirst/controller-core/drivers/switch-pro-driver`    | Switch Pro protocol — IMU enable + gyro                                                                  |
| `@usersfirst/controller-core/drivers/xbox-driver`          | Xbox identity stub (Gamepad-API only on Chromium; no WebHID capabilities today)                          |
| `@usersfirst/controller-core/drivers/steam-controller-driver` | Steam Controller 2026 identity stub (placeholder for full Steam Input parsing)                        |

## What it does

`ControllerManager` owns N player slots (typically P1/P2). WebHID devices live in a separate pool; pairing a device starts its own `SensorFusion` + synthetic-gamepad immediately, and a slot only takes ownership at *claim time* (so "first to press" assignment is preserved). On release, the entry returns to the pool with fusion still running for seamless re-claim. See the original design in Tandemonium issues #222 / #224.

`SensorFusion` keeps orientation, gravity, stillness detection, and bias-calibration state internal — replacing ~250 lines of duplicated gyro math that used to live inside each consumer. Its algorithms are derived from [JibbSmart/GamepadMotionHelpers](https://github.com/JibbSmart/GamepadMotionHelpers) by Julian "Jibb" Smart (MIT) and the [GyroWiki](http://gyrowiki.jibbsmart.com/) write-ups; see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for the upstream license.

No bundler is required — this is plain ESM. Designed for direct use in Electron + browser contexts via importmap, as well as bundlers (Vite, webpack, esbuild) for web apps.

## Device dictionary

All controller identity lives in [`src/devices.js`](./src/devices.js). Driver classes are pure protocol implementations; the dictionary maps physical (`vendorId`, `productId`) pairs to a protocol + per-device metadata.

### Entry shape

```js
{
  name:             'Sony DualSense',           // display name (UI / logs)
  vendorId:         0x054c,
  productId:        0x0ce6,
  protocol:         'dualsense',                // key in PROTOCOLS map
  mode:             'ds5',                      // optional protocol sub-mode hint
  capabilities:     { gyro: true, accel: true, touchpad: true },
  gamepadIdPattern: /playstation|dualsense/i,   // primary Gamepad-API matcher
  gamepadIdMatch:   /^Gamepad/i,                // optional secondary filter
  quirks:           { swapAB: true },           // optional runtime hints
  controllerProfile: 'gamesir-super-nova',      // optional — visualizer GLB key,
                                                //   defaults to `protocol`
}
```

The `controllerProfile` field decouples the 3D visualizer model from the protocol family. By default an entry uses its `protocol` as the visualizer profile key, so Sony's DualSense/DualShock 4 entries all get the same `dualsense.glb` model. Set it explicitly to point a clone at its own GLB once that asset exists — for example, a GameSir Super Nova entry would set `controllerProfile: 'gamesir-super-nova'` after a corresponding `PROFILES['gamesir-super-nova']` block + GLB file land in the visualizer package. See [`docs/ADDING-A-CONTROLLER.md`](../../docs/ADDING-A-CONTROLLER.md) for the GLB-authoring story.

`identifyFromGamepadId` runs a two-pass walk over `DEVICES`: entries with a `gamepadIdMatch` secondary filter win first, then entries without one act as defaults. That ordering is what lets the GameSir Cyclone (Switch mode) entry claim the Gamepad-API string before the broader Switch Pro entry does — both share vid:pid `057e:2009`, but only Cyclone reports a `gamepad.id` starting with `"Gamepad"`.

### Adding a new controller that speaks an existing protocol

One line in [`src/devices.js`](./src/devices.js):

```js
{ name: 'Whatever Controller', vendorId: 0xabcd, productId: 0x1234,
  protocol: 'dualsense', capabilities: PS_CAPS, gamepadIdPattern: /whatever/i },
```

That's the whole change — registry lookups, HID filters, and capability checks all read from `DEVICES`.

### Adding a new protocol

1. Write a class under `src/drivers/` extending `ControllerDriver`. Override `parseReport`, `init`/`destroy`, `detectConnectionType`, and optionally `makeHidFilter` (the default returns `{vendorId, productId, usagePage: 0x0001, usage: 0x0005}` — Switch Pro is the one that overrides because the macOS Chrome Gamepad API claims the gamepad interface exclusively).
2. Register it in `PROTOCOLS` at the top of [`src/devices.js`](./src/devices.js).
3. Add one or more `DEVICES` entries referencing the new protocol key.

The dictionary entry is attached to each driver instance as `driver.entry`, so consumers can read `driver.entry.name` / `driver.entry.capabilities` / `driver.entry.mode` / `driver.entry.quirks` without re-querying the registry.

### Pending entries

`PENDING_DEVICES` documents controllers we plan to support but for which the product ID isn't captured yet (GameSir Super Nova in DS4 mode, Steam Controller 2026). They are not registered with the runtime registry — moving an entry from `PENDING_DEVICES` to `DEVICES` once the pid is captured is the activation step. The comments in `devices.js` describe how to capture a pid on Windows / macOS / Linux.
