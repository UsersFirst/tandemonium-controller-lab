// #822 · a ride-start calibration in the hand must not replace a bias taken at rest.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';

// SensorFusion needs three, which this package's CI deliberately does not install.
let SensorFusion = null;
try { ({ SensorFusion } = await import('../src/sensor-fusion.js')); } catch { /* no three */ }
const test = (name, fn) => nodeTest(name, { skip: !SensorFusion && 'needs three' }, fn);

const GS = 2000 / 32768, AS = 1 / 16384, MS = 1000 / 240;
let seed = 3;
const rnd = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647 - 0.5; };
// Uniform noise with this standard deviation.
const noise = (sd) => rnd() * sd * Math.sqrt(12);
const swing = (i) => { const r = Math.sin(i / 240) * 0.6; return [Math.sin(r) * 16384, Math.cos(r) * 16384, 0]; };

function rig() {
  const f = new SensorFusion();
  let t = 1000;
  const feed = (n, mean, sd, accel = () => [0, 16384, 0]) => {
    for (let i = 0; i < n; i++) {
      t += MS;
      const a = accel(i);
      f.ingest(mean + noise(sd), mean + noise(sd), mean + noise(sd), a[0], a[1], a[2], GS, AS, t);
    }
  };
  const calibrate = (mean, sd) => {
    f.startCalibration('usb');
    feed(151, mean, sd);
    assert.equal(f.calibrating, false);
  };
  return { f, feed, calibrate };
}
const near = (v, want, tol, what) =>
  assert.ok(Math.abs(v - want) <= tol, `${what}: ${v.toFixed(2)}, wanted ${want} +-${tol}`);

test('the first calibration is taken as it is today', () => {
  const { f, calibrate } = rig();
  calibrate(40, 60);
  near(f.bias.x, 40, 15, 'bias');
});

test('an in-hand window does not replace a bias taken at rest', () => {
  const { f, calibrate } = rig();
  calibrate(2, 4);
  const before = f.bias.y;
  calibrate(50, 70);
  assert.equal(f.bias.y, before);
});

test('a window that is kept ends calibration at once, with no retries', () => {
  const { f, feed, calibrate } = rig();
  calibrate(2, 4);
  f.startCalibration('usb');
  feed(150, 50, 400);
  assert.equal(f.calibrating, false);
});

test('an equally quiet window still replaces the bias', () => {
  const { f, calibrate } = rig();
  calibrate(2, 4);
  calibrate(20, 4.5);
  near(f.bias.x, 20, 2, 'bias');
});

test('a quieter window replaces a bias first taken in the hand', () => {
  const { f, calibrate } = rig();
  calibrate(40, 70);
  calibrate(3, 4);
  near(f.bias.x, 3, 2, 'bias');
});

test('resetBias() forgets the quality, so the next window is taken', () => {
  const { f, calibrate } = rig();
  calibrate(2, 4);
  f.resetBias();
  calibrate(40, 60);
  near(f.bias.x, 40, 15, 'bias');
});

test('stillness refinement still follows a slow change in bias', () => {
  const { f, feed, calibrate } = rig();
  calibrate(2, 2);
  feed(240 * 20, 12, 2);
  near(f.bias.x, 12, 1, 'bias');
});

test('rest vouches for a bias, so a later in-hand window cannot replace it', () => {
  const { f, feed, calibrate } = rig();
  calibrate(40, 70);
  feed(240 * 20, 3, 2);
  near(f.bias.x, 3, 1, 'bias after rest');
  const before = f.bias.x;
  calibrate(50, 60);
  near(f.bias.x, before, 0.5, 'bias after in-hand window');
});

test('in-motion refinement stays near a bias taken at rest', () => {
  const { f, feed, calibrate } = rig();
  calibrate(0, 3);
  const c = { ...f.bias };
  // The accelerometer swings while the gyro reports another rate: refinement sees a large "bias".
  feed(240 * 8, 160, 3, swing);
  const limit = 0.5 / GS + 1e-6;
  for (const k of 'xyz') assert.ok(Math.abs(f.bias[k] - c[k]) <= limit, `${k} moved ${((f.bias[k] - c[k]) * GS).toFixed(2)} dps`);
});

test('in-motion refinement is not bounded without a bias from rest', () => {
  const { f, feed } = rig();
  feed(240 * 8, 160, 3, swing);
  assert.ok(Math.hypot(f.bias.x, f.bias.y, f.bias.z) * GS > 0.5, 'refinement ran');
});
