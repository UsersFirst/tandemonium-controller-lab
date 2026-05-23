# tandemonium-controller-lab

Controller driver lab extracted from [Tandemonium](https://github.com/petegordon/Tandemonium). Vendor-agnostic gamepad drivers, a 3D visualizer, and a slot/claim manager for multi-controller coordination.

Pre-1.0 — the API will change.

## Packages

- [`@usersfirst/controller-core`](./packages/core) — vendor-agnostic gamepad drivers and the slot/claim manager (exported at `@usersfirst/controller-core/manager`).
- [`@usersfirst/controller-visualizer`](./packages/visualizer) — 3D controller overlay/visualizer.
- [`apps/overlay`](./apps/overlay) — reference overlay app that consumes the two packages above.

A Steam companion package (`@usersfirst/controller-steam`) will land in a later pass. The Steamworks SDK is never bundled or auto-downloaded by this repo.
