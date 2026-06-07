// ============================================================
// SteamControllerDriver.parseReport — report-id gating (#28)
// ============================================================
//
// Regression lock for issue #28: the 2026 firmware emits multiple
// 53-byte report types (real capture: 0x45 ×1343 STATE, plus 0x7b ×9
// and 0x43 ×2 non-STATE). parseReport originally gated on length alone
// and treated the report id as "moot", so the non-STATE reports parsed
// as garbage → phantom buttons/sticks + zeroed IMU that tripped the
// manager's stuck-IMU self-heal. These tests pin the allow-list gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SteamControllerDriver } from '../src/drivers/steam-controller-driver.js';
import { dataView } from './helpers.js';

const STATE_REPORT_LEN = 53;

/** Build a driver with no real device (USB-C path: not the Puck). */
const drv = () =>
  new SteamControllerDriver({ opened: true, collections: [], productId: 0x1302 }, 'usb', null);

function writeS16LE(u8, offset, value) {
  const v = value & 0xffff;
  u8[offset] = v & 0xff;
  u8[offset + 1] = (v >> 8) & 0xff;
}

/**
 * Build a 53-byte Steam Controller STATE report planting known values at
 * the offsets parseReport reads. Defaults are all-zero (at rest).
 */
function buildSteamReport({
  btn0 = 0, btn1 = 0, btn2 = 0,
  lx = 0, ly = 0, rx = 0, ry = 0,
  l2 = 0, r2 = 0,
  gyro = { x: 0, y: 0, z: 0 },
  accel = { x: 0, y: 0, z: 0 },
} = {}) {
  const u8 = new Uint8Array(STATE_REPORT_LEN);
  u8[1] = btn0 & 0xff; u8[2] = btn1 & 0xff; u8[3] = btn2 & 0xff;
  writeS16LE(u8, 5, l2); writeS16LE(u8, 7, r2);
  writeS16LE(u8, 9, lx); writeS16LE(u8, 11, ly);
  writeS16LE(u8, 13, rx); writeS16LE(u8, 15, ry);
  // accel x@33, y@37, z@35 ; gyro x@39, y@43, z@41
  writeS16LE(u8, 33, accel.x); writeS16LE(u8, 35, accel.z); writeS16LE(u8, 37, accel.y);
  writeS16LE(u8, 39, gyro.x); writeS16LE(u8, 41, gyro.z); writeS16LE(u8, 43, gyro.y);
  return dataView(u8);
}

test('STATE report id 0x45 parses (the real 2026 STATE report)', () => {
  const d = drv();
  const data = buildSteamReport({ btn0: 0x40 /* options/menu */ });
  const p = d.parseReport(0x45, data);
  assert.ok(p, 'expected a parsed STATE report');
  assert.equal(p.buttons.options, true);
  assert.ok(p.gyro && p.accel, 'STATE report should carry IMU');
});

test('STATE report id 0x42 also parses (per SteamlessController docs)', () => {
  const d = drv();
  const p = d.parseReport(0x42, buildSteamReport());
  assert.ok(p, 'expected 0x42 to be accepted as STATE');
});

test('#28: non-STATE 53-byte report ids are rejected (no phantom input)', () => {
  const d = drv();
  // The exact stray ids seen in the at-rest Puck capture, carrying the
  // garbage byte values that previously surfaced as phantom presses.
  const stray = buildSteamReport({ btn0: 0x5c, btn1: 0x87, btn2: 0xf5, lx: 2048, ly: -2048 });
  assert.equal(d.parseReport(0x7b, stray), null, '0x7b must be ignored');
  assert.equal(d.parseReport(0x43, stray), null, '0x43 must be ignored');
  assert.equal(d.parseReport(0x00, stray), null, 'unknown id must be ignored');
});

test('wrong-length reports are still rejected regardless of id', () => {
  const d = drv();
  const short = dataView(new Uint8Array(5));
  const long = dataView(new Uint8Array(64));
  assert.equal(d.parseReport(0x45, short), null);
  assert.equal(d.parseReport(0x45, long), null);
});
