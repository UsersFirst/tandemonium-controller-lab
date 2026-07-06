// ============================================================
// PlayStationDriver.parseReport — offset correctness
// ============================================================
//
// These lock the byte offsets parseReport reads for each field. An
// off-by-N regression (the exact failure mode behind the original
// DualShock-4 gyro bug) flips one of these assertions immediately.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PlayStationDriver } from '../src/drivers/playstation-driver.js';
import { ControllerDriver } from '../src/drivers/base-driver.js';
import { buildPSReport, buildDs4BtReport, buildDs4Report, dataView } from './helpers.js';

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

/** Build a driver with no real device, just connection type + entry. */
const drv = (connectionType, entry) =>
  new PlayStationDriver({ opened: true, collections: [] }, connectionType, entry);

// Face-button bit masks (high nibble of faceByte; low nibble = dpad dir).
const SQUARE = 0x10, CROSS = 0x20, CIRCLE = 0x40, TRIANGLE = 0x80;
const DPAD_NEUTRAL = 0x08;

test('DS5 USB: every field parses at the DualSense offsets', () => {
  const d = drv('usb', { mode: 'ds5' });
  const { data } = buildPSReport({
    mode: 'ds5',
    lx: 0, ly: 255, rx: 128, ry: 128,      // lx full-left, ly full-down, right centered
    l2: 127, r2: 255,
    faceByte: DPAD_NEUTRAL | CROSS,         // cross pressed, dpad neutral
    optByte: 0x01,                          // l1
    psByte: 0x01 | 0x02,                    // ps + touchpad click
    gyro: { x: 100, y: -200, z: 300 },
    accel: { x: 0, y: 0, z: 8192 },
  });
  const p = d.parseReport(0x01, data);
  assert.ok(p, 'expected a parsed report');

  approx(p.sticks.lx, -1);
  approx(p.sticks.ly, (255 - 128) / 128);
  approx(p.sticks.rx, 0);
  approx(p.sticks.ry, 0);

  approx(p.triggers.l2, 127 / 255);
  approx(p.triggers.r2, 1);

  assert.equal(p.buttons.cross, true);
  assert.equal(p.buttons.square, false);
  assert.equal(p.buttons.l1, true);
  assert.equal(p.buttons.r1, false);
  assert.equal(p.buttons.ps, true);
  assert.equal(p.touchpadButton, true);

  assert.deepEqual(p.gyro, { x: 100, y: -200, z: 300 });
  assert.deepEqual(p.accel, { x: 0, y: 0, z: 8192 });

  approx(p.gyroScale, 2000 / 32768);
  approx(p.accelScale, 1 / 8192);
});

test('DS4 mode USB: IMU reads from the byte-12 window, not byte-15', () => {
  const d = drv('usb', { mode: 'ds4' });
  // Plant IMU at the DS4 offsets (12/18) via the builder.
  const { data } = buildPSReport({
    mode: 'ds4',
    gyro: { x: 11, y: 22, z: 33 },
    accel: { x: 0, y: 0, z: 8192 },
  });
  const p = d.parseReport(0x01, data);
  assert.deepEqual(p.gyro, { x: 11, y: 22, z: 33 });
  assert.deepEqual(p.accel, { x: 0, y: 0, z: 8192 });
});

test('runtime IMU probe overrides the mode default', () => {
  // entry says ds4 (default gyro@12) but the probe detected the DS5 window.
  const d = drv('usb', { mode: 'ds4' });
  d._detectedImuOffset = { gyroOffset: 15 };
  const { data } = buildPSReport({ mode: 'ds5', gyro: { x: 7, y: 8, z: 9 } });
  const p = d.parseReport(0x01, data);
  assert.deepEqual(p.gyro, { x: 7, y: 8, z: 9 }, 'probe offset should win over mode default');
});

test('report-id / connection gating', () => {
  const { data } = buildPSReport({ mode: 'ds5' });
  // USB driver ignores BT report ids.
  assert.equal(drv('usb', { mode: 'ds5' }).parseReport(0x31, data), null);
  assert.equal(drv('usb', { mode: 'ds4' }).parseReport(0x11, data), null);
  // BT driver ignores the USB / compatibility report id (DS4 BT short 0x01).
  assert.equal(drv('bluetooth', { mode: 'ds5' }).parseReport(0x01, data), null);
  assert.equal(drv('bluetooth', { mode: 'ds4' }).parseReport(0x01, data), null);
});

test('DS4 USB: buttons/sticks/triggers parse at the DS4 offsets (+4/+5/+6, +7/+8)', () => {
  const d = drv('usb', { mode: 'ds4' });
  const { data } = buildDs4Report({
    lx: 0, ly: 255, rx: 128, ry: 128,       // lx full-left, ly full-down
    l2: 200,
    faceByte: DPAD_NEUTRAL | CROSS,          // cross, dpad neutral
    shoulderByte: 0x01 | 0x20,               // L1 + options
    sysByte: 0x01,                           // PS
    gyro: { x: 1, y: 2, z: 3 }, accel: { x: 0, y: 0, z: 8192 },
  });
  const p = d.parseReport(0x01, data);
  assert.ok(p);
  approx(p.sticks.lx, -1);
  approx(p.sticks.ly, (255 - 128) / 128);
  approx(p.triggers.l2, 200 / 255);
  assert.equal(p.buttons.cross, true);
  assert.equal(p.buttons.square, false);
  assert.equal(p.buttons.l1, true);
  assert.equal(p.buttons.options, true);
  assert.equal(p.buttons.ps, true);
  assert.equal(p.buttons.dpadUp, false);      // dpad neutral (hat 8)
  assert.deepEqual(p.gyro, { x: 1, y: 2, z: 3 });
  assert.deepEqual(p.accel, { x: 0, y: 0, z: 8192 });
});

test('DS4 Bluetooth report 0x11: IMU at +2 AND buttons at the DS4 offsets', () => {
  const d = drv('bluetooth', { mode: 'ds4' });
  const { data } = buildDs4Report({
    bt: true,
    faceByte: DPAD_NEUTRAL | TRIANGLE,       // triangle, dpad neutral
    shoulderByte: 0x02,                      // R1
    gyro: { x: 5, y: -6, z: 7 }, accel: { x: 0, y: 0, z: 8192 },
  });
  const p = d.parseReport(0x11, data);
  assert.ok(p, 'DS4 BT 0x11 should parse');
  assert.deepEqual(p.gyro, { x: 5, y: -6, z: 7 });
  assert.deepEqual(p.accel, { x: 0, y: 0, z: 8192 });
  assert.equal(p.buttons.triangle, true);
  assert.equal(p.buttons.cross, false);
  assert.equal(p.buttons.r1, true);
  assert.equal(p.buttons.dpadUp, false);
});

test('detectConnectionType: DS4 BT (input 0x11) vs USB (0x11 only as feature)', () => {
  const ds4bt = { collections: [{ inputReports: [{ reportId: 0x11 }], outputReports: [{ reportId: 0x11 }], featureReports: [{ reportId: 0x02 }] }] };
  // The trap: a real DS4 over USB lists 0x11 as a FEATURE report — must NOT
  // be read as Bluetooth.
  const ds4usb = { collections: [{ inputReports: [{ reportId: 0x01 }], outputReports: [{ reportId: 0x05 }], featureReports: [{ reportId: 0x11 }] }] };
  const ds5bt = { collections: [{ inputReports: [{ reportId: 0x31 }], outputReports: [{ reportId: 0x31 }] }] };
  assert.equal(PlayStationDriver.detectConnectionType(ds4bt), 'bluetooth');
  assert.equal(PlayStationDriver.detectConnectionType(ds4usb), 'usb');
  assert.equal(PlayStationDriver.detectConnectionType(ds5bt), 'bluetooth');
});

test('signed-16 IMU values round-trip including negatives', () => {
  const d = drv('usb', { mode: 'ds5' });
  const { data } = buildPSReport({ mode: 'ds5', gyro: { x: -1, y: -32768, z: 32767 } });
  const p = d.parseReport(0x01, data);
  assert.deepEqual(p.gyro, { x: -1, y: -32768, z: 32767 });
});

test('readSigned16 helper handles the sign boundary', () => {
  const u8 = Uint8Array.from([0x00, 0x80, 0xff, 0x7f]); // -32768, +32767
  const dv = dataView(u8);
  assert.equal(ControllerDriver.readSigned16(dv, 0), -32768);
  assert.equal(ControllerDriver.readSigned16(dv, 2), 32767);
});

test('touchpad: active and inactive points parse correctly (DS5 window)', () => {
  const d = drv('usb', { mode: 'ds5' });
  const { data } = buildPSReport({
    mode: 'ds5',
    touch: [
      { b0: 0x05, b1: 0x34, b2: 0x12, b3: 0x05 }, // active, id 5
      { b0: 0x80, b1: 0x00, b2: 0x00, b3: 0x00 }, // inactive (bit7 set)
    ],
  });
  const p = d.parseReport(0x01, data);
  const [t0, t1] = p.touchpad;
  assert.equal(t0.active, true);
  assert.equal(t0.id, 5);
  assert.equal(t0.x, 0x34 | ((0x12 & 0x0f) << 8));      // = 0x234
  assert.equal(t0.y, ((0x12 & 0xf0) >> 4) | (0x05 << 4)); // = 0x51
  assert.equal(t1.active, false);
});
