// ============================================================
// STEAM CONTROLLER DRIVER (stub — identity only, no WebHID parsing yet)
// ============================================================
//
// Reserves the slot for the 2026 Steam Controller so it appears in the
// DEVICES dictionary and gets a name/icon in UI. Buttons and sticks come
// through the standard Gamepad API; gyro / trackpad / back-paddles will
// need real Steam Input HID parsing in a follow-up pass.
//
// Modeled on XboxDriver — same "no WebHID features" shape.

import { ControllerDriver } from './base-driver.js';

export class SteamControllerDriver extends ControllerDriver {
  parseReport() { return null; }
  static detectConnectionType() { return 'usb'; }
}
