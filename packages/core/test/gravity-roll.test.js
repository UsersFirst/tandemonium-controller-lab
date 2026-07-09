// ============================================================
// rollFromGravity — drift-free bank angle, sign + yaw-immunity locked (#314)
// ============================================================
//
// This is the game's steering axis, so the sign and axis MUST be right. These
// tests pin (a) that it matches the -EulerZ convention the game already steers
// by — so switching the game's default 'gravity' mode onto it doesn't invert
// steering — and (b) the whole point of the change: the value is independent of
// yaw (heading), which is what stops the "fuses to one side" drift.
//
// Three-free (the core test job runs without npm install): quaternion math is
// done with plain {x,y,z,w} objects. See [[multi-steam-controller]].

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rollFromGravity } from '../src/gravity-roll.js';

const DEG = 180 / Math.PI;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── Minimal quaternion helpers (no three) ──
function qAxis(ax, ay, az, ang) { const h = ang / 2, s = Math.sin(h); return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) }; }
function qMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
const qConj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
function rot(q, v) { // rotate vector v by quaternion q: q·v·q⁻¹
  const p = { x: v.x, y: v.y, z: v.z, w: 0 };
  const r = qMul(qMul(q, p), qConj(q));
  return { x: r.x, y: r.y, z: r.z };
}
const Rx = (a) => qAxis(1, 0, 0, a), Ry = (a) => qAxis(0, 1, 0, a), Rz = (a) => qAxis(0, 0, 1, a);
const DOWN = { x: 0, y: -1, z: 0 };
// SensorFusion's _gravityVec = orientation⁻¹ · worldDown (gravity in the local frame).
const gravLocal = (orientation) => rot(qConj(orientation), DOWN);

test('at rest (down = (0,-1,0)) → roll 0', () => {
  assert.equal(rollFromGravity(0, -1), 0);
});

test('pure roll φ → -φ (matches the -EulerZ steering convention, drop-in)', () => {
  for (const deg of [-80, -45, -20, -5, 0, 5, 20, 45, 80]) {
    const phi = deg / DEG;
    const g = gravLocal(Rz(phi));              // orientation = R_z(φ)
    assert.ok(approx(rollFromGravity(g.x, g.y), -phi), `roll ${deg}° → ${-deg}° (got ${(rollFromGravity(g.x, g.y) * DEG).toFixed(3)})`);
  }
});

test('YAW-IMMUNE: roll is identical at every heading (the fix for "fuses to one side")', () => {
  const phi = 30 / DEG;
  const expected = -phi;
  for (const yawDeg of [0, 30, 90, 175, 250, 359]) {
    const orientation = qMul(Ry(yawDeg / DEG), Rz(phi)); // yaw ∘ roll
    const g = gravLocal(orientation);
    assert.ok(approx(rollFromGravity(g.x, g.y), expected),
      `yaw ${yawDeg}° must not change roll (got ${(rollFromGravity(g.x, g.y) * DEG).toFixed(3)}°, want ${(expected * DEG).toFixed(3)}°)`);
  }
});

test('drift immunity: a large accumulated yaw does not move roll', () => {
  // Simulate 5 full turns of yaw drift on top of a 15° roll — Euler-Z would have
  // wandered; gravity-roll must not budge.
  const phi = 15 / DEG;
  const g0 = gravLocal(Rz(phi));
  const gDrifted = gravLocal(qMul(Ry(5 * 2 * Math.PI + 1.234), Rz(phi)));
  assert.ok(approx(rollFromGravity(g0.x, g0.y), rollFromGravity(gDrifted.x, gDrifted.y)));
});

test('pure pitch θ → roll 0 (pitch does not leak into roll)', () => {
  for (const deg of [-60, -30, -5, 0, 5, 30, 60]) {
    const g = gravLocal(Rx(deg / DEG));
    assert.ok(approx(rollFromGravity(g.x, g.y), 0), `pitch ${deg}° → roll 0 (got ${(rollFromGravity(g.x, g.y) * DEG).toFixed(3)}°)`);
  }
});

test('sign: rolling right and left are opposite and symmetric', () => {
  const gr = gravLocal(Rz(20 / DEG));
  const gl = gravLocal(Rz(-20 / DEG));
  const r = rollFromGravity(gr.x, gr.y);
  const l = rollFromGravity(gl.x, gl.y);
  assert.ok(r < 0 && l > 0 && approx(r, -l), `right=${(r * DEG).toFixed(2)}° left=${(l * DEG).toFixed(2)}° should be opposite`);
});
