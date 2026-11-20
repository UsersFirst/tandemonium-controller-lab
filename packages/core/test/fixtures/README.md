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

## `steam-controller-puck_28de-1304.json`

- **Source:** the `Capture HID Report` wizard in `apps/overlay`, captured
  2026-06-11 from a **Steam Controller 2026 via the wireless Puck**
  (`28de:1304`), USB connection. STATE reports are id `0x45`, 53 bytes.
- **Trimmed:** nine steps kept (`at-rest`, `pitch`, `face-buttons`,
  `system-buttons`, `triggers-shoulders`, `sticks`, `dpad`, `back-paddles`,
  `touchpad`), evenly downsampled to ≤120 reports each. Non-STATE 53-byte
  reports (`0x7b`/`0x43`) are left in and exercise the #28 report-id guard.
- **What it proves:**
  - **Trackpads** decode from the 0x45 STATE report at **left X@17 Y@19
    area@21, right X@23 Y@25 area@27** (int16 LE) — active sweeps during the
    touchpad step, inactive at rest (`steam-controller-trackpads.test.js`).
  - **Full button/stick/IMU map** against ground truth
    (`steam-controller-capture.test.js`): each scripted step pressed a known
    set of inputs, so face buttons, system buttons, all four dpad directions,
    all four paddles register; L2/R2 reach full pull and L1 registers; both
    sticks sweep the full range; and the IMU reads zero-bias + 1g at rest and
    responds when rotated. (R1 wasn't pressed in the captured window, so it's
    intentionally unasserted.)

## `steam-controller-puck-system_28de-1304.json`

- **Source:** the `Capture HID Report` wizard, captured 2026-06-12 from a
  **Steam Controller 2026 via Puck** (`28de:1304`) — the `system-buttons` step,
  taken **with the "…" quick-access button pressed**, downsampled to 120 reports.
- **What it proves** (`steam-controller-system-buttons.test.js`): the system
  buttons (Steam/View/Menu) and the **"…" quick-access button** all register.
  quickAccess is **btn0 bit 0x10** — the one unused face-byte bit, identified
  from this capture (it was silent in the general capture above).

## `steam-controller-puck-grip_28de-1304.json`

- **Source:** the `Capture HID Report` wizard's grip step, captured 2026-06-12
  from a **Steam Controller 2026 via Puck** (`28de:1304`) — squeeze left grip,
  then right — downsampled to ~120 reports.
- **What it proves** (`steam-controller-grip.test.js`): both capacitive grip
  sensors register. Grip flags are **byte 4: `0x20` = left, `0x10` = right**
  (digital, no pressure), identified by correlating each bit against which grip
  was squeezed.

## `sony-dualsense-bt-macos_054c-0ce6.json`

- **Source:** not the capture wizard. It is the driver's own
  `PlayStation IMU probe bytes (bluetooth 0x31, len=77, baseOffset=1)` console
  line, copied during the #83 hardware test of a **genuine Sony DualSense**
  (`054c:0ce6`) over **Bluetooth on macOS** (input report `0x31`), at rest.
- **Partial:** one report, and only its **first 32 of 77 bytes** (the console
  line prints no more). The fixture repeats that one frame 12 times so the
  probe gets its 10 reports. The bytes are untouched. `capturedAt` is the day
  of the test, not a recorded time.
- **What it proves** (`imu-probe.test.js`, #85): on macOS the report-ID byte
  is not in `event.data`, so the IMU sits at the documented DS5-BT offsets,
  **gyro 16 / accel 22**. At rest the gyro reads (-4, -9, 0) and the accel
  (-94, 7970, 1383), about 8090 raw (~1g, gravity on Y). Offsets 15 and 17
  score far worse.
- **What it does not cover:** buttons, sticks past the first bytes, the
  touchpad, any movement (no pitch or roll step), and the probe's recovery from
  a byte-shifted offset, which this hardware did not produce. A full wizard
  capture from a Mac should replace this file when one is taken.

The `bytes` field of each report is the WebHID input-report payload **with the
report ID already stripped** (as `HIDInputReportEvent.data` delivers it), so byte
indices map directly onto the driver's `parseReport` `DataView` offsets.

> The DualSense (DS5) fixture above is one partial Bluetooth frame. The rest of the DS5
> parse path is covered by synthesized frames in `playstation-driver.test.js`. Drop a
> full DS5 capture here and extend the probe test if you take one.
