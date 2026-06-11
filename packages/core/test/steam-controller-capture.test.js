// ============================================================
// SteamControllerDriver — full parse validated against a real capture
// ============================================================
//
// Replays a real Steam Controller Puck (28de:1304) Test Report capture and
// asserts the whole STATE-report parse against ground truth: each scripted
// wizard step exercised a known set of inputs, so every mapped button / dpad
// direction / paddle must register in ≥1 parsed report, the analog triggers
// must reach full pull, both sticks must sweep the full range, and the IMU
// must read zero-bias + 1g gravity at rest (and respond when rotated).
//
// This is the regression guard for the bit/offset map in parseReport — a
// flipped bit or wrong offset would drop one of these. (Trackpad coverage is
// in steam-controller-trackpads.test.js; report-id gating in
// steam-controller-driver.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SteamControllerDriver } from '../src/drivers/steam-controller-driver.js';
import { bytesFromHex, dataView } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'steam-controller-puck_28de-1304.json'), 'utf8'),
);

function parseStep(id) {
  const reports = fixture.steps.find((s) => s.id === id)?.reports ?? [];
  const d = new SteamControllerDriver(
    { opened: true, collections: [], productId: 0x1304 }, 'usb', null,
  );
  return reports
    .map((r) => d.parseReport(r.reportId, dataView(bytesFromHex(r.bytes))))
    .filter(Boolean); // non-STATE reports (0x7b/0x43) parse to null
}

const firedCount = (parsed, key) =>
  parsed.filter((p) => p.buttons?.[key] || p.paddles?.[key]).length;
const axisRange = (parsed, sel) => {
  let mn = Infinity; let mx = -Infinity;
  for (const p of parsed) { const v = sel(p); if (v < mn) mn = v; if (v > mx) mx = v; }
  return mx - mn;
};
const mag = (v) => Math.hypot(v.x, v.y, v.z);
const avg = (arr) => arr.reduce((a, x) => a + x, 0) / arr.length;

test('face-buttons step: A / B / X / Y all register', () => {
  const p = parseStep('face-buttons');
  for (const k of ['cross', 'circle', 'square', 'triangle']) {
    assert.ok(firedCount(p, k) > 0, `${k} should register`);
  }
});

test('system-buttons step: Steam / View / Menu all register', () => {
  const p = parseStep('system-buttons');
  for (const k of ['ps', 'create', 'options']) {
    assert.ok(firedCount(p, k) > 0, `${k} should register`);
  }
});

test('dpad step: all four directions register', () => {
  const p = parseStep('dpad');
  for (const k of ['dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight']) {
    assert.ok(firedCount(p, k) > 0, `${k} should register`);
  }
});

test('triggers-shoulders step: L2/R2 reach full pull and L1 registers', () => {
  const p = parseStep('triggers-shoulders');
  assert.ok(Math.max(...p.map((x) => x.triggers.l2)) > 0.8, 'L2 reaches near-full pull');
  assert.ok(Math.max(...p.map((x) => x.triggers.r2)) > 0.8, 'R2 reaches near-full pull');
  assert.ok(firedCount(p, 'l1') > 0, 'L1 should register');
  // Note: R1 was not pressed in this capture, so it is intentionally unasserted.
});

test('sticks step: both sticks sweep the full analog range', () => {
  const p = parseStep('sticks');
  const axes = [
    (x) => x.sticks.lx, (x) => x.sticks.ly,
    (x) => x.sticks.rx, (x) => x.sticks.ry,
  ];
  for (const sel of axes) {
    assert.ok(axisRange(p, sel) > 1.5, 'axis spans most of [-1, 1]');
  }
});

test('back-paddles step: all four paddles register', () => {
  const p = parseStep('back-paddles');
  for (const k of ['l4', 'l5', 'r4', 'r5']) {
    assert.ok(firedCount(p, k) > 0, `paddle ${k} should register`);
  }
});

test('at-rest step: no buttons, IMU at zero-bias with 1g gravity', () => {
  const p = parseStep('at-rest');
  assert.ok(p.length > 10, 'expected at-rest STATE reports');
  // No face/dpad/system button should be pressed at rest.
  assert.ok(
    p.every((x) => !Object.values(x.buttons).some(Boolean)),
    'no button should register at rest',
  );
  // Accel magnitude ≈ 1g (raw 16384 at ±2g/16-bit) — gravity vector present.
  const accelAvg = avg(p.map((x) => mag(x.accel)));
  assert.ok(accelAvg > 14000 && accelAvg < 18000, `accel ≈ 1g (got ${Math.round(accelAvg)})`);
  // Gyro near zero at rest (raw counts) — no bias drift.
  const gyroAvg = avg(p.map((x) => mag(x.gyro)));
  assert.ok(gyroAvg < 100, `gyro near zero-bias at rest (got ${gyroAvg.toFixed(1)})`);
});

test('pitch step: gyro responds strongly vs at-rest', () => {
  const rest = avg(parseStep('at-rest').map((x) => mag(x.gyro)));
  const pitch = avg(parseStep('pitch').map((x) => mag(x.gyro)));
  assert.ok(pitch > rest * 10, `gyro magnitude rises when rotated (rest ${rest.toFixed(1)}, pitch ${pitch.toFixed(1)})`);
});
