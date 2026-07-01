# Steam Controller 2026 — Gyro Yaw-Drift ("rotated to the left") Plan

**Status:** Proposed · **Date:** 2026-07-01 · **Owner:** pete
**Scope:** `packages/core` (sensor-fusion + SC driver), `apps/overlay` (settings + HUD),
`packages/visualizer` (gimbal idle behavior)

> **One-sentence thesis.** The overlay's persistent "tilts a bit to the left and
> stays there" is **yaw drift**, not tilt drift — and gravity correction *cannot*
> fix yaw by construction. We address it with a persistent recenter offset +
> return-to-neutral-at-rest, tighter SC auto-calibration, and (if the data exists)
> a firmware-quaternion fast-path that sidesteps integration entirely.

---

## 0. Symptom, in the user's words

> "After a few seconds of actually using the controller, the overlay always
> displays the controller rotated a bit to the left … no matter how many times I
> re-center/calibrate, the controller will always eventually tilt like this and
> stay consistently in this angle while resting."

Two properties matter and both point at the same root cause:

1. **It's a heading (yaw) offset, and it's to the *left*** — a consistent sign,
   i.e. a systematic (not random) rotation about the vertical axis.
2. **It *settles* and *stays* at a fixed angle while resting** — it doesn't keep
   creeping forever. The drift accumulates during use, then freezes.

This is the classic signature of gyro **yaw bias** being (a) integrated into the
orientation during motion and then (b) frozen in place once the auto-calibration
re-zeros the rate — leaving the *accumulated angle* baked in with nothing able to
pull it back.

---

## 1. Why this happens (root-cause analysis)

### 1.1 Gravity correction is 2-DOF and cannot touch yaw

`SensorFusion` (`packages/core/src/sensor-fusion.js`) corrects orientation drift by
tracking the gravity vector from the accelerometer and rotating the integrated
orientation so its "down" matches measured "down" (see the tilt-correction block,
`sensor-fusion.js:386-398`). Gravity gives an absolute reference for **pitch** and
**roll** only. Rotation *about* the gravity axis — **yaw / heading** — is invisible
to the accelerometer, so:

- Any residual **yaw-axis** bias integrates without bound.
- No amount of gravity correction can pull it back.
- The user's "Gravity Correction: Off/Gentle/Strong" dropdown
  (`app.js:198-201`, scaling `gyroFusion.gravityMode`) scales *only* the tilt
  correction — it does nothing for the drift they're actually seeing.

This is why **re-centering only helps momentarily**: recenter resets the integrated
orientation to identity (`startCalibration()` → `resetGyroState()` →
`gyroFusion.reset()`, `app.js:1512-1514`, `1769-1777`), but the moment the
controller is used again the residual yaw bias starts re-accumulating.

### 1.2 The "SC auto-calibration problem" freezes a *wrong* heading in place

The overlay runs three bias estimators (`sensor-fusion.js:30-40`):

- **Initial one-shot calibration** (app-layer, `app.js:1747-1817`) — captures bias
  at connect while the controller is still.
- **Continuous stillness calibration** (`_updateStillnessCalibration`) — re-zeros
  bias after ~2 s of stillness.
- **In-motion sensor-fusion calibration** (`_updateSensorFusionCalibration`) —
  refines bias *during motion* by cross-checking gyro rate against accel-derived
  angular velocity, weighted per-axis by which axis gravity is currently resolving
  onto (`strengthX/Y/Z`, `sensor-fusion.js:552-564`).

The yaw axis is exactly the axis the in-motion estimator can constrain **least**
(accel provides no yaw reference), so during real use its yaw-bias estimate is the
noisiest. Easing a slightly-wrong yaw bias in produces a slow, steady yaw creep.
Then the moment the user stops, **stillness calibration freezes the rate at
zero** — drift stops, but the *angle already accumulated* is now permanent. Net
effect: "it drifts left during use, then sits there rotated left at rest." Exactly
the report.

### 1.3 Likely SC-specific aggravators (to confirm in Phase 0)

- **Warm-up bias shift.** MEMS gyro bias is temperature-dependent. The one-shot
  calibration at connect captures a *cold* bias; after "a few seconds of actually
  using" the die warms and the true bias shifts, so the subtracted bias is stale
  until continuous calibration catches up — and the offset accumulated in the
  meantime persists.
- **Frame remap / scale.** The driver swaps Y↔Z with a sign flip on both gyro and
  accel (`steam-controller-driver.js:452-461`) and uses `gyroScale = 2000/32768`.
  A mapping/scale error would produce a *constant* error that recalibration can't
  cure — worth ruling out, though the "recurs after every recalibration, always
  left" pattern is more consistent with yaw bias than a static mapping bug.

### 1.4 The road not taken: the firmware quaternion

The SC driver deliberately **discards** the SteamlessController-documented
quaternion (bytes 31-38) because on 2026 firmware those bytes overlap the
timestamp, and instead feeds raw gyro+accel through our fusion
(`steam-controller-driver.js:29-33`, `421-451`). If the firmware actually exposes
an **absolute, internally-fused orientation** somewhere in the report, using it
would bypass the entire integrate-and-drift loop and is the definitive fix. Whether
that data exists on 2026 firmware is an open question this plan reopens (Phase 0).

### 1.5 Calibrate vs Recenter — the two-knob mental model

These two actions get confused constantly (they both "fix the gyro"), but they
address *different* errors and cost *different* amounts. The clean way to hold
it: a gyro is like a **clock that runs slightly fast or slow**.

- **Calibrate = fix the clock's *speed*.** A gyro measures rotation *rate*; the
  app adds those rates up over time to get an angle. If the gyro's "I'm holding
  still" reading isn't exactly zero (its *bias*), that error adds up and the
  model **slowly turns on its own** — drift. Calibrate re-measures the true zero
  so the drift *stops happening*. It needs the controller held still (~1.5 s), it
  resets orientation, and it throws away the old bias estimate. It fixes the
  **cause** (the ongoing error).

- **Recenter = set the clock's *hands* to the right time now.** It makes no
  attempt to fix the sensor. It just declares "whatever heading I'm pointing at
  this instant is *forward*." Instant, keeps the existing calibration, and keeps
  the gravity-true tilt. It fixes the **symptom** (the accumulated offset right
  now).

Why a user cares about both, as separate things:

| Symptom the user sees | Right tool | Why the other one is wrong |
|---|---|---|
| "It's sitting a bit to the left." | **Recenter** | Calibrate works too, but it's a 1.5 s freeze that also flattens tilt and re-rolls the dice on bias — overkill for a cosmetic offset. |
| "It won't stop slowly rotating on its own." | **Calibrate** | Recenter only straightens it for a second; the bad zero is still there, so it drifts off again immediately. |

The user's exact report — *"no matter how many times I re-center, it drifts back
and sits left"* — is the classic case of **reaching for the hands when the clock
is running fast**: recentering keeps fixing the offset while the underlying yaw
issue keeps re-creating it. The Phase 1 fix makes the app do the "set the hands"
step **automatically whenever the controller rests**, so the user rarely has to
touch either knob; the manual Recenter is there for an immediate snap mid-use,
and Calibrate remains the heavier "the sensor itself is off" reset.

---

## 2. Approaches

### A. Persistent recenter offset (make "recenter" actually stick) — **ship first**
Today recenter = "reset integration to identity." Instead, store a **reference
quaternion** at recenter and display `reference⁻¹ · orientation`. The current left
offset is zeroed *and stays zeroed* relative to that reference; subsequent drift is
measured from the user's chosen neutral rather than from device power-on. Small,
low-risk, and immediately removes the baked-in offset on demand.

### B. Return-to-neutral at rest (auto-recenter yaw) — **ship first**
When the controller is detected still (reuse the stillness detector already in
`_updateStillnessCalibration`) for N seconds, slowly slerp the **displayed yaw**
back toward the reference heading — a slow, half-life-based decay, *yaw only*
(pitch/roll stay physically accurate because gravity already anchors them). This is
what Valve's own gyro does ("gyro re-centers when you let go") and it directly kills
the "sits rotated to the left while resting" complaint without the user touching a
button. The gimbal widget already does a cosmetic version of this when input is
null (`gyro-gimbal.js:166-167`); we generalize it into the fusion output.

### C. Tighten SC auto-calibration (stop learning a wrong yaw bias)
For the SC profile, reduce trust in the in-motion yaw-bias estimate: lengthen its
ease-in, or gate `_updateSensorFusionCalibration` more strictly on the yaw axis
(the one with no accel reference). Optionally re-run the initial calibration once a
few seconds after connect to absorb warm-up bias.

### D. Extend the existing "Gravity Correction" dropdown into a yaw-drift control
The user already built the Off/Gentle/Strong scaffold (`app.js:198-201`,
`2096-2097`). Add a sibling **"Yaw Drift: Off / Decay at rest / Auto-recenter"**
control (or fold a "recenter at rest" toggle beside it) so the behavior in B is
user-selectable and discoverable right where they went looking for it.

### E. Firmware-quaternion fast-path (the definitive fix, *if the data exists*)
Re-investigate the SC report for an absolute fused quaternion (Phase 0). If present,
add a driver path that returns `parsed.orientation` (a quaternion) and an overlay
path that consumes it directly, bypassing `SensorFusion` integration for the SC.
No integration ⇒ no yaw drift.

---

## 3. Recommended sequencing

**Phase 0 — Reproduce & instrument (no behavior change).**
- Add temporary logging of `gyroFusion.bias` and per-axis displayed angle over time;
  confirm the drift is yaw-dominant and correlates with the bias estimate moving.
- Capture SC STATE reports (bytes 29-44) at rest and during motion; verify the
  yaw-only hypothesis and re-check bytes 31-38 / other offsets for a usable absolute
  quaternion (feeds Phase 3 go/no-go).
- Sanity-check the Y↔Z remap and `gyroScale` against a known ±90° physical yaw.

**Phase 1 — Ship the drift mitigation (low risk, high user impact).**
- Recenter offset quaternion (Approach A) in `SensorFusion` + overlay wiring.
- Return-to-neutral-at-rest for yaw (Approach B), gated on the stillness detector.
- Surface both via the settings area next to "Gravity Correction" (Approach D).
- Unit test: a pure yaw-axis bias must not move the *displayed* heading after
  auto-recenter converges; a real physical yaw must still register.

**Phase 2 — SC-specific calibration hardening (Approach C).**
- SC-tuned trust/ease-in for in-motion yaw-bias learning.
- Optional warm-up re-calibration a few seconds post-connect.

**Phase 3 — Firmware quaternion fast-path (Approach E), only if Phase 0 finds the data.**
- Driver returns absolute orientation; overlay bypasses fusion for the SC.

---

## 4. Files likely to change

| File | Change |
|---|---|
| `packages/core/src/sensor-fusion.js` | Recenter reference quaternion; yaw return-to-neutral at rest; SC calibration tuning knobs |
| `packages/core/src/drivers/steam-controller-driver.js` | Phase 0 quaternion investigation; Phase 3 `parsed.orientation` fast-path |
| `apps/overlay/src/js/app.js` | Recenter semantics; new yaw-drift setting; consume recentered/absolute orientation in `loop()` |
| `packages/visualizer/src/gyro-gimbal.js` | Align idle-slerp behavior with the new at-rest recenter (avoid double-decay) |
| `packages/core/test/` | Yaw-bias-vs-displayed-heading unit test; recenter-offset test |

---

## 5. Validation

- **Soak test:** use the SC for ~30 s, set it down, confirm displayed yaw returns to
  (and holds) neutral within the decay half-life; residual yaw ≈ 0° after 60 s.
- **Regression:** a deliberate physical yaw still reads correctly and is not eaten by
  the at-rest decay while the controller is genuinely moving.
- **Cross-device:** confirm DualSense/Switch Pro behavior is unchanged (yaw recenter
  is opt-in / gated so it can't regress controllers that weren't complaining).

## 6. Risks & mitigations

- **Auto-recenter fights slow intentional turns.** Mitigation: decay *only* when the
  stillness detector reports rest, with a slow half-life; never decay while moving.
- **Firmware quaternion may not exist or may itself drift.** Mitigation: Phase 3 is
  gated on Phase 0 evidence; fusion path remains the fallback.
- **Per-controller divergence.** Keep the yaw-drift behavior behind a setting so
  non-SC controllers are opt-in and can't regress.
