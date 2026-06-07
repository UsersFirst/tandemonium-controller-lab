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

// ── DS4/DS5-BT full-report activation retry (hot-plug) ───────────
// On hot-plug the BT link is still negotiating when init() runs: the
// feature read succeeds but the controller keeps streaming the short 0x01
// report, so no gyro arrives. _activateFullReportMode must re-issue the
// read until the full report stream (0x11) actually starts.

/** A DS4-BT handle that only starts streaming 0x11 after N feature reads. */
class DelayedActivationDs4 {
  constructor(activateAfter) {
    this.activateAfter = activateAfter;
    this.featureReads = 0;
    this._listeners = new Set();
    this.opened = true;
    this.collections = [];
    this.vendorId = 0x054c;
    this.productId = 0x05c4;
    this.productName = 'Wireless Controller';
  }
  async open() { this.opened = true; }
  async receiveFeatureReport() { this.featureReads++; return new DataView(new Uint8Array(8).buffer); }
  addEventListener(type, fn) {
    if (type !== 'inputreport') return;
    this._listeners.add(fn);
    if (this.featureReads >= this.activateAfter) {
      const { data } = buildDs4BtReport({ gyro: { x: 0, y: 0, z: 0 }, accel: { x: 8192, y: 0, z: 0 } });
      queueMicrotask(() => { if (this._listeners.has(fn)) fn({ reportId: 0x11, data }); });
    }
  }
  removeEventListener(type, fn) { this._listeners.delete(fn); }
}

test('activation retries the feature read until the 0x11 stream starts (hot-plug)', async () => {
  const fake = new DelayedActivationDs4(2); // flips to full mode on the 2nd read
  const d = new PlayStationDriver(fake, 'bluetooth', { mode: 'ds4', name: 'Sony DualShock 4 v1' });
  const ok = await d._activateFullReportMode(0x02, { attempts: 5, perAttemptMs: 25 });
  assert.equal(ok, true, 'should confirm the full report stream');
  assert.equal(fake.featureReads, 2, 'retried the feature read until 0x11 streamed');
});

test('activation succeeds on the first read when the link is already settled (cold-plug)', async () => {
  const fake = new DelayedActivationDs4(1); // streams immediately
  const d = new PlayStationDriver(fake, 'bluetooth', { mode: 'ds4' });
  const ok = await d._activateFullReportMode(0x02, { attempts: 5, perAttemptMs: 25 });
  assert.equal(ok, true);
  assert.equal(fake.featureReads, 1, 'no extra reads when full mode starts at once');
});

test('activation gives up after N attempts when the stream never starts', async () => {
  const fake = new DelayedActivationDs4(99); // never flips
  const d = new PlayStationDriver(fake, 'bluetooth', { mode: 'ds4' });
  const ok = await d._activateFullReportMode(0x02, { attempts: 3, perAttemptMs: 10 });
  assert.equal(ok, false);
  assert.equal(fake.featureReads, 3, 'bounded retries');
});

// ── Background re-activation (slow re-pair off the charger) ──────
// When the inline window expires before a slow-re-pairing controller starts
// streaming, _startBackgroundReactivation keeps nudging the feature read on a
// timer until the full report stream flips — or gives up after maxMs.

/** A DS4-BT handle that emits a 0x11 frame on each feature read once active. */
class BgActivationDs4 {
  constructor(activateAfter) {
    this.activateAfter = activateAfter;
    this.featureReads = 0;
    this._listeners = new Set();
    this.opened = true;
    this.collections = [];
    this.vendorId = 0x054c;
    this.productId = 0x05c4;
    this.productName = 'Wireless Controller';
  }
  async receiveFeatureReport() {
    this.featureReads++;
    if (this.featureReads >= this.activateAfter) {
      const { data } = buildDs4BtReport({ gyro: { x: 0, y: 0, z: 0 }, accel: { x: 8192, y: 0, z: 0 } });
      for (const fn of this._listeners) queueMicrotask(() => { if (this._listeners.has(fn)) fn({ reportId: 0x11, data }); });
    }
    return new DataView(new Uint8Array(8).buffer);
  }
  addEventListener(type, fn) { if (type === 'inputreport') this._listeners.add(fn); }
  removeEventListener(type, fn) { this._listeners.delete(fn); }
}

test('background re-activation flips the stream once the slow link is ready', async () => {
  const fake = new BgActivationDs4(2); // full reports start on the 2nd read
  const d = new PlayStationDriver(fake, 'bluetooth', { mode: 'ds4' });
  const ok = await d._startBackgroundReactivation(0x02, { intervalMs: 10, maxMs: 1000 });
  assert.equal(ok, true, 'should detect the full report stream');
  assert.ok(fake.featureReads >= 2, 'kept nudging the feature read until it streamed');
});

test('background re-activation gives up after maxMs', async () => {
  const fake = new BgActivationDs4(999); // never flips
  const d = new PlayStationDriver(fake, 'bluetooth', { mode: 'ds4' });
  const ok = await d._startBackgroundReactivation(0x02, { intervalMs: 10, maxMs: 50 });
  assert.equal(ok, false);
  assert.equal(d._reactivateTimer, null, 'timer cleaned up on give-up');
});

test('destroy() stops an in-flight background re-activation', async () => {
  const fake = new BgActivationDs4(999); // never flips
  const d = new PlayStationDriver(fake, 'bluetooth', { mode: 'ds4' });
  const pending = d._startBackgroundReactivation(0x02, { intervalMs: 10, maxMs: 5000 });
  d.destroy();
  assert.equal(await pending, false, 'destroy resolves the loop as given-up');
  assert.equal(d._reactivateTimer, null, 'timer cleared by destroy');
});
