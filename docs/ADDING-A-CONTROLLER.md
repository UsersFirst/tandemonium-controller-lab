# Adding a controller to the lab

End-to-end workflow for teaching the lab about a new physical controller — buttons, sticks, triggers, and IMU. The tooling does most of the work; you mostly just press buttons when prompted.

The walk-through below was captured live while adding the **GameSir Super Nova** (in DS4 mode). Use it as both the abstract recipe and a concrete worked example.

---

## 0 — Prerequisites

- Lab built and runnable: `npm install` at the repo root, then `npm --workspace @usersfirst/overlay run start` opens the single-controller overlay.
- Controller plugged in (USB recommended for a clean capture; Bluetooth works but the report layout differs slightly).
- Five minutes of patience for the wizard.

## 1 — Capture vid:pid

Every USB HID controller advertises a `vendorId:productId` pair. The lab keys protocol and feature decisions off this, so step one is finding out what your pad reports as. Three ways:

- **PowerShell, Windows** — fast and self-contained:
  ```powershell
  Get-PnpDevice -Class HIDClass -PresentOnly |
    Where-Object { $_.FriendlyName -like '*<keyword>*' } |
    Select-Object FriendlyName, InstanceId
  ```
  The `InstanceId` is `HID\VID_xxxx&PID_yyyy\...`.
- **macOS / Linux** — `ioreg -p IOUSB -l | grep -i <name>` or `lsusb`.
- **In the overlay** — launch it, open DevTools (Ctrl+Shift+I), watch for `bootstrapFromHID: found ... vid:xxxx pid:yyyy` in the console.

For multi-mode pads (GameSir, 8BitDo, etc.), put the controller in the *target mode* first — vid:pid changes with the mode.

> **Super Nova case study.** In DS4 mode the Super Nova reports `0x054c:0x09cc` — Sony's DualShock 4 v2 PID. It **impersonates Sony at the USB level**, which means our dictionary's existing `Sony DualShock 4 v2` entry matches it. There's no way to auto-distinguish from a real Sony DS4 (same productName too: "Wireless Controller"); the spoof picker handles this at capture time.

## 2 — Identify the protocol

If the vid:pid matches a known controller family, the existing protocol driver probably already handles it:

| Family | Driver class | Examples |
| --- | --- | --- |
| PlayStation (DS4 + DS5) | `DualSenseDriver` | DualSense, DualSense Edge, DualShock 4, GameSir Super Nova/Cyclone in DS4 mode |
| Nintendo Switch Pro | `SwitchProDriver` | Switch Pro, GameSir Cyclone in Switch mode |
| Xbox | `XboxDriver` | All Xbox families (Gamepad-API only, no WebHID features) |
| Steam Controller 2026 | `SteamControllerDriver` | (stub — real HID parsing TBD) |

If your controller speaks a brand-new protocol (not one of the above), you'll need a new driver class under `packages/core/src/drivers/`. That's beyond this guide; the existing classes are good templates.

## 3 — Capture a Test Report

In the overlay, open **Settings → Diagnostics → CAPTURE HID REPORT**.

1. **Spoof picker** (only appears when multiple known entries share your vid:pid). Pick the option that matches the physical pad you're using. There's an "Unknown / something else" option for pads not in the dictionary yet.
2. **Nine scripted steps**:
   1. At rest (5s) — controller flat on desk, no contact
   2. Pitch (5s) — slow front-up / front-down
   3. Roll (5s) — slow left-down / right-down
   4. Yaw (5s) — slow rotate left / right
   5. Face buttons (9s) — ✕/A → ◯/B → ▢/X → △/Y
   6. System buttons (10s) — PS/Home → Share/Create → Options/Menu → Touchpad-click → Mute
   7. Triggers + shoulders (10s) — L2 → R2 → L1 → R1
   8. Sticks + D-pad (12s) — left stick circle, right stick circle, D-pad sweep
   9. Touchpad swipe / back paddles (6–8s, optional) — drag finger across pad and/or click extras

   Steps are filtered by the picked entry's `features` block — Xbox skips all IMU/touchpad steps, Switch Pro skips touchpad, etc. Each step has a 3-2-1 countdown and a live "Xs left · N reports captured" counter so you can pace yourself.
3. **Name + note**, then **Save**. The JSON lands wherever you point the dialog.

## 4 — Run the auto-analyzer

```
node tools/analyze-report.js path/to/controller-test-report.json
```

This prints:
- Top 5 candidate IMU offsets (best = at-rest accel magnitude closest to 8192 raw)
- Which gyro axis activated during pitch / roll / yaw (gyro-X = pitch, etc.)
- Which bytes change during button steps (face buttons, triggers, sticks)
- Warnings for skipped steps or missing data
- A **candidate `DEVICES` entry** ready to paste into `packages/core/src/devices.js`

> **Super Nova worked example.** Running the analyzer on the Super Nova capture produced:
>
> ```
> Winner: gyroOffset=12, accelOffset=18
>   At-rest accel magnitude 8242.6 (target 8192 = 1g; 100.6% of 1g)
>
> ── Gyro axis mapping ──
>   pitch   gyroX_std=153.7    likely axis: gyro X
>   roll    gyroZ_std=203.3    likely axis: gyro Z
>   yaw     gyroY_std=257.2    likely axis: gyro Y
> ```
>
> The "winner" line told us GameSir packs IMU at byte 12/18 — three bytes earlier than Sony's DualSense layout (15/21). That single insight fixed a months-old latent bug: the existing DualSense parser was *also* wrong for real Sony DS4 (which uses the same byte-12 layout), it had only ever been validated against a DualSense (DS5). The fix in [packages/core/src/drivers/dualsense-driver.js](../packages/core/src/drivers/dualsense-driver.js) branches on `entry.mode === 'ds4'` and lights up both clones and real Sony DS4 hardware simultaneously.

## 5 — Update `devices.js`

The analyzer's suggested entry is a starting point, not gospel. Things to review by hand:

- **`gamepadIdPattern`** — the analyzer can't infer this; use the device's `gamepad.id` string as a guide. For PlayStation family, `/playstation|dualsense|dualshock|054c/i` is the convention.
- **`features` block** — analyzer guesses based on which steps had data. If you skipped a step, the corresponding feature is set `false`; toggle to `true` if the controller *does* have that feature (you just didn't capture it).
- **`spoofs` block** — present this entry if your controller advertises another's USB identity, with `{ of, vendorId, productId }` naming what's being spoofed. Multiple entries for the same vid:pid is fine; the spoof picker will surface them all.
- **`notes`** — anything an analyzer can't infer. "back paddles labelled M1/M2/M3/M4", "Switch mode needs IMU handshake retry on cold boot", etc.

If the IMU offsets are **non-standard** (the analyzer flags this — it knows offsets 12 and 15 are the two "canonical" DualSense/DS4 windows), add an `imu` override block. The driver should be taught to consult `this.entry?.imu` for these overrides — at time of writing only the `mode` field is consulted, so genuinely-novel layouts may need a driver-side change first.

## 6 — Verify

1. `npm --workspace @usersfirst/overlay run start`
2. Plug in the controller, confirm:
   - Spoof picker shows your new entry (if you added one to a multi-match vid:pid)
   - Wizard's step list reflects the entry's `features`
   - 3D model holds still at rest, tilts in the right direction, calibration stddev is single digits (not thousands)
   - Buttons / triggers / sticks all respond as expected
3. Re-run the Test Report wizard against your new entry, verify the analyzer's output now matches the entry you wrote.

## 7 — Future: 3D model + image-driven feature detection

The current visualizer uses GLB models keyed by controller "profile" (DualSense, Switch Pro, Xbox). Adding a new model is currently a manual step (drop a `.glb` into `packages/visualizer/assets/controllers/` and add a `PROFILES` entry).

Planned future work:
- **Photo → 3D model**: pipe 3–4 photos of the controller through a photogrammetry tool (Polycam, Trellis, Meshroom) and ingest the resulting GLB.
- **Photo → feature detection**: use a vision model (Claude with vision, e.g.) to identify face buttons / sticks / paddles from the same photos, auto-populating the `features` block.

For now, GLB and feature inventory are manual.

## Appendix — Where things live

| Concern | File |
| --- | --- |
| Dictionary of known controllers | [`packages/core/src/devices.js`](../packages/core/src/devices.js) |
| Registry API (`getEntry`, `getAllEntries`, `connect`) | [`packages/core/src/drivers/controller-registry.js`](../packages/core/src/drivers/controller-registry.js) |
| Protocol drivers (one per family) | [`packages/core/src/drivers/`](../packages/core/src/drivers/) |
| Test Report wizard UI | [`apps/overlay/src/js/test-report.js`](../apps/overlay/src/js/test-report.js) + the wizard IIFE near the bottom of [`apps/overlay/src/js/app.js`](../apps/overlay/src/js/app.js) |
| Auto-analyzer | [`tools/analyze-report.js`](../tools/analyze-report.js) |
| Visualizer profiles + GLB models | [`packages/visualizer/src/controller-profiles.js`](../packages/visualizer/src/controller-profiles.js), [`packages/visualizer/assets/controllers/`](../packages/visualizer/assets/controllers/) |
