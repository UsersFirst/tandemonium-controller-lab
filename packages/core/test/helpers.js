// ============================================================
// Shared test helpers — frame builders + fake HID device
// ============================================================
//
// Deterministic construction of PlayStation HID input reports and a
// minimal fake HIDDevice so the IMU probe (which listens on
// device.addEventListener('inputreport', ...)) can be driven without
// real hardware.

import { readFileSync } from 'node:fs';

// ── Byte / DataView utilities ──────────────────────────────────

/** "80 80 1c ff" → Uint8Array. Mirrors the wizard's bytesToHex format. */
export function bytesFromHex(hex) {
  return Uint8Array.from(hex.trim().split(/\s+/).map((b) => parseInt(b, 16)));
}

/** Uint8Array (or array) → DataView, as parseReport receives it. */
export function dataView(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

/** Write a signed 16-bit little-endian value (two's complement). */
function writeS16LE(u8, offset, value) {
  const v = value & 0xffff;
  u8[offset] = v & 0xff;
  u8[offset + 1] = (v >> 8) & 0xff;
}

// ── PlayStation USB report builder ─────────────────────────────
//
// Plants known values at the exact offsets PlayStationDriver.parseReport
// reads for a USB (reportId 0x01) report. `mode` selects the IMU/touchpad
// window: 'ds5' → gyro@15/touch@32, 'ds4' → gyro@12/touch@35. Stick,
// trigger and button offsets are identical across modes in the current
// driver, so locking them here is exactly what catches an offset
// regression like the original DualShock-4 bug.

const GYRO_OFFSET = { ds5: 15, ds4: 12 };
const TOUCH_OFFSET = { ds5: 32, ds4: 35 };

/**
 * @param {object} opts
 * @param {'ds5'|'ds4'} [opts.mode]
 * @param {number} [opts.lx],[opts.ly],[opts.rx],[opts.ry] — raw 0-255 (128 = center)
 * @param {number} [opts.l2],[opts.r2] — raw analog 0-255
 * @param {number} [opts.faceByte] — dpad nibble (low) + face buttons (high); default 0x08 = dpad neutral
 * @param {number} [opts.optByte]  — shoulders / options / stick-click bits
 * @param {number} [opts.psByte]   — PS / touchpad-click / mic bits
 * @param {{x,y,z}} [opts.gyro]    — raw signed-16 per axis
 * @param {{x,y,z}} [opts.accel]   — raw signed-16 per axis
 * @param {Array<{b0,b1,b2,b3}>} [opts.touch] — up to 2 raw touch points
 * @param {number} [opts.len]      — report length (default 64, matches real ~63)
 * @returns {{reportId:number, data:DataView}}
 */
export function buildPSReport({
  mode = 'ds5',
  lx = 128, ly = 128, rx = 128, ry = 128,
  l2 = 0, r2 = 0,
  faceByte = 0x08, optByte = 0, psByte = 0,
  gyro = { x: 0, y: 0, z: 0 },
  accel = { x: 0, y: 0, z: 0 },
  touch = [],
  len = 64,
} = {}) {
  const u8 = new Uint8Array(len);
  u8[0] = lx; u8[1] = ly; u8[2] = rx; u8[3] = ry;
  u8[4] = l2 & 0xff; u8[5] = r2 & 0xff;
  u8[7] = faceByte & 0xff; u8[8] = optByte & 0xff; u8[9] = psByte & 0xff;

  const g = GYRO_OFFSET[mode];
  writeS16LE(u8, g, gyro.x); writeS16LE(u8, g + 2, gyro.y); writeS16LE(u8, g + 4, gyro.z);
  writeS16LE(u8, g + 6, accel.x); writeS16LE(u8, g + 8, accel.y); writeS16LE(u8, g + 10, accel.z);

  const t = TOUCH_OFFSET[mode];
  touch.slice(0, 2).forEach((pt, i) => {
    const o = t + i * 4;
    u8[o] = pt.b0 & 0xff; u8[o + 1] = pt.b1 & 0xff;
    u8[o + 2] = pt.b2 & 0xff; u8[o + 3] = pt.b3 & 0xff;
  });

  return { reportId: 0x01, data: dataView(u8) };
}

/**
 * Build a DualShock 4 **Bluetooth** full report (`0x11`). A 2-byte BT header
 * precedes the otherwise-USB-identical layout, so the IMU lands at USB
 * offset + 2 (gyro 14, accel 20).
 * @returns {{reportId:number, data:DataView}}
 */
export function buildDs4BtReport(opts = {}) {
  return buildDs4Report({ ...opts, bt: true });
}

/**
 * Build a **DualShock 4** report at the true DS4 button layout (distinct from
 * the DualSense layout of buildPSReport): dpad+face at +4, shoulders at +5,
 * PS/touchpad at +6, L2/R2 analog at +7/+8. `bt:true` prepends the 2-byte BT
 * header (report 0x11, baseOffset 2, IMU +2); otherwise USB (report 0x01,
 * baseOffset 0, IMU at 12). Defaults to dpad-neutral (0x08).
 * @returns {{reportId:number, data:DataView}}
 */
export function buildDs4Report({
  bt = false,
  lx = 128, ly = 128, rx = 128, ry = 128,
  l2 = 0, r2 = 0,
  faceByte = 0x08, shoulderByte = 0, sysByte = 0,
  gyro = { x: 0, y: 0, z: 0 },
  accel = { x: 0, y: 0, z: 0 },
  len,
} = {}) {
  const base = bt ? 2 : 0;
  const gyroOff = bt ? 14 : 12;
  const u8 = new Uint8Array(len || (bt ? 78 : 64));
  if (bt) { u8[0] = 0xc0; u8[1] = 0x00; }        // BT header (report id already stripped)
  u8[base + 0] = lx; u8[base + 1] = ly; u8[base + 2] = rx; u8[base + 3] = ry;
  u8[base + 4] = faceByte & 0xff;
  u8[base + 5] = shoulderByte & 0xff;
  u8[base + 6] = sysByte & 0xff;
  u8[base + 7] = l2 & 0xff; u8[base + 8] = r2 & 0xff;
  writeS16LE(u8, gyroOff, gyro.x); writeS16LE(u8, gyroOff + 2, gyro.y); writeS16LE(u8, gyroOff + 4, gyro.z);
  writeS16LE(u8, gyroOff + 6, accel.x); writeS16LE(u8, gyroOff + 8, accel.y); writeS16LE(u8, gyroOff + 10, accel.z);
  return { reportId: bt ? 0x11 : 0x01, data: dataView(u8) };
}

// ── Fake HID device (drives the IMU probe) ─────────────────────
//
// _probeImuOffset adds an 'inputreport' listener then waits up to 500ms,
// finishing early once 10 reports arrive. This fake emits its frames on
// the microtask queue right after the listener is attached, so the probe
// resolves deterministically without real timers or hardware.

export class FakeHidDevice {
  /** @param {Array<{reportId:number, data:DataView}>} frames */
  constructor(frames = []) {
    this.frames = frames;
    this._handlers = new Set();
    this.collections = [];
    this.opened = true;
  }

  addEventListener(type, fn) {
    if (type !== 'inputreport') return;
    this._handlers.add(fn);
    queueMicrotask(() => {
      for (const f of this.frames) {
        if (!this._handlers.has(fn)) break; // stop if removed mid-stream
        fn({ reportId: f.reportId ?? 0x01, data: f.data });
      }
    });
  }

  removeEventListener(type, fn) {
    this._handlers.delete(fn);
  }
}

// ── Fixture loading ────────────────────────────────────────────

/** Load a JSON fixture from ./fixtures by filename. */
export function loadFixture(name) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

/**
 * Turn a capture step's reports into probe-ready frames.
 * @param {object} fixture — parsed controller-test-report
 * @param {string} stepId  — e.g. 'at-rest'
 * @param {number} [limit] — cap number of frames
 */
export function framesFromStep(fixture, stepId, limit = Infinity) {
  const step = fixture.steps.find((s) => s.id === stepId);
  if (!step || !step.reports) throw new Error(`fixture step not found: ${stepId}`);
  return step.reports.slice(0, limit).map((r) => ({
    reportId: r.reportId ?? 0x01,
    data: dataView(bytesFromHex(r.bytes)),
  }));
}
