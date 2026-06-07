# Test fixtures

Golden captures used by the core test suite. These are **real HID captures**,
not synthesized data — they are ground truth for the parse-offset and IMU-probe
tests.

## `gamesir-super-nova-ds4_054c-09cc.json`

- **Source:** the `Capture HID Report` wizard in `apps/overlay`
  (`schema: controller-test-report/v1`), captured 2026-05-23.
- **Device:** GameSir Super Nova in DS4 mode, which spoofs Sony's DualShock 4 v2
  USB identity `054c:09cc` (productName "Wireless Controller"), USB connection.
- **Trimmed:** the original capture holds ~2500 reports per step; this fixture
  keeps **45 reports/step sampled evenly across each step** (not first-N — that
  misses the rotation, which ramps up after the user gets into position). Byte
  sequences within each kept report are untouched.
- **What it proves:** at-rest accel magnitude is ≈8243 raw (~1g at the
  ±4g/16-bit scale) **only** at `gyroOffset=12 / accelOffset=18`; offsets 13 and
  15 yield garbage (>24000). This is the empirical basis for the
  `gamesir-ds4` IMU family and for `PlayStationDriver`'s `mode:'ds4'` offsets.

## `sony-dualshock4-v1-bt_054c-05c4.json`

- **Source:** the `Capture HID Report` wizard in `apps/overlay`, captured
  2026-06-06 from a **genuine Sony DualShock 4 v1** (`054c:05c4`) over
  **Bluetooth** (input report `0x11`).
- **Trimmed:** 45 reports/step sampled evenly across each step, and each report
  cut to the first **80 bytes** — the real DS4 BT report is 77 bytes; Chromium
  delivers a 546-byte buffer that is zero-padded past byte 76, so the tail
  carries no information.
- **What it proves (resolves the DS4-BT investigation):** at rest the accel
  magnitude is ≈8181 raw (~1g) with gyro bias ≈0 **only** at `gyroOffset=14 /
  accelOffset=20` (= USB 12/18 **+2** for the BT header); odd offsets are
  garbage. So a real Sony DS4's IMU sits at byte **12** (USB-equivalent) — the
  **same** layout as the GameSir clones, *not* the byte-13 "Linux hid-sony"
  layout previously assumed. Axis mapping (pitch→gyroX, roll→gyroZ, yaw→gyroY)
  is identical to the GameSir capture, so the shared steering pipeline needs no
  DS4-specific axis/sign/scale handling.

The `bytes` field of each report is the WebHID input-report payload **with the
report ID already stripped** (as `HIDInputReportEvent.data` delivers it), so byte
indices map directly onto `PlayStationDriver.parseReport`'s `DataView` offsets.

> No genuine DualSense (DS5) capture exists in this repo yet — the DS5 parse path
> is covered by synthesized frames in `playstation-driver.test.js`. Drop a real
> DS5 report here and extend the probe test if you capture one.
