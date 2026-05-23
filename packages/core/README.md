# @usersfirst/controller-core

Vendor-agnostic gamepad drivers and the slot/claim manager extracted from Tandemonium. This package will hold the runtime that normalizes gamepad input across hardware vendors and exposes the slot/claim manager (available as a subpath export at `@usersfirst/controller-core/manager`) for coordinating which controller owns which gameplay slot. Driver implementations will live under `./src/drivers/*` and are reachable via the `@usersfirst/controller-core/drivers/*` subpath export.
