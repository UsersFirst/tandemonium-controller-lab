// ============================================================
// PlayStationDriver IMU probe — offset detection + family scoring
// ============================================================
//
// The probe is what auto-distinguishes PlayStation-family controllers
// that share a vid:pid (real Sony DS4/DS5 vs GameSir clones). It scores
// candidate gyro offsets [12,13,15] by at-rest accel magnitude (≈8192 =
// 1g) and maps the winner to an IMU family.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PlayStationDriver } from '../src/drivers/playstation-driver.js';
import { buildPSReport, buildDs4BtReport, FakeHidDevice, loadFixture, framesFromStep } from './helpers.js';

test('GOLDEN: real GameSir Super Nova capture probes to gyroOffset 12 / family gamesir-ds4', async () => {
  const fixture = loadFixture('gamesir-super-nova-ds4_054c-09cc.json');
  const frames = framesFromStep(fixture, 'at-rest', 30);
  const device = new FakeHidDevice(frames);
  const d = new PlayStationDriver(device, 'usb', {
    mode: 'ds4',
    name: 'GameSir Super Nova (DS4 mode)',
  });

  await d.init(); // runs the probe + family classification on real bytes

  assert.ok(d._detectedImuOffset, 'probe should have produced a result');
  assert.equal(d._detectedImuOffset.gyroOffset, 12);
  assert.equal(d._detectedImuOffset.accelOffset, 18);
  assert.equal(d._detectedImuFamily, 'gamesir-ds4');
  // At-rest accel magnitude is ~1g (8192 raw); fixture measures ~8243.
  assert.ok(
    d._detectedImuOffset.meanAccelMag > 7000 && d._detectedImuOffset.meanAccelMag < 9500,
    `accel mag ${d._detectedImuOffset.meanAccelMag} should be ~8192`,
  );
});

test('GOLDEN: the wrong offsets score far worse than the winner', async () => {
  // Guards the *scoring*, not just the winner: 13 and 15 must lose to 12.
  const fixture = loadFixture('gamesir-super-nova-ds4_054c-09cc.json');
  const frames = framesFromStep(fixture, 'at-rest', 40);
  const device = new FakeHidDevice(frames);
  const d = new PlayStationDriver(device, 'usb', { mode: 'ds4' });
  const winner = await d._probeImuOffset();
  assert.equal(winner.gyroOffset, 12);
  // Re-derive the loser magnitudes from the same frames to prove separation.
  // (offsets 13/15 measured ~26777 / ~24332 on this capture — way off 1g.)
  assert.ok(winner.meanAccelMag < 12000, 'winner near 1g');
});

test('synthetic DualSense at-rest probes to gyroOffset 15 / family sony-ds5', async () => {
  const frames = Array.from({ length: 12 }, () =>
    buildPSReport({ mode: 'ds5', gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 8192 } }),
  );
  const device = new FakeHidDevice(frames);
  const d = new PlayStationDriver(device, 'usb', { mode: 'ds5' });
  await d.init();
  assert.equal(d._detectedImuOffset.gyroOffset, 15);
  assert.equal(d._detectedImuFamily, 'sony-ds5');
});

test('DS4 Bluetooth probe finds the +2 offset (gyro 14) from report 0x11', async () => {
  // Gravity on X (offset 20) so only the true window (gyro 14 / accel 20)
  // scores ~1g — avoids the ±2 accel-magnitude ambiguity gravity-on-Z causes.
  const frames = Array.from({ length: 12 }, () =>
    buildDs4BtReport({ gyro: { x: 0, y: 0, z: 0 }, accel: { x: 8192, y: 0, z: 0 } }),
  );
  const d = new PlayStationDriver(new FakeHidDevice(frames), 'bluetooth', { mode: 'ds4' });
  const probe = await d._probeImuOffset();
  assert.ok(probe, 'BT probe should produce a result');
  assert.equal(probe.gyroOffset, 14);
  assert.equal(probe.baseOffset, 2);
  // Family classification removes the BT shift → USB-equivalent 12.
  assert.equal(PlayStationDriver._imuFamilyFor(probe.gyroOffset, probe.baseOffset), 'gamesir-ds4');
});

test('GOLDEN: real Sony DS4 v1 Bluetooth capture probes to gyroOffset 14 / accel ~1g', async () => {
  const fixture = loadFixture('sony-dualshock4-v1-bt_054c-05c4.json');
  const frames = framesFromStep(fixture, 'at-rest', 20); // report 0x11
  const d = new PlayStationDriver(new FakeHidDevice(frames), 'bluetooth', {
    mode: 'ds4', name: 'Sony DualShock 4 v1',
  });
  const probe = await d._probeImuOffset();
  assert.ok(probe, 'BT probe should produce a result');
  assert.equal(probe.gyroOffset, 14, 'real DS4 BT gyro is at byte 14 (USB 12 + 2)');
  assert.equal(probe.accelOffset, 20);
  assert.ok(probe.meanAccelMag > 7000 && probe.meanAccelMag < 9500, `accel ${probe.meanAccelMag} ~ 1g`);
});

test('init keeps the documented BT default (14) when the probe ties to the off-by-2 neighbour', async () => {
  // The exact bug that jerked steering: with gravity on Z (shared by the 14
  // and 16 windows) plus a small bias at offset 14, the raw probe scores 16
  // slightly better — but 16 reads accelX as a gyro axis. init() must defer
  // to the documented default offset (14) since it scored plausibly (~1g).
  const frames = Array.from({ length: 12 }, () =>
    buildDs4BtReport({ gyro: { x: 100, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 8192 } }),
  );
  const d = new PlayStationDriver(new FakeHidDevice(frames), 'bluetooth', { mode: 'ds4', name: 'Sony DualShock 4 v1' });
  // raw probe prefers 16 here…
  const raw = await d._probeImuOffset();
  assert.equal(raw.gyroOffset, 16);
  // …but init() corrects to the documented default 14.
  await d.init();
  assert.equal(d._detectedImuOffset.gyroOffset, 14);
});

test('probe returns null over Bluetooth when no reports arrive', async () => {
  const d = new PlayStationDriver(new FakeHidDevice([]), 'bluetooth', { mode: 'ds4' });
  assert.equal(await d._probeImuOffset(50), null);
});

test('probe returns null when no reports arrive before timeout', async () => {
  const d = new PlayStationDriver(new FakeHidDevice([]), 'usb', { mode: 'ds4' });
  assert.equal(await d._probeImuOffset(50), null);
});
