// ============================================================
// RollZero — what counts as level, and when it may be taken (#112)
// ============================================================
//
// Three-free (the core test job runs without npm install). Samples arrive at
// 100 Hz unless a test says otherwise; time is the test's own clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RollZero, wrapAngle,
  ROLL_ZERO_WINDOW_MS, ROLL_ZERO_STILL_SPREAD_RAD, ROLL_ZERO_DEFAULT_TIMEOUT_MS,
} from '../src/roll-zero.js';

const DEG = Math.PI / 180;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** Feed `ms` of samples at 100 Hz from a roll function of time; returns the results decided on the way. */
function feed(z, clock, ms, rollAt) {
  const out = [];
  const end = clock.t + ms;
  while (clock.t < end) {
    clock.t += 10;
    const r = z.sample(rollAt(clock.t), clock.t);
    if (r) out.push(r);
  }
  return out;
}
const hold = (deg) => () => deg * DEG;
/** A hand that never steadies: a 10 degree swing at 2 Hz around `deg`. */
const swing = (deg, amp = 10) => (t) => (deg + amp * Math.sin(t / 1000 * 2 * Math.PI * 2)) * DEG;

test('no zero yet: relative() is the roll itself', () => {
  const z = new RollZero();
  assert.equal(z.zero, null);
  assert.ok(near(z.relative(12 * DEG), 12 * DEG));
});

test('set() while held still takes the mean of the window and says it was still', () => {
  const z = new RollZero(), clock = { t: 0 };
  // a small tremor around 8 degrees, inside the still spread
  feed(z, clock, 600, (t) => (8 + 0.3 * Math.sin(t / 20)) * DEG);
  assert.equal(z.still, true);
  const r = z.set();
  assert.equal(r.source, 'now');
  assert.equal(r.still, true);
  assert.equal(r.changed, true);
  assert.ok(Math.abs(r.zero - 8 * DEG) < 0.2 * DEG, `zero ${(r.zero / DEG).toFixed(2)} is about 8`);
  assert.ok(r.spread <= ROLL_ZERO_STILL_SPREAD_RAD);
  assert.ok(Math.abs(z.relative(8 * DEG)) < 0.2 * DEG, 'the held pose now reads level');
  assert.ok(Math.abs(z.relative(28 * DEG) - 20 * DEG) < 0.2 * DEG, 'a 20 degree lean from it reads 20');
  assert.equal(z.last, r);
});

test('set() while moving commits the latest roll and says it was NOT still', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 600, swing(0));
  assert.equal(z.still, false);
  const r = z.set();
  assert.equal(r.still, false, 'a zero taken mid-motion is reported, not silent');
  assert.ok(r.spread > ROLL_ZERO_STILL_SPREAD_RAD);
  assert.ok(near(r.zero, swing(0)(clock.t)), 'it is the roll at that moment');
});

test('set() before the window fills is not called still', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 100, hold(5));       // 10 samples, but only 100 ms of the 400 ms window
  assert.equal(z.still, false);
  const r = z.set();
  assert.equal(r.still, false);
  assert.ok(near(r.zero, 5 * DEG));
});

test('request(): the countdown case. Tilted and moving, then steady: the zero is the steady pose', () => {
  const z = new RollZero(), clock = { t: 0 };
  const results = [];
  z.onResult = (r) => results.push(r);
  feed(z, clock, 500, hold(0));
  z.set();                            // an old zero at 0
  results.length = 0;

  z.request({ timeoutMs: 3000 });
  assert.equal(z.pending, true);
  // 1 s of getting a grip: the roll swings around 15 degrees
  const during = feed(z, clock, 1000, swing(15));
  assert.equal(during.length, 0, 'nothing is decided while the controller moves');
  assert.ok(near(z.zero, 0), 'the old zero stays in force meanwhile');
  // then the player settles at 6 degrees
  const after = feed(z, clock, 1000, hold(6));
  assert.equal(after.length, 1);
  const r = after[0];
  assert.equal(r.source, 'still');
  assert.equal(r.still, true);
  assert.ok(Math.abs(r.zero - 6 * DEG) < 0.5 * DEG, `zero ${(r.zero / DEG).toFixed(2)} is the settled pose, not the swing`);
  assert.equal(z.pending, false);
  assert.deepEqual(results, [r], 'onResult heard it once');
});

test('request() on a controller already at rest is decided on the next sample', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 600, hold(-4));
  z.request();
  const out = feed(z, clock, 10, hold(-4));
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'still');
  assert.ok(near(out[0].zero, -4 * DEG, 1e-9));
});

test('request() that never sees a still moment: fallback best uses the steadiest window and says so', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 500, hold(0));
  z.set();
  z.request({ timeoutMs: 2000 });      // fallback defaults to best
  // a big swing, with one calmer stretch (3 degrees of movement) around 9 degrees
  const out = feed(z, clock, 2200, (t) => (t > 1200 && t < 1900 ? (9 + 1.5 * Math.sin(t / 30)) : (9 + 12 * Math.sin(t / 60))) * DEG);
  assert.equal(out.length, 1);
  const r = out[0];
  assert.equal(r.source, 'best');
  assert.equal(r.still, false);
  assert.ok(r.spread > ROLL_ZERO_STILL_SPREAD_RAD && r.spread < 4 * DEG, `spread ${(r.spread / DEG).toFixed(2)} is the calm stretch's`);
  assert.ok(Math.abs(r.zero - 9 * DEG) < 1.5 * DEG, `zero ${(r.zero / DEG).toFixed(2)} came from the calm stretch`);
});

test('request() with fallback keep: no still moment leaves the old zero, and reports kept', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 500, hold(3));
  const first = z.set();
  z.request({ timeoutMs: 1000, fallback: 'keep' });
  const out = feed(z, clock, 1200, swing(20));
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'kept');
  assert.equal(out[0].changed, false);
  assert.equal(out[0].still, false);
  assert.ok(near(z.zero, first.zero), 'the zero did not move');
  assert.equal(z.last, first, '`last` still describes the zero in force');
  assert.equal(z.pending, false);
});

test('the request timeout counts from the first sample after it, not from the call', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 500, swing(0));
  z.request({ timeoutMs: 1000, fallback: 'keep' });
  clock.t += 5000;                      // the stream stalled (a reconnect) before any sample
  const out = feed(z, clock, 900, swing(0));
  assert.equal(out.length, 0, 'not timed out by the gap');
  assert.equal(feed(z, clock, 200, swing(0)).length, 1);
});

test('set() and cancelRequest() end a pending request', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 500, swing(0));
  z.request();
  z.set();
  assert.equal(z.pending, false);
  z.request();
  z.cancelRequest();
  assert.equal(z.pending, false);
  assert.equal(feed(z, clock, ROLL_ZERO_DEFAULT_TIMEOUT_MS + 500, hold(2)).length, 0, 'a cancelled request decides nothing');
});

test('clear() forgets the zero', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 500, hold(7));
  z.set();
  const r = z.clear();
  assert.equal(r.source, 'cleared');
  assert.equal(z.zero, null);
  assert.ok(near(z.relative(7 * DEG), 7 * DEG));
});

test('setTo() takes a given zero', () => {
  const z = new RollZero();
  const r = z.setTo(10 * DEG, 123);
  assert.equal(r.source, 'given');
  assert.equal(r.at, 123);
  assert.ok(near(z.relative(15 * DEG), 5 * DEG));
});

test('resetWindow(): the jump after a fusion reset is neither movement nor a still window', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 600, hold(12));
  z.set();
  z.request({ timeoutMs: 3000 });
  z.resetWindow();                      // fusion.reset(): gravity restarts at straight down
  assert.equal(z.still, false, 'old samples do not vouch for the new pose');
  // gravity converges from 0 back to 12 degrees over 300 ms, then holds
  const out = feed(z, clock, 1200, (t) => Math.min(12, (t - 600) / 300 * 12) * DEG);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'still');
  assert.ok(Math.abs(out[0].zero - 12 * DEG) < 0.5 * DEG, 'the zero is the converged pose, not a point on the way');
  assert.ok(near(z.zero, out[0].zero));
});

test('a window that straddles ±180 degrees is still, and its mean is on the seam', () => {
  const z = new RollZero(), clock = { t: 0 };
  // upside-down hold, jittering across the wrap
  feed(z, clock, 600, (t) => wrapAngle((180 + 0.4 * Math.sin(t / 20)) * DEG));
  assert.equal(z.still, true);
  const r = z.set();
  assert.ok(Math.abs(Math.abs(r.zero) - Math.PI) < 0.5 * DEG, `zero ${(r.zero / DEG).toFixed(2)} is near ±180`);
  assert.ok(Math.abs(z.relative(wrapAngle(-170 * DEG)) - 10 * DEG) < 0.5 * DEG, 'relative() wraps across the seam');
});

test('relative() is wrapped to (-π, π]', () => {
  const z = new RollZero();
  z.setTo(170 * DEG);
  assert.ok(near(z.relative(-170 * DEG), 20 * DEG, 1e-9));
  z.setTo(-170 * DEG);
  assert.ok(near(z.relative(170 * DEG), -20 * DEG, 1e-9));
  assert.ok(near(wrapAngle(Math.PI), Math.PI) && near(wrapAngle(-Math.PI), Math.PI) && near(wrapAngle(3 * Math.PI), Math.PI));
});

test('a clock that goes backwards starts the window again', () => {
  const z = new RollZero(), clock = { t: 100000 };
  feed(z, clock, 600, hold(5));
  assert.equal(z.still, true);
  clock.t = 0;                          // a new time base
  feed(z, clock, 50, hold(40));
  assert.equal(z.still, false, 'old-clock samples are gone');
  feed(z, clock, 500, hold(40));
  assert.equal(z.still, true);
  assert.ok(near(z.set().zero, 40 * DEG, 1e-9));
});

test('non-finite samples are ignored', () => {
  const z = new RollZero(), clock = { t: 0 };
  feed(z, clock, 600, hold(5));
  assert.equal(z.sample(NaN, clock.t + 10), null);
  assert.equal(z.sample(1, NaN), null);
  assert.equal(z.still, true);
  assert.ok(near(z.set().zero, 5 * DEG, 1e-9));
});

test('a slow sample rate (30 Hz, a Bluetooth pad) can still be still', () => {
  const z = new RollZero();
  let t = 0;
  for (let i = 0; i < 30; i++) { t += 33; z.sample(2 * DEG, t); }
  assert.equal(z.still, true, `${Math.round(ROLL_ZERO_WINDOW_MS / 33)} samples fit the window`);
});

test('a listener that throws does not break the zero', () => {
  const z = new RollZero(), clock = { t: 0 };
  z.onResult = () => { throw new Error('listener'); };
  feed(z, clock, 600, hold(1));
  assert.doesNotThrow(() => z.set());
  assert.ok(near(z.zero, 1 * DEG, 1e-9));
});

// ── Two rolls: the steering roll and the accelerometer's own (rest) roll ──

test('after a fusion reset the steering roll crawls, but the zero is the rest roll, not a point on the way', () => {
  const z = new RollZero(), clock = { t: 0 };
  z.request({ timeoutMs: 3000 });
  // held steady at 30 degrees. The steering roll starts at 0 and barely moves for 400 ms (it would
  // look still by itself), then comes back slowly; the accelerometer reads 30 the whole time.
  const out = [];
  while (clock.t < 600) {
    clock.t += 10;
    const steering = clock.t < 400 ? 0.2 * DEG : Math.min(30, (clock.t - 400) / 50) * DEG;
    const r = z.sample(steering, clock.t, 30 * DEG);
    if (r) out.push(r);
  }
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'still');
  assert.ok(near(out[0].zero, 30 * DEG, 1e-9), `zero ${(out[0].zero / DEG).toFixed(2)} is the real pose`);
});

test('the steering roll steady while the rest roll moves is not still', () => {
  const z = new RollZero(), clock = { t: 0 };
  while (clock.t < 600) { clock.t += 10; z.sample(5 * DEG, clock.t, (5 + clock.t / 50) * DEG); }
  assert.equal(z.still, false);
  const r = z.set();
  assert.equal(r.still, false);
  assert.ok(near(r.zero, 5 * DEG, 1e-9), 'taken while moving, it is the steering roll');
});

test('a window with an untrusted accelerometer (NaN rest roll) is never still', () => {
  const z = new RollZero(), clock = { t: 0 };
  z.request({ timeoutMs: 1000, fallback: 'keep' });
  const out = [];
  while (clock.t < 1200) {
    clock.t += 10;
    const r = z.sample(5 * DEG, clock.t, clock.t % 200 === 0 ? NaN : 5 * DEG);
    if (r) out.push(r);
  }
  assert.equal(z.still, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'kept');
  // and it recovers once the accelerometer is trusted for a whole window
  while (clock.t < 1800) { clock.t += 10; z.sample(5 * DEG, clock.t, 5 * DEG); }
  assert.equal(z.still, true);
});

test('fallback best is measured on the steering roll', () => {
  const z = new RollZero(), clock = { t: 0 };
  z.request({ timeoutMs: 1000 });
  const out = [];
  while (clock.t < 1200) {
    clock.t += 10;
    // never still by the rest roll; the steering roll sits near 12 with a 4 degree wobble
    const r = z.sample((12 + 2 * Math.sin(clock.t / 40)) * DEG, clock.t, (12 + 8 * Math.sin(clock.t / 40)) * DEG);
    if (r) out.push(r);
  }
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'best');
  assert.equal(out[0].still, false);
  assert.ok(Math.abs(out[0].zero - 12 * DEG) < 1.5 * DEG);
  assert.ok(out[0].spread <= 4.1 * DEG, 'the spread reported is the steering roll one');
});
