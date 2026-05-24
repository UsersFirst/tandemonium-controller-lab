// ============================================================
// STEAM CONTROLLER 2026 DRIVER (Ibex / Proteus)
// ============================================================
//
// Parses the Valve Steam Input HID format for the 2026 Steam Controller.
// Two physical paths, one protocol:
//
//   0x28DE:0x1302 — controller body plugged via USB-C. Single HID
//                   interface. STATE reports start flowing immediately
//                   at ~249 Hz on connect, no handshake.
//
//   0x28DE:0x1304 — wireless Puck dongle. Five HID interfaces; only
//                   one emits STATE reports, and only after the
//                   "lizard-mode disable" feature reports are sent +
//                   re-sent on an 800ms heartbeat. Without that, the
//                   Puck stays in keyboard/mouse fallback mode and
//                   iface[3] is silent. Manager pools all five
//                   HIDDevice instances; the driver init below sends
//                   the feature reports on every instance (most will
//                   error — that's expected and swallowed). The one
//                   instance whose interface accepts feature reports
//                   activates the mode for the entire Puck.
//
// Byte layout sourced from ddeverill/SteamlessController v1.1 and
// libsdl-org/SDL's hidapi_steam.c (May 2026 commits). See issue #8 for
// the prior-art survey and the per-byte verification against our own
// captures.
//
// IMU is a quaternion (4× int16 at WebHID offsets 31-38). Phase 1 omits
// it — parsed.gyro / parsed.accel return null so the existing fusion
// pipeline isn't fed bogus integrate-from-zero data. Wiring quaternion
// orientation through the visualizer (bypassing fusion's integrate-and-
// correct loop) is follow-up work.

import { ControllerDriver } from './base-driver.js';

// 53-byte STATE report on the 2026 device. SteamlessController docs
// list other shorter report shapes (status, secondary), so gating on
// length filters those out without us having to enumerate ids.
const STATE_REPORT_LEN = 53;

const PUCK_PID = 0x1304;
const LIZARD_HEARTBEAT_MS = 800;

const CMD_CLEAR_DIGITAL_MAPPINGS = 0x81;
const CMD_SET_SETTINGS = 0x87;
const SETTING_RIGHT_TRACKPAD_MODE = 0x07;
const SETTING_LEFT_TRACKPAD_MODE = 0x08;
const TRACKPAD_MODE_NONE = 0x00;

const FEATURE_REPORT_ID_PRIMARY = 0x01;
const FEATURE_REPORT_ID_FALLBACK = 0x02;

export class SteamControllerDriver extends ControllerDriver {

  // Phase 1 returns null gyro/accel (the IMU is a quaternion at offsets
  // 31-38 and doesn't fit the raw-rate fusion pipeline that PlayStation /
  // Switch drivers feed). App-layer calibration UX should skip itself for
  // this driver — checks this flag and avoids the "Calibrating…" hint
  // that would otherwise hang forever waiting for samples that never come.
  static emitsRawGyro = false;

  // Valve's HID interfaces are vendor-defined (usage page 0xFF0x), not
  // the standard gamepad usage. Filter on vid:pid only or the picker
  // never lists the Puck/Ibex.
  static makeHidFilter(vendorId, productId) {
    return { vendorId, productId };
  }

  constructor(device, connectionType, entry = null) {
    super(device, connectionType, entry);
    this._lizardTimer = null;
    this._loggedReportIds = new Set();
    this._featureReportId = FEATURE_REPORT_ID_PRIMARY;
  }

  async init() {
    if (this.device.productId !== PUCK_PID) return;

    // Puck only: kick the firmware out of keyboard/mouse fallback by
    // sending CLEAR_DIGITAL_MAPPINGS + SET_SETTINGS, then re-send
    // CLEAR every 800ms (without the heartbeat the firmware reverts).
    const sent = await this._sendLizardModeDisable();
    if (sent) {
      this._lizardTimer = setInterval(() => {
        this._sendFeatureReport(new Uint8Array([CMD_CLEAR_DIGITAL_MAPPINGS])).catch(() => {});
      }, LIZARD_HEARTBEAT_MS);
    }
  }

  destroy() {
    if (this._lizardTimer) {
      clearInterval(this._lizardTimer);
      this._lizardTimer = null;
    }
  }

  /**
   * Try the two known feature-report IDs (0x01 then 0x02) for the two
   * lizard-mode commands. Returns true if both commands made it through
   * on either id — the heartbeat then keeps using whichever id worked.
   * The Puck's 5 HID interfaces mean only one will accept feature
   * reports; errors on the other four are swallowed silently.
   */
  async _sendLizardModeDisable() {
    const clear = new Uint8Array([CMD_CLEAR_DIGITAL_MAPPINGS]);
    const setSettings = new Uint8Array([
      CMD_SET_SETTINGS,
      6,                                       // payload length
      SETTING_RIGHT_TRACKPAD_MODE, TRACKPAD_MODE_NONE, 0x00,
      SETTING_LEFT_TRACKPAD_MODE,  TRACKPAD_MODE_NONE, 0x00,
    ]);

    for (const id of [FEATURE_REPORT_ID_PRIMARY, FEATURE_REPORT_ID_FALLBACK]) {
      try {
        await this.device.sendFeatureReport(id, clear);
        await this.device.sendFeatureReport(id, setSettings);
        this._featureReportId = id;
        console.log(`Steam Controller (Puck): lizard-mode disable sent on feature report id 0x${id.toString(16)}`);
        return true;
      } catch {
        // wrong interface for feature reports — try the next id, then bail
      }
    }
    return false;
  }

  async _sendFeatureReport(payload) {
    return this.device.sendFeatureReport(this._featureReportId, payload);
  }

  parseReport(reportId, data) {
    // Gate on the STATE report's length (53 bytes on the 2026 device).
    // Other report shapes from this firmware (status @ 5 bytes, etc.)
    // get filtered out without us having to enumerate report ids; the
    // 0x42-vs-0x45 reportId discrepancy between SteamlessController's
    // docs and our captures becomes moot. Log the actual id once per
    // instance so future debugging still has the data point.
    if (data.byteLength !== STATE_REPORT_LEN) return null;
    if (!this._loggedReportIds.has(reportId)) {
      this._loggedReportIds.add(reportId);
      console.log(`Steam Controller STATE report id observed: 0x${reportId.toString(16)} (${data.byteLength} bytes)`);
    }

    const r = ControllerDriver.readSigned16;
    const u16 = (offset) => data.getUint8(offset) | (data.getUint8(offset + 1) << 8);

    const btn0 = data.getUint8(1);
    const btn1 = data.getUint8(2);
    const btn2 = data.getUint8(3);
    // byte 4 = flags (touch/click state) — not surfaced in Phase 1

    // Sticks: int16 LE centered at 0, range ±0x7FFF → normalize to [-1, 1].
    // Y axes are inverted relative to the Gamepad-API "up = -1" convention,
    // so negate ly / ry. Confirmed via the level-B DevTools demo.
    const STICK_SCALE = 1 / 0x7FFF;
    const sticks = {
      lx: r(data, 9)  * STICK_SCALE,
      ly: -r(data, 11) * STICK_SCALE,
      rx: r(data, 13) * STICK_SCALE,
      ry: -r(data, 15) * STICK_SCALE,
    };

    // Triggers: int16 LE 0..0x7FFF (positive only). Right trigger has an
    // explicit "full pull" digital bit (btn2 0x80) for the hard click;
    // left trigger appears to be analog-only in this firmware.
    const TRIG_SCALE = 1 / 0x7FFF;
    const triggers = {
      l2: Math.max(0, r(data, 5)) * TRIG_SCALE,
      r2: Math.max(0, r(data, 7)) * TRIG_SCALE,
    };

    const buttons = {
      // Face buttons (Xbox layout per the printed glyphs on the pad)
      cross:    !!(btn0 & 0x01), // A
      circle:   !!(btn0 & 0x02), // B
      square:   !!(btn0 & 0x04), // X
      triangle: !!(btn0 & 0x08), // Y
      // Shoulders
      l1:       !!(btn2 & 0x08), // LB
      r1:       !!(btn1 & 0x02), // RB
      // System buttons
      create:   !!(btn1 & 0x40), // View
      options:  !!(btn0 & 0x40), // Menu
      ps:       !!(btn2 & 0x01), // Steam (PS-equivalent)
      // Stick clicks
      l3:       !!(btn1 & 0x80),
      r3:       !!(btn0 & 0x20),
      // D-pad
      dpadUp:    !!(btn1 & 0x20),
      dpadDown:  !!(btn1 & 0x04),
      dpadLeft:  !!(btn1 & 0x10),
      dpadRight: !!(btn1 & 0x08),
    };

    // Back paddles aren't in the standard Gamepad-API slot map. Surface
    // them on a separate `paddles` field so future consumers (HUD
    // widgets, custom binding UI) can pick them up without us mis-
    // synthesizing them as duplicate face buttons.
    const paddles = {
      l4: !!(btn2 & 0x02),
      l5: !!(btn2 & 0x04),
      r4: !!(btn0 & 0x80),
      r5: !!(btn1 & 0x01),
    };

    // Trackpads: two int16 LE XY pairs + a contact-area uint16 each.
    // The contact-area being non-zero is the cleanest "is the finger
    // touching this trackpad" signal; X/Y read 0 when not touching but
    // also legitimately 0 dead-center.
    const lPadArea = u16(21);
    const rPadArea = u16(27);
    const touchpad = [
      {
        active: lPadArea > 0,
        id: 0,
        x: r(data, 17),
        y: r(data, 19),
        area: lPadArea,
      },
      {
        active: rPadArea > 0,
        id: 1,
        x: r(data, 23),
        y: r(data, 25),
        area: rPadArea,
      },
    ];

    // IMU is a quaternion at offsets 31-38 (4× int16 LE). Phase 1 omits
    // it — feeding raw quaternion components to a gyro-rate fusion
    // pipeline produces garbage. Wiring quaternion-orientation through
    // the visualizer (bypassing fusion entirely for this driver) is
    // tracked as follow-up; returning null here keeps the gyro pipeline
    // safely idle in the meantime.

    return {
      sticks,
      triggers,
      buttons,
      paddles,
      touchpad,
      touchpadButton: false,
      gyro: null,
      accel: null,
      gyroScale: 2000.0 / 32768.0,
      accelScale: 1.0 / 8192.0,
    };
  }

  static detectConnectionType() { return 'usb'; }
}
