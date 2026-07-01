// ============================================================
// Yaw return-to-neutral heading math (issue #88)
// ============================================================
//
// Locks the Steam Controller yaw-drift fix: recenter zeroes only the heading
// (yaw), the at-rest return decays displayed yaw toward zero, and pitch/roll
// pass through untouched. Pure math — no three, so it runs in the dependency-
// free core CI job.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  twistAngleY,
  wrapPi,
  stepYawReturn,
  composeHeadingOffset,
} from '../src/yaw-return.js';

// ── tiny quaternion helpers (avoid a three dependency) ──
const qY = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const qX = (a) => ({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) });
// Hamilton product q1 * q2.
function mul(q1, q2) {
  return {
    w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
    x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
    y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
    z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
  };
}
const near = (a, b, eps = 1e-9) => Math.abs(wrapPi(a - b)) <= eps;

test('twistAngleY reads the heading of a pure yaw rotation', () => {
  assert.ok(near(twistAngleY(qY(0.5)), 0.5));
  assert.ok(near(twistAngleY(qY(-1.2)), -1.2));
  assert.ok(near(twistAngleY(qX(0.7)), 0)); // a pure pitch has zero heading
});

test('wrapPi folds angles into (-π, π]', () => {
  assert.ok(near(wrapPi(3 * Math.PI), Math.PI));
  assert.ok(near(wrapPi(-3 * Math.PI), Math.PI));
  assert.ok(near(wrapPi(0.3), 0.3));
});

test('composeHeadingOffset with refYaw = heading zeroes the displayed yaw', () => {
  const o = qY(0.9);
  const out = {};
  composeHeadingOffset(out, twistAngleY(o), o);
  assert.ok(near(twistAngleY(out), 0));
});

test('composeHeadingOffset removes only yaw — pitch/roll pass through', () => {
  // orientation = yaw(0.5) then pitch(0.3). Removing its heading must leave the
  // pure pitch rotation qX(0.3): proves a world-Y offset never disturbs tilt.
  const pitch = 0.3;
  const o = mul(qY(0.5), qX(pitch));
  const refYaw = twistAngleY(o);
  assert.ok(near(refYaw, 0.5), 'heading of yaw·pitch is the yaw angle');

  const out = {};
  composeHeadingOffset(out, refYaw, o);

  const expected = qX(pitch);
  assert.ok(Math.abs(out.x - expected.x) < 1e-9, 'pitch (x) preserved');
  assert.ok(Math.abs(out.y - expected.y) < 1e-9, 'yaw (y) removed');
  assert.ok(Math.abs(out.z - expected.z) < 1e-9);
  assert.ok(Math.abs(out.w - expected.w) < 1e-9);
  assert.ok(near(twistAngleY(out), 0), 'displayed heading is centered');
});

test('stepYawReturn decays displayed yaw toward zero at rest', () => {
  const o = qY(1.0); // 1 rad of drifted heading
  const halfLife = 0.5;
  const dt = 1 / 60;
  let refYaw = 0;

  // One half-life of decay should roughly halve the displayed yaw.
  let elapsed = 0;
  while (elapsed < halfLife) { refYaw = stepYawReturn(refYaw, o, dt, halfLife); elapsed += dt; }
  const afterHalf = wrapPi(twistAngleY(o) - refYaw);
  assert.ok(Math.abs(afterHalf) < 0.6 && Math.abs(afterHalf) > 0.4,
    `~half after one half-life, got ${afterHalf.toFixed(3)}`);

  // Several more half-lives: displayed yaw converges to ~0.
  for (let i = 0; i < 60 * 5; i++) refYaw = stepYawReturn(refYaw, o, dt, halfLife);
  const settled = wrapPi(twistAngleY(o) - refYaw);
  assert.ok(Math.abs(settled) < 0.02, `converges to center, got ${settled.toFixed(4)}`);

  // The raw orientation is never mutated — only the offset moves.
  assert.ok(near(twistAngleY(o), 1.0), 'raw heading untouched');
});

test('stepYawReturn is a no-op when disabled (halfLife 0) or dt ≤ 0', () => {
  const o = qY(0.8);
  assert.equal(stepYawReturn(0.25, o, 1 / 60, 0), 0.25, 'halfLife 0 → off');
  assert.equal(stepYawReturn(0.25, o, 0, 0.5), 0.25, 'dt 0 → no step');
  assert.equal(stepYawReturn(0.25, o, -0.1, 0.5), 0.25, 'negative dt → no step');
});
