import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrackpad } from '../src/trackpad-math.js';

const R = 32768; // int16 half-scale

test('raw (0,0) maps to pad center (0.5, 0.5)', () => {
  assert.deepEqual(normalizeTrackpad(0, 0, R), { fx: 0.5, fy: 0.5 });
});

test('extremes map to pad edges and clamp out-of-range', () => {
  assert.equal(normalizeTrackpad(-R, 0, R).fx, 0);
  assert.equal(normalizeTrackpad(32767, 0, R).fx, 65535 / 65536);
  // beyond ±range clamps to [0,1]
  assert.deepEqual(normalizeTrackpad(-50000, 50000, R), { fx: 0, fy: 1 });
});

test('invertX / invertY mirror around the center', () => {
  // raw +half → 0.75; invertX → 0.25
  assert.ok(Math.abs(normalizeTrackpad(R / 2, 0, R, { invertX: true }).fx - 0.25) < 1e-9);
  assert.ok(Math.abs(normalizeTrackpad(0, R / 2, R, { invertY: true }).fy - 0.25) < 1e-9);
});

test('swapXY exchanges the two axes', () => {
  const s = normalizeTrackpad(32767, -R, R, { swapXY: true });
  // pre-swap fx≈1, fy=0 → swapped → fx=0, fy≈1
  assert.equal(s.fx, 0);
  assert.ok(s.fy > 0.99);
});

test('inversion composes with swap (swap applied last)', () => {
  // raw (R/2, 0): fx=0.75, fy=0.5; invertX → fx=0.25; swap → {fx:0.5, fy:0.25}
  const r = normalizeTrackpad(R / 2, 0, R, { invertX: true, swapXY: true });
  assert.ok(Math.abs(r.fx - 0.5) < 1e-9);
  assert.ok(Math.abs(r.fy - 0.25) < 1e-9);
});
