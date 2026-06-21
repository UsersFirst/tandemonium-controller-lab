// ============================================================
// PLAYSTATION DRIVER — DualSense (DS5) + DualShock 4 (DS4) protocol
// ============================================================
//
// Covers both Sony PlayStation HID protocols and any clones that spoof
// them (GameSir Super Nova / Cyclone 2 in DS4 mode, etc.). The two
// protocols share most of the input-report layout, differing mainly in
// IMU byte offsets — that branch is driven by the dictionary entry's
// `mode` field ('ds5' vs 'ds4'), not by a separate driver class.
//
// Registered in PROTOCOLS under the key 'dualsense' (preserved as-is so
// existing visualizer profile mappings keep working without forcing a
// controllerProfile override on every Sony PlayStation entry).
//
// Identity (vid:pid, name, capabilities, gamepad-id pattern) lives in
// devices.js — this class is purely the protocol implementation.

import { ControllerDriver } from './base-driver.js';

export class PlayStationDriver extends ControllerDriver {

  constructor(device, connectionType, entry = null) {
    super(device, connectionType, entry);
    this._rumbleStopTimer = null;
    this._reactivateTimer = null;
    this._reactivateStop = null;
  }

  async init() {
    // Over Bluetooth both Sony families default to a compatibility mode that
    // streams only the short report 0x01 (sticks/buttons, no IMU). Reading a
    // family-specific feature report flips them into full-report mode:
    //   DualSense (DS5) → feature 0x05, then streams report 0x31 (gyro+accel)
    //   DualShock 4 (DS4) → feature 0x02, then streams report 0x11 (gyro+accel)
    // Same trick Linux's hid-playstation / hid-sony drivers use. Without the
    // DS4-specific 0x02 read, a DualShock 4 over BT never leaves compatibility
    // mode and no gyro ever arrives (see the DS4-BT investigation).
    if (this.connectionType === 'bluetooth') {
      const featureId = this.entry?.mode === 'ds4' ? 0x02 : 0x05;
      const active = await this._activateFullReportMode(featureId);
      // A slow re-pair (controller sat on the charger a while) can take longer
      // than the inline window to start streaming. Don't leave gyro dead —
      // keep nudging the feature read in the background until the stream flips
      // (HidEntry's listener is already attached, so it picks up the IMU the
      // moment full reports arrive). Fire-and-forget: init must not block on it.
      if (!active) this._startBackgroundReactivation(featureId);
    }

    // IMU-offset probe: PlayStation-family controllers (real Sony DS4/DS5 +
    // GameSir clones in DS4 mode) share vid:pid families and differ only in
    // IMU byte offsets. Score candidate offsets by at-rest accel magnitude
    // (≈ 8192 raw = 1g at ±4g/16-bit) plus gyro-near-zero; the winner sets
    // this._detectedImuOffset, which parseReport prefers over the mode
    // default. Runs over USB (report 0x01) AND Bluetooth (DS4 0x11 / DS5
    // 0x31) — so after the feature-report activation above it auto-corrects
    // the BT offset too.
    //
    // Family mapping by USB-equivalent offset (= gyroOffset − baseOffset):
    //   12 → 'gamesir-ds4'   13 → 'sony-ds4'   15 → 'sony-ds5'
    //
    // Best-effort: if no reports arrive within the timeout, parseReport falls
    // back to the mode/transport default offset.
    const probe = await this._probeImuOffset();
    if (probe) {
      const chosen = this._chooseImuOffset(probe);
      this._detectedImuOffset = chosen;
      this._detectedImuFamily = PlayStationDriver._imuFamilyFor(chosen.gyroOffset, chosen.baseOffset);
      const defaultOffset = this._defaultGyroOffset();
      console.log(`PlayStation IMU offset=${chosen.gyroOffset} (default=${defaultOffset}, probe-best=${probe.gyroOffset}, accelMag≈${chosen.meanAccelMag.toFixed(0)}, gyroAbs≈${chosen.meanGyroAbs?.toFixed(0)}) → family='${this._detectedImuFamily}' (${this.entry?.name || 'unknown'})`);
    }
  }

  /**
   * Pick the IMU gyro offset from a probe result.
   *
   * Prefer the DOCUMENTED default offset when it looks right: at-rest accel
   * magnitude ≈ 1g AND an at-rest gyro that ISN'T pinned near gravity. That
   * second guard is the new part (issue #83): an offset that is shifted by a
   * byte — e.g. macOS/IOKit including the leading report-ID byte in the BT
   * `0x31` DataView — reads an accelerometer axis *as a gyro axis*, so its
   * "gyro" sits around gravity (~8192 raw) at rest. Fusion then integrates
   * gravity as rotation and the model swings hard side to side (the reported
   * symptom). The old check only looked at accel magnitude, so such a shifted
   * default could still score "plausible" and win.
   *
   * Only when the default is implausible OR is reading accel-as-gyro do we look
   * for a cleaner candidate (≈1g accel AND near-zero gyro). The high-gyro gate
   * means a small real at-rest bias — or a pad that's merely being handled
   * during the probe — never trips the override, so the existing off-by-2
   * still-pad protection is preserved.
   */
  _chooseImuOffset(probe) {
    const ACCEL_MIN = 6500, ACCEL_MAX = 11500; // ~1g (8192 raw) window
    const ACCEL_AS_GYRO = 4000; // at-rest |gyro| this large ⇒ reading accel as gyro
    const CLEAN_GYRO = 2000;    // at-rest |gyro| below this ⇒ a trustworthy axis
    const accelOK = (s) => s && s.meanAccelMag > ACCEL_MIN && s.meanAccelMag < ACCEL_MAX;

    const defaultOffset = this._defaultGyroOffset();
    const def = probe.scores?.find((s) => s.gyroOffset === defaultOffset);

    // Default is trustworthy: right magnitude AND not bleeding gravity into gyro.
    if (accelOK(def) && def.meanGyroAbs < ACCEL_AS_GYRO) return def;

    // Default is implausible or accel-bleeding-into-gyro (the macOS BT
    // report-ID-byte shift). Recover the cleanest candidate that has BOTH ≈1g
    // accel and near-zero gyro.
    const clean = (probe.scores || [])
      .filter((s) => accelOK(s) && s.meanGyroAbs < CLEAN_GYRO)
      .sort((a, b) => a.score - b.score)[0];
    if (clean) return clean;

    // Nothing clean (e.g. the pad was in motion the whole probe) — keep the
    // documented default if it at least read ≈1g, else the raw probe best.
    return accelOK(def) ? def : probe;
  }

  /**
   * Bring a Bluetooth DualShock 4 / DualSense out of compatibility mode
   * (short report 0x01, no IMU) into full-report mode (DS4 0x11 / DS5 0x31,
   * with gyro+accel) by reading the family-specific feature report — then
   * CONFIRM the full report stream actually started, retrying if not.
   *
   * A single read at connect time is enough on a settled link (controller
   * paired before the app launched — the cold-plug case that always worked).
   * But on a HOT-PLUG / reconnect the BT link is often still negotiating when
   * init() runs: the feature read returns without error, yet the controller
   * keeps streaming 0x01 and no gyro ever arrives ("thinks it has gyro but
   * the data isn't used"). So re-issue the read and wait for the first full
   * report, a few times, until the stream flips. On the settled case the
   * first full report lands almost immediately, so this adds negligible cost.
   *
   * @returns {Promise<boolean>} whether the full report stream was confirmed
   */
  async _activateFullReportMode(featureId, { attempts = 5, perAttemptMs = 450 } = {}) {
    const fullId = this._fullReportId();
    const hex = (n) => '0x' + n.toString(16).padStart(2, '0');
    // A device without receiveFeatureReport is a test/unsupported handle —
    // don't hammer it; make a single pass and rely on whatever it streams.
    const canRead = typeof this.device.receiveFeatureReport === 'function';
    const maxAttempts = canRead ? attempts : 1;

    for (let i = 1; i <= maxAttempts; i++) {
      if (canRead) {
        try {
          await this.device.receiveFeatureReport(featureId);
        } catch (err) {
          console.warn(`PlayStation BT: feature ${hex(featureId)} query failed (attempt ${i}/${maxAttempts}):`, err.message);
        }
      }
      const streaming = await this._waitForReport(fullId, perAttemptMs);
      if (streaming) {
        console.log(`PlayStation BT: full report mode active (${hex(fullId)}) after ${i} attempt(s)`);
        return true;
      }
      if (i < maxAttempts) {
        console.log(`PlayStation BT: still in compatibility mode after feature ${hex(featureId)} (attempt ${i}/${maxAttempts}); retrying`);
      }
    }
    console.warn(`PlayStation BT: full report mode (${hex(fullId)}) did not start after ${maxAttempts} attempt(s) — gyro unavailable until reconnect`);
    return false;
  }

  /** The IMU-bearing input report id for this transport/mode. */
  _fullReportId() {
    if (this.connectionType !== 'bluetooth') return 0x01;
    return this.entry?.mode === 'ds4' ? 0x11 : 0x31;
  }

  /** Resolve true if an inputreport with `reportId` arrives within `ms`. */
  _waitForReport(reportId, ms) {
    return new Promise((resolve) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.device.removeEventListener('inputreport', onReport);
      };
      const onReport = (event) => {
        if (event.reportId !== reportId) return;
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, ms);
      this.device.addEventListener('inputreport', onReport);
    });
  }

  /**
   * Keep re-issuing the full-report feature read in the background until the
   * stream actually flips (or we give up). For the slow-re-pair case where the
   * inline _activateFullReportMode window expires before a controller that's
   * been on the charger finishes negotiating its BT link. A persistent
   * listener watches for the first full report and stops the loop; HidEntry's
   * own listener is what feeds the IMU once it arrives, so no offset re-probe
   * is needed here (parseReport falls back to the documented default offset).
   *
   * Fire-and-forget from init(); returns a Promise so tests can await it.
   * Cleared by destroy(). Idempotent — a second call while one is running is a
   * no-op.
   *
   * @returns {Promise<boolean>} true if the stream started, false if it gave up
   */
  _startBackgroundReactivation(featureId, { intervalMs = 1000, maxMs = 12000 } = {}) {
    if (this._reactivateTimer) return Promise.resolve(false);
    const fullId = this._fullReportId();
    const hex = (n) => '0x' + n.toString(16).padStart(2, '0');
    return new Promise((resolve) => {
      let elapsed = 0;
      const finish = (ok, why) => {
        if (this._reactivateTimer) { clearInterval(this._reactivateTimer); this._reactivateTimer = null; }
        this.device.removeEventListener('inputreport', onReport);
        this._reactivateStop = null;
        if (ok) console.log(`PlayStation BT: full report mode active (${hex(fullId)}) via background re-activation`);
        else console.warn(`PlayStation BT: background re-activation gave up (${why}) — gyro unavailable until reconnect`);
        resolve(ok);
      };
      const onReport = (event) => { if (event.reportId === fullId) finish(true); };
      this._reactivateStop = () => finish(false, 'driver destroyed');
      this.device.addEventListener('inputreport', onReport);
      console.warn(`PlayStation BT: full report stream not up yet — re-activating in the background (every ${intervalMs}ms, up to ${maxMs}ms)`);
      this._reactivateTimer = setInterval(() => {
        elapsed += intervalMs;
        if (elapsed > maxMs) { finish(false, `no full report after ${maxMs}ms`); return; }
        if (typeof this.device.receiveFeatureReport === 'function') {
          this.device.receiveFeatureReport(featureId).catch(() => {});
        }
      }, intervalMs);
    });
  }

  // Documented gyro start offset per transport/mode. The IMU probe defers to
  // this when it scores plausibly (~1g); see init() for why.
  _defaultGyroOffset() {
    const isDs4 = this.entry?.mode === 'ds4';
    if (this.connectionType === 'usb') return isDs4 ? 12 : 15;
    return isDs4 ? 14 : 16; // Bluetooth: DS4 0x11 (+2) / DS5 0x31 (+1)
  }

  /**
   * One-shot IMU layout probe. Listens to inputreport for up to `timeoutMs`,
   * collecting up to 10 reports, then scores each candidate gyro offset by
   * how close the at-rest accel magnitude is to 8192 (1g) with gyro near zero.
   * Returns the winner (plus the full `scores` table), or null if no usable
   * reports arrived.
   *
   * Runs over USB (`0x01`) AND Bluetooth (DS5 `0x31` / DS4 `0x11`) — see
   * `_probeConfig()` for the per-transport report id, base offset (BT prepends
   * a counter byte), and candidate gyro offsets. `init()` → `_chooseImuOffset()`
   * turns the scores into the offset parseReport uses.
   *
   * @param {number} [timeoutMs=600]
   * @returns {Promise<{gyroOffset:number, accelOffset:number, baseOffset:number, meanAccelMag:number, meanGyroAbs:number, score:number, scores:Array}|null>}
   */
  // Per-transport probe configuration: which input report carries the IMU,
  // the byte its payload starts at (BT prepends counter/header bytes — DS5
  // 0x31 is +1, DS4 0x11 is +2 vs USB), and the candidate gyro offsets to
  // score.
  _probeConfig() {
    if (this.connectionType === 'usb') {
      return { reportId: 0x01, baseOffset: 0, candidates: [12, 13, 15] };
    }
    if (this.entry?.mode === 'ds4') {
      return { reportId: 0x11, baseOffset: 2, candidates: [14, 15, 13, 16] };
    }
    return { reportId: 0x31, baseOffset: 1, candidates: [16, 15, 17] };
  }

  async _probeImuOffset(timeoutMs = 600) {
    const { reportId: wantId, baseOffset, candidates } = this._probeConfig();
    const reports = [];

    return new Promise((resolve) => {
      const onReport = (event) => {
        if (event.reportId !== wantId) return;
        reports.push(event.data);
        if (reports.length >= 10) finish();
      };

      const finish = () => {
        clearTimeout(timer);
        this.device.removeEventListener('inputreport', onReport);

        if (reports.length === 0) { resolve(null); return; }
        const r = ControllerDriver.readSigned16;
        const scores = [];
        for (const gyroOffset of candidates) {
          const accelOffset = gyroOffset + 6;
          let sumMag = 0, sumGyroAbs = 0, n = 0;
          for (const data of reports) {
            if (data.byteLength < accelOffset + 6) continue;
            sumMag += Math.hypot(r(data, accelOffset), r(data, accelOffset + 2), r(data, accelOffset + 4));
            sumGyroAbs += Math.abs(r(data, gyroOffset)) + Math.abs(r(data, gyroOffset + 2)) + Math.abs(r(data, gyroOffset + 4));
            n++;
          }
          if (n === 0) continue;
          const meanAccelMag = sumMag / n;
          const meanGyroAbs = sumGyroAbs / n;
          // Best = at-rest accel closest to 1g (8192 raw) with gyro near zero.
          scores.push({ gyroOffset, accelOffset, baseOffset, meanAccelMag, meanGyroAbs, score: Math.abs(meanAccelMag - 8192) + meanGyroAbs });
        }
        if (scores.length === 0) { resolve(null); return; }
        scores.sort((a, b) => a.score - b.score);
        // Diagnostic: full candidate table (report id + length + per-offset).
        console.log(`PlayStation IMU probe scan (report 0x${wantId.toString(16)}, ${reports[0].byteLength}B):`,
          scores.map(s => `g=${s.gyroOffset} accel≈${s.meanAccelMag.toFixed(0)} gyro≈${s.meanGyroAbs.toFixed(0)}`).join('  |  '));
        // Raw-bytes preview of the first report — the capture needed to confirm
        // a platform offset shift (issue #83: macOS BT report-ID-byte). Logs the
        // leading header/IMU window so USB-vs-macOS-BT byteLength + layout can be
        // diffed straight from the console.
        const d0 = reports[0];
        const hexPreview = Array.from(
          new Uint8Array(d0.buffer, d0.byteOffset, Math.min(d0.byteLength, 32))
        ).map((b) => b.toString(16).padStart(2, '0')).join(' ');
        console.log(`PlayStation IMU probe bytes (${this.connectionType} 0x${wantId.toString(16)}, len=${d0.byteLength}, baseOffset=${baseOffset}): ${hexPreview}…`);
        resolve({ ...scores[0], scores });
      };

      this.device.addEventListener('inputreport', onReport);
      const timer = setTimeout(finish, timeoutMs);
    });
  }

  destroy() {
    if (this._rumbleStopTimer) {
      clearTimeout(this._rumbleStopTimer);
      this._rumbleStopTimer = null;
    }
    // Stop any in-flight background re-activation (e.g. device disconnected
    // mid-loop) so it isn't left polling a dead handle.
    if (this._reactivateStop) this._reactivateStop();
  }

  parseReport(reportId, data) {
    // USB 0x01 and BT 0x31 share most of the input-report layout, shifted by
    // one byte (BT prefixes with a sequence/counter byte). baseOffset handles
    // the shift. The IMU and touchpad bytes also shift based on protocol
    // mode: DS4 packs IMU 3 bytes earlier than DualSense (DS5).
    //
    // DS4 offsets (mode === 'ds4') confirmed by Test Report captures of BOTH a
    // GameSir Super Nova (USB) and a genuine Sony DualShock 4 v1 (Bluetooth):
    // gyro at USB offset 12 / accel 18 (BT: 14 / 20, +2 for the BT header),
    // accel ≈8192 raw (1g) with gyro bias ≈0 at rest. So a real Sony DS4 uses
    // the SAME byte-12 layout as the clones — NOT the byte-13 "Linux hid-sony"
    // layout once assumed. Axis mapping is identical too (pitch→gyroX,
    // roll→gyroZ, yaw→gyroY). See test/fixtures/sony-dualshock4-v1-bt_*.json.
    let baseOffset, gyroOffset, touchOffset;
    const isDs4 = this.entry?.mode === 'ds4';
    // Runtime IMU probe (set during init) is the source of truth when
    // available; the mode/transport default is the fallback when the probe
    // couldn't collect any reports.
    const probeOffset = this._detectedImuOffset?.gyroOffset;

    if (this.connectionType === 'usb' && reportId === 0x01) {
      baseOffset = 0;
      gyroOffset = probeOffset ?? (isDs4 ? 12 : 15);
      touchOffset = isDs4 ? 35 : 32;
    } else if (this.connectionType === 'bluetooth' && reportId === 0x31) {
      // DualSense (DS5) Bluetooth full report — 1-byte counter prefix.
      baseOffset = 1;
      gyroOffset = probeOffset ?? 16;
      touchOffset = 33;
    } else if (this.connectionType === 'bluetooth' && reportId === 0x11) {
      // DualShock 4 (DS4) Bluetooth full report (enabled via feature 0x02).
      // A 2-byte BT header precedes the otherwise-USB-identical layout, so
      // every offset is USB + 2.
      baseOffset = 2;
      gyroOffset = probeOffset ?? 14;   // USB 12 + 2
      touchOffset = 37;                 // USB 35 + 2
    } else {
      return null;
    }

    const r = ControllerDriver.readSigned16;

    // ── Sticks (4 bytes, unsigned 0-255, center ~128) ──
    const rawLX = data.getUint8(baseOffset + 0);
    const rawLY = data.getUint8(baseOffset + 1);
    const rawRX = data.getUint8(baseOffset + 2);
    const rawRY = data.getUint8(baseOffset + 3);
    const sticks = {
      lx: (rawLX - 128) / 128,
      ly: (rawLY - 128) / 128,
      rx: (rawRX - 128) / 128,
      ry: (rawRY - 128) / 128,
    };

    // ── Triggers (analog 0-255 → 0-1) ──
    const triggers = {
      l2: data.getUint8(baseOffset + 4) / 255,
      r2: data.getUint8(baseOffset + 5) / 255,
    };

    // ── Buttons + dpad ──
    // byte +7: dpad nibble (0-7 = dir, 8 = neutral) | face buttons
    // byte +8: shoulders / options / stick clicks
    // byte +9: PS / touchpad click / mute
    const faceByte = data.getUint8(baseOffset + 7);
    const optByte  = data.getUint8(baseOffset + 8);
    const psByte   = data.getUint8(baseOffset + 9);

    const dpadDir = faceByte & 0x0F;
    const buttons = {
      square:   !!(faceByte & 0x10),
      cross:    !!(faceByte & 0x20),
      circle:   !!(faceByte & 0x40),
      triangle: !!(faceByte & 0x80),
      l1:       !!(optByte & 0x01),
      r1:       !!(optByte & 0x02),
      l2:       !!(optByte & 0x04),
      r2:       !!(optByte & 0x08),
      create:   !!(optByte & 0x10),
      options:  !!(optByte & 0x20),
      l3:       !!(optByte & 0x40),
      r3:       !!(optByte & 0x80),
      ps:       !!(psByte  & 0x01),
      mic:      !!(psByte  & 0x04),
      dpadUp:    dpadDir === 7 || dpadDir === 0 || dpadDir === 1,
      dpadRight: dpadDir === 1 || dpadDir === 2 || dpadDir === 3,
      dpadDown:  dpadDir === 3 || dpadDir === 4 || dpadDir === 5,
      dpadLeft:  dpadDir === 5 || dpadDir === 6 || dpadDir === 7,
    };

    // ── Gyro (6 bytes) + Accel (6 bytes immediately after) ──
    const gyro = {
      x: r(data, gyroOffset),
      y: r(data, gyroOffset + 2),
      z: r(data, gyroOffset + 4)
    };
    const accel = {
      x: r(data, gyroOffset + 6),
      y: r(data, gyroOffset + 8),
      z: r(data, gyroOffset + 10)
    };

    // ── Touchpad — 2 touch points, 4 bytes each ──
    const touchpad = [
      PlayStationDriver._parseTouchPoint(data, touchOffset),
      PlayStationDriver._parseTouchPoint(data, touchOffset + 4)
    ];

    // Touchpad click: bit 1 of the PS byte
    const touchpadButton = !!(psByte & 0x02);

    if (isDs4) {
      // DS4-family (real Sony DS4 + GameSir clones): WebHID supplies the IMU
      // only. Buttons/sticks/triggers come from the Gamepad API (a DS4
      // enumerates as a standard gamepad on every OS). We deliberately omit
      // them here — parsing at the DualSense offsets is wrong for a real DS4,
      // and a non-empty button set would make ControllerManager prefer this
      // mis-parsed synthetic over the correct Gamepad-API pad. Touchpad is
      // omitted too until a real-DS4 button/touchpad layout is captured and
      // validated.
      return {
        gyro,
        accel,
        gyroScale: 2000.0 / 32768.0,   // ±2000 dps, 16-bit
        accelScale: 1.0 / 8192.0        // ±4g, 16-bit (gravity ~8192)
      };
    }
    return {
      sticks,
      triggers,
      buttons,
      gyro,
      accel,
      touchpad,
      touchpadButton,
      gyroScale: 2000.0 / 32768.0,   // ±2000 dps, 16-bit
      accelScale: 1.0 / 8192.0        // ±2g, 16-bit (gravity ~8192)
    };
  }

  // ── Rumble + LED + lightbar output (DualSense only) ──────────
  //
  // Chromium's Gamepad API vibrationActuator.playEffect() is flaky on macOS
  // for DualSense. The generic _sendOutputReport() path below writes the
  // HID output report directly using the same open WebHID handle we already
  // have for gyro reads — works reliably across USB and BT, and lets us
  // combine rumble + player-LED + lightbar-color into a single packet.
  // See issue #193 (rumble) and #222 (lights).
  //
  // Player LED bitmask layout (byte 43 USB / byte 44 BT, 5 LEDs):
  //   bit 0 = leftmost, bit 4 = rightmost
  //   Symmetric "dot count" patterns we use:
  //     P1: 0b00100 (0x04) — single center dot
  //     P2: 0b01010 (0x0A) — two dots flanking center
  //     P3: 0b10101 (0x15) — three dots (odd positions)
  //     P4: 0b11011 (0x1B) — four dots (all but center)
  //
  // Lightbar RGB: three bytes, 0..255 each.

  /** Symmetric dot-count LED patterns for up to 4 players. */
  static PLAYER_LED_PATTERNS = {
    1: 0b00100,
    2: 0b01010,
    3: 0b10101,
    4: 0b11011,
  };

  /**
   * Rumble both motors, auto-stop after durationMs.
   * @param {number} strong — strong (left) rumble 0..1
   * @param {number} weak   — weak  (right) rumble 0..1
   * @param {number} durationMs
   */
  async setRumble(strong, weak, durationMs) {
    if (!this._supportsOutputReports()) return;
    const s = Math.max(0, Math.min(1, strong));
    const w = Math.max(0, Math.min(1, weak));
    const strongByte = Math.round(s * 255);
    const weakByte = Math.round(w * 255);

    try {
      await this._sendOutputReport({ rumble: { weak: weakByte, strong: strongByte } });
    } catch (err) {
      console.warn('DualSense setRumble failed:', err.message);
      return;
    }

    if (this._rumbleStopTimer) clearTimeout(this._rumbleStopTimer);
    this._rumbleStopTimer = setTimeout(() => {
      this._rumbleStopTimer = null;
      this._sendOutputReport({ rumble: { weak: 0, strong: 0 } }).catch(() => {});
    }, Math.max(10, durationMs));
  }

  /**
   * Set the 5-LED player indicator row under the touchpad.
   * @param {number} bitmask — 5-bit mask (bit 0 = leftmost, bit 4 = rightmost)
   */
  async setPlayerLEDs(bitmask) {
    if (!this._supportsOutputReports()) return;
    try {
      await this._sendOutputReport({ playerLEDs: bitmask & 0x1F });
    } catch (err) {
      console.warn('DualSense setPlayerLEDs failed:', err.message);
    }
  }

  /**
   * Set the lightbar color. Pass (0,0,0) to turn it off.
   */
  async setLightbar(r, g, b) {
    if (!this._supportsOutputReports()) return;
    try {
      await this._sendOutputReport({
        lightbar: {
          r: Math.max(0, Math.min(255, r | 0)),
          g: Math.max(0, Math.min(255, g | 0)),
          b: Math.max(0, Math.min(255, b | 0)),
        },
      });
    } catch (err) {
      console.warn('DualSense setLightbar failed:', err.message);
    }
  }

  /**
   * Combined player feedback — LEDs + lightbar in a single output report.
   * Preferred by ControllerManager on slot claim/release because sequential
   * sendReport calls for LED then lightbar can interleave oddly over BT;
   * a single packet with both valid_flags set is more reliable.
   */
  async setPlayerFeedback({ playerLEDs, lightbar } = {}) {
    if (!this._supportsOutputReports()) return;
    try {
      const payload = {};
      if (playerLEDs != null) payload.playerLEDs = playerLEDs & 0x1F;
      if (lightbar) {
        payload.lightbar = {
          r: Math.max(0, Math.min(255, lightbar.r | 0)),
          g: Math.max(0, Math.min(255, lightbar.g | 0)),
          b: Math.max(0, Math.min(255, lightbar.b | 0)),
        };
      }
      await this._sendOutputReport(payload);
    } catch (err) {
      console.warn('DualSense setPlayerFeedback failed:', err.message);
    }
  }

  _supportsOutputReports() {
    if (!this.device || !this.device.opened) return false;
    // Only DualSense (not DualShock 4) uses the 0x02 / 0x31 output formats
    // implemented here.
    const pid = this.device.productId;
    return pid === 0x0ce6 || pid === 0x0df2;
  }

  /**
   * Generic output-report writer. Fields:
   *   rumble:     { weak, strong }  0..255 each — sets valid_flag0 bits 0+1
   *   lightbar:   { r, g, b }                   — sets valid_flag1 bit 2
   *   playerLEDs: bitmask 0..0x1F               — sets valid_flag1 bit 4
   *
   * Any field omitted leaves its valid-flag bit clear, so the controller
   * keeps its current value for that feature.
   *
   * Byte offsets (payload after the report ID is stripped by WebHID):
   *   USB report 0x02 (47-byte payload):
   *     [0]      valid_flag0
   *     [1]      valid_flag1
   *     [2]      motor_right (weak)
   *     [3]      motor_left  (strong)
   *     [42]     led_brightness (0 = high)
   *     [43]     player_leds bitmask
   *     [44..46] lightbar R, G, B
   *
   *   BT report 0x31 (77-byte payload, +1 for the data tag):
   *     [0]      0x02 (DualSense BT data tag)
   *     [1]      valid_flag0
   *     [2]      valid_flag1
   *     [3]      motor_right
   *     [4]      motor_left
   *     [43]     led_brightness
   *     [44]     player_leds
   *     [45..47] lightbar R, G, B
   *     [73..76] CRC-32 little-endian over [0xA2, 0x31, buf[0..72]]
   *
   * Flag bits (match Linux hid-playstation + pydualsense conventions):
   *   valid_flag0 bit 0 (0x01): compatible vibration (rumble emulation)
   *   valid_flag0 bit 1 (0x02): haptics select
   *   valid_flag1 bit 2 (0x04): lightbar control enable
   *   valid_flag1 bit 4 (0x10): player indicator control enable
   */
  async _sendOutputReport({ rumble, lightbar, playerLEDs } = {}) {
    if (this.connectionType === 'bluetooth') {
      await this._sendOutputReportBT({ rumble, lightbar, playerLEDs });
    } else {
      await this._sendOutputReportUSB({ rumble, lightbar, playerLEDs });
    }
  }

  // Byte offsets referenced from pydualsense wire layout (report_id at [0]).
  // WebHID's sendReport strips the report_id so our payload indices are
  // wire_index - 1. USB output report 0x02 has no leading data-tag byte,
  // so USB offsets are another -1 relative to BT (which DOES prepend a
  // 0x02 data tag at [0]).
  //
  //          wire  USB  BT
  //   flag0   [2]   [0]  [1]
  //   flag1   [3]   [1]  [2]
  //   motor_right/weak  [4]  [2]  [3]
  //   motor_left/strong [5]  [3]  [4]
  //   lightbar_setup  [44] [42] [43]
  //   led_brightness  [45] [43] [44]
  //   player_leds     [46] [44] [45]
  //   lightbar_red    [47] [45] [46]
  //   lightbar_green  [48] [46] [47]
  //   lightbar_blue   [49] [47] [48]

  // Empirically determined byte offsets via setLightbar probe tests
  // (see #222 phase 4 debugging thread). Two rounds of tests pinned R/G/B
  // to buf[45]/[46]/[47] on BT (buf[44]/[45]/[46] on USB — one lower
  // because BT payload has a leading 0x02 data tag). Struct layout
  // upstream of the RGB bytes: led_brightness, player_leds.
  //
  //          BT    USB
  //   led_brightness  [43]  [42]
  //   player_leds     [44]  [43]
  //   lightbar_red    [45]  [44]
  //   lightbar_green  [46]  [45]
  //   lightbar_blue   [47]  [46]

  async _sendOutputReportUSB({ rumble, lightbar, playerLEDs }) {
    const buf = new Uint8Array(47);
    let flag0 = 0, flag1 = 0;
    if (rumble) {
      flag0 |= 0x03;          // rumble emu + haptics select
      buf[2] = rumble.weak & 0xFF;
      buf[3] = rumble.strong & 0xFF;
    }
    if (playerLEDs != null) {
      flag1 |= 0x10;          // player indicator enable
      buf[42] = 0x00;         // led_brightness: high
      buf[43] = playerLEDs & 0x1F;
    }
    if (lightbar) {
      flag1 |= 0x04;          // lightbar control enable
      buf[44] = lightbar.r;
      buf[45] = lightbar.g;
      buf[46] = lightbar.b;
    }
    buf[0] = flag0;
    buf[1] = flag1;
    await this.device.sendReport(0x02, buf);
  }

  async _sendOutputReportBT({ rumble, lightbar, playerLEDs }) {
    const PAYLOAD_LEN = 77;
    const buf = new Uint8Array(PAYLOAD_LEN);
    buf[0] = 0x02;             // BT data tag
    let flag0 = 0, flag1 = 0;
    if (rumble) {
      flag0 |= 0x03;
      buf[3] = rumble.weak & 0xFF;
      buf[4] = rumble.strong & 0xFF;
    }
    if (playerLEDs != null) {
      flag1 |= 0x10;
      buf[43] = 0x00;          // led_brightness: high
      buf[44] = playerLEDs & 0x1F;
    }
    if (lightbar) {
      flag1 |= 0x04;
      buf[45] = lightbar.r;
      buf[46] = lightbar.g;
      buf[47] = lightbar.b;
    }
    buf[1] = flag0;
    buf[2] = flag1;

    // CRC input: seed (0xA2) + report ID (0x31) + buf[0..72] = 75 bytes
    const crcInput = new Uint8Array(1 + 1 + (PAYLOAD_LEN - 4));
    crcInput[0] = 0xA2;
    crcInput[1] = 0x31;
    crcInput.set(buf.subarray(0, PAYLOAD_LEN - 4), 2);
    const crc = PlayStationDriver._crc32(crcInput);
    buf[PAYLOAD_LEN - 4] = crc & 0xFF;
    buf[PAYLOAD_LEN - 3] = (crc >>> 8) & 0xFF;
    buf[PAYLOAD_LEN - 2] = (crc >>> 16) & 0xFF;
    buf[PAYLOAD_LEN - 1] = (crc >>> 24) & 0xFF;

    await this.device.sendReport(0x31, buf);
  }

  /**
   * Standard reflected CRC-32 (same as zlib / PKZIP / Ethernet).
   * Polynomial 0xEDB88320 (reversed form of 0x04C11DB7), initial value
   * 0xFFFFFFFF, final XOR 0xFFFFFFFF, input and output reflected. This is
   * what DualSense BT output reports expect.
   */
  static _crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let b = 0; b < 8; b++) {
        crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  static detectConnectionType(device) {
    // Bluetooth is identified by the family-specific full-report ID:
    //   DualSense BT → report 0x31   DualShock 4 BT → report 0x11
    // Over USB the input report is 0x01; crucially DS4 USB lists 0x11 only as
    // a *feature* report, so we must check INPUT reports for 0x11 (not feature
    // reports) or a USB DS4 would misdetect as Bluetooth. The legacy
    // output-report 0x31 check is kept for DualSense.
    for (const col of device.collections) {
      for (const report of (col.outputReports || [])) {
        if (report.reportId === 0x31) return 'bluetooth';
      }
      for (const report of (col.inputReports || [])) {
        if (report.reportId === 0x31 || report.reportId === 0x11) return 'bluetooth';
      }
    }
    return 'usb';
  }

  // USB-equivalent gyro offset → IMU family. baseOffset removes the BT
  // counter/header shift (USB 0, DS5 BT 1, DS4 BT 2) so one map covers all
  // transports.
  static _imuFamilyFor(gyroOffset, baseOffset = 0) {
    const usbEquiv = gyroOffset - baseOffset;
    return (
      usbEquiv === 12 ? 'gamesir-ds4' :
      usbEquiv === 13 ? 'sony-ds4' :
      usbEquiv === 15 ? 'sony-ds5' :
      null
    );
  }

  static _parseTouchPoint(data, offset) {
    if (offset + 4 > data.byteLength) return { active: false, id: 0, x: 0, y: 0 };
    const b0 = data.getUint8(offset);
    const b1 = data.getUint8(offset + 1);
    const b2 = data.getUint8(offset + 2);
    const b3 = data.getUint8(offset + 3);
    return {
      active: !(b0 & 0x80),
      id: b0 & 0x7F,
      x: b1 | ((b2 & 0x0F) << 8),
      y: ((b2 & 0xF0) >> 4) | (b3 << 4)
    };
  }
}
