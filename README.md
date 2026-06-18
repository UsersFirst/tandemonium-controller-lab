# tandemonium-controller-lab

<p align="center">
  <a href="https://youtu.be/2cL5fkGg2FA" title="Watch the demo on YouTube">
    <img src="https://img.youtube.com/vi/2cL5fkGg2FA/hqdefault.jpg" alt="tandemonium-controller-lab demo — click to watch on YouTube" width="640">
  </a>
</p>

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

## Tests

`@usersfirst/controller-core` is covered by the built-in `node:test` runner with
no external dependencies — the suite imports only from `./src`, so it runs
without `npm install`:

```bash
npm test                                  # all workspaces (currently just core)
npm --workspace @usersfirst/controller-core test
```

Coverage focuses on the things most likely to regress silently: HID
parse-offset correctness (`PlayStationDriver.parseReport`), the IMU-offset probe
that disambiguates PlayStation-family clones, and the `DEVICES`/registry
invariants. The probe test runs against a **real GameSir Super Nova capture**
committed under [`packages/core/test/fixtures/`](./packages/core/test/fixtures/).
CI runs the same suite on every PR via [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## Credits & acknowledgments

The gyro sensor-fusion runtime (`@usersfirst/controller-core/sensor-fusion`) is derived from [**JibbSmart/GamepadMotionHelpers**](https://github.com/JibbSmart/GamepadMotionHelpers) by Julian "Jibb" Smart (MIT). The gravity tracking, tilt correction, and continuous bias-calibration math are ported from Jibb's reference implementation, and [**GyroWiki**](http://gyrowiki.jibbsmart.com/) — especially the "Finding Gravity with Sensor Fusion" article — was indispensable in building it. Thank you, Jibb, for both the code and the writing that makes gyro input approachable. See [`packages/core/THIRD_PARTY_NOTICES.md`](./packages/core/THIRD_PARTY_NOTICES.md) for the upstream license text.

## Asset attribution

The GLB controller models in `packages/visualizer/assets/controllers/` derive from [larfingshnew/3d-controller-overlay](https://github.com/larfingshnew/3d-controller-overlay) (MIT). See [`packages/visualizer/ASSETS_ATTRIBUTION.md`](./packages/visualizer/ASSETS_ATTRIBUTION.md) for the upstream license text.
