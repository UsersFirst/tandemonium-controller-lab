# @usersfirst/controller-core

Vendor-agnostic gamepad drivers, WebHID sensor fusion, and the slot/claim `ControllerManager` extracted from [Tandemonium](https://github.com/petegordon/Tandemonium).

## Subpath exports

| Specifier                                                  | What it exports                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@usersfirst/controller-core`                              | Barrel: `ControllerManager`, `SensorFusion`, all drivers + registry, helpers (`gamepadHasActivity`, ...) |
| `@usersfirst/controller-core/manager`                      | Slot/claim manager + synthetic-gamepad helpers (the headless P1/P2/... lifecycle)                        |
| `@usersfirst/controller-core/sensor-fusion`                | `SensorFusion` (gyro orientation + bias calibration + drift correction)                                  |
| `@usersfirst/controller-core/drivers/controller-registry`  | Driver lookup (`getDriver`, `connect`, `getHIDFilters`, `identifyFromGamepadId`, ...)                    |
| `@usersfirst/controller-core/drivers/base-driver`          | Abstract `ControllerDriver`                                                                              |
| `@usersfirst/controller-core/drivers/dualsense-driver`     | DualSense (PS5) WebHID driver — gyro, accel, touchpad, lightbar                                          |
| `@usersfirst/controller-core/drivers/switch-pro-driver`    | Switch Pro WebHID driver — IMU enable + gyro                                                             |
| `@usersfirst/controller-core/drivers/xbox-driver`          | Xbox identity (Gamepad-API only on Chromium; no WebHID capabilities today)                               |

## What it does

`ControllerManager` owns N player slots (typically P1/P2). WebHID devices live in a separate pool; pairing a device starts its own `SensorFusion` + synthetic-gamepad immediately, and a slot only takes ownership at *claim time* (so "first to press" assignment is preserved). On release, the entry returns to the pool with fusion still running for seamless re-claim. See the original design in Tandemonium issues #222 / #224.

`SensorFusion` keeps orientation, gravity, stillness detection, and bias-calibration state internal — replacing ~250 lines of duplicated gyro math that used to live inside each consumer. App-layer calibration logic (variance check + retry UX) can still own its own loop and push the captured bias into `SensorFusion.bias`.

No bundler is required — this is plain ESM. Designed for direct use in Electron + browser contexts via importmap, as well as bundlers (Vite, webpack, esbuild) for web apps.
