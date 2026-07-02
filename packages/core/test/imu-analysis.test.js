// ============================================================
// analyzeImuStep — capture-quality gate for the Test Report wizard
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeImuStep } from '../src/imu-analysis.js';
import { PlayStationDriver } from '../src/drivers/playstation-driver.js';
import { loadFixture, framesFromStep } from './helpers.js';

// Parse a fixture step's reports through the driver into {gyro,accel} samples.
function samplesFor(fixture, stepId, connectionType, mode = 'ds4') {
  const drv = new PlayStationDriver({ opened: true, collections: [] }, connectionType, { mode });
  return framesFromStep(fixture, stepId)
    .map((f) => drv.parseReport(f.reportId, f.data))
    .filter((p) => p && p.gyro && p.accel)
    .map((p) => ({ gyro: p.gyro, accel: p.accel }));
}

// ── Real captures: both are clean; assert the gate passes them and reads
//    the right dominant axis per rotation (pitch X / roll Z / yaw Y). ──

test('GOLDEN GameSir (clean): at-rest still + each rotation isolated to its axis', () => {
  const fx = loadFixture('gamesir-super-nova-ds4_054c-09cc.json'); // USB report 0x01
  assert.equal(analyzeImuStep('at-rest', samplesFor(fx, 'at-rest', 'usb')).ok, true);
  assert.equal(analyzeImuStep('pitch', samplesFor(fx, 'pitch', 'usb')).detail.dominantAxis, 'gyro X');
  assert.equal(analyzeImuStep('roll', samplesFor(fx, 'roll', 'usb')).detail.dominantAxis, 'gyro Z');
  assert.equal(analyzeImuStep('yaw', samplesFor(fx, 'yaw', 'usb')).detail.dominantAxis, 'gyro Y');
  for (const s of ['pitch', 'roll', 'yaw']) {
    assert.equal(analyzeImuStep(s, samplesFor(fx, s, 'usb')).ok, true, `${s} should pass`);
  }
});

test('GOLDEN Sony DS4 BT (clean): same axis mapping as GameSir (pitch X / roll Z / yaw Y)', () => {
  const fx = loadFixture('sony-dualshock4-v1-bt_054c-05c4.json'); // BT report 0x11
  assert.equal(analyzeImuStep('at-rest', samplesFor(fx, 'at-rest', 'bluetooth')).ok, true);
  assert.equal(analyzeImuStep('pitch', samplesFor(fx, 'pitch', 'bluetooth')).detail.dominantAxis, 'gyro X');
  assert.equal(analyzeImuStep('roll', samplesFor(fx, 'roll', 'bluetooth')).detail.dominantAxis, 'gyro Z');
  assert.equal(analyzeImuStep('yaw', samplesFor(fx, 'yaw', 'bluetooth')).detail.dominantAxis, 'gyro Y');
  for (const s of ['pitch', 'roll', 'yaw']) {
    assert.equal(analyzeImuStep(s, samplesFor(fx, s, 'bluetooth')).ok, true, `${s} should pass`);
  }
});

// ── Synthetic edge cases for the failure paths the gate must catch ──

const still = (n = 30) => Array.from({ length: n }, () => ({ gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 8192 } }));
const cleanRollZ = (n = 30) => Array.from({ length: n }, (_, i) => ({
  gyro: { x: 0, y: 0, z: Math.round(600 * Math.sin(i / 3)) },
  accel: { x: Math.round(8192 * Math.sin(i / 3)), y: 0, z: Math.round(8192 * Math.cos(i / 3)) },
}));

test('at-rest: still + 1g passes; wobble fails', () => {
  assert.equal(analyzeImuStep('at-rest', still()).ok, true);
  const wobble = Array.from({ length: 30 }, (_, i) => ({ gyro: { x: 300 * (i % 2 ? 1 : -1), y: 0, z: 0 }, accel: { x: 0, y: 0, z: 8192 } }));
  const v = analyzeImuStep('at-rest', wobble);
  assert.equal(v.ok, false);
  assert.match(v.message, /not still/i);
});

test('rotation: clean single-axis passes; weak motion is rejected', () => {
  const good = analyzeImuStep('roll', cleanRollZ());
  assert.equal(good.ok, true);
  assert.equal(good.detail.dominantAxis, 'gyro Z');

  const weak = Array.from({ length: 30 }, (_, i) => ({ gyro: { x: 0, y: 0, z: Math.round(20 * Math.sin(i / 3)) }, accel: { x: 0, y: 0, z: 8192 } }));
  const v = analyzeImuStep('roll', weak);
  assert.equal(v.ok, false);
  assert.match(v.message, /too little rotation/i);
});

test('rotation: multi-axis wobble is rejected (not isolated)', () => {
  const multi = Array.from({ length: 30 }, (_, i) => ({
    gyro: { x: Math.round(500 * Math.sin(i / 3)), y: 0, z: Math.round(500 * Math.cos(i / 3)) },
    accel: { x: 0, y: 0, z: 8192 },
  }));
  const v = analyzeImuStep('roll', multi);
  assert.equal(v.ok, false);
  assert.match(v.message, /not isolated/i);
});

test('too few samples is a hard fail', () => {
  assert.equal(analyzeImuStep('pitch', [{ gyro: { x: 1, y: 1, z: 1 }, accel: { x: 0, y: 0, z: 8192 } }]).ok, false);
});

// ── accelScale-aware at-rest window: a Steam Controller sits at 1g = 16384
//    (±2g), so the analyzer must key the "~1g" check off the device scale
//    instead of the 8192 default — otherwise a perfectly good SC capture
//    false-warns. Mirrors the real 2026-firmware SC capture (|accel|≈16337).
const stillAt = (mag, n = 30) => Array.from({ length: n }, () => ({ gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: mag } }));

test('at-rest: Steam Controller 1g (16384) passes when accelScale is supplied', () => {
  const scRest = stillAt(16337); // ≈ the real after-firmware SC capture
  // Without the scale, the 8192 default window flags it (the old false-warn):
  assert.equal(analyzeImuStep('at-rest', scRest).ok, false);
  // With the SC scale, the expected 1g becomes 16384 and it passes:
  const v = analyzeImuStep('at-rest', scRest, 1 / 16384);
  assert.equal(v.ok, true, v.message);
  assert.match(v.message, /still/i);
});

test('at-rest: scale-aware window still catches a genuinely wrong magnitude', () => {
  // Half of 1g on the SC scale is outside the 0.8x..1.25x window → warn.
  const v = analyzeImuStep('at-rest', stillAt(8192), 1 / 16384);
  assert.equal(v.ok, false);
  assert.match(v.message, /16384 \(1g\)/);
});
