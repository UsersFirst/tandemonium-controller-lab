// ============================================================
// SteamControllerDriver — trackpad parse, driven by a real capture
// ============================================================
//
// Replays an actual Steam Controller Puck (28de:1304) HID capture through
// parseReport and asserts the two trackpads are decoded from the 0x45 STATE
// report: left pad X@17 Y@19 area@21, right pad X@23 Y@25 area@27 (int16 LE).
//
// The fixture is a trimmed, downsampled slice of a Test Report capture (the
// `at-rest` and `touchpad` steps) — see issue #43. The at-rest step is the
// regression guard: if an offset is wrong/swapped, the pads would show phantom
// touches when nothing is being touched.

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
const stepReports = (id) => fixture.steps.find((s) => s.id === id)?.reports ?? [];

function parseAll(reports) {
  // Each report carries the same productId as the captured device.
  const d = new SteamControllerDriver(
    { opened: true, collections: [], productId: 0x1304 }, 'usb', null,
  );
  const out = [];
  for (const rep of reports) {
    const p = d.parseReport(rep.reportId, dataView(bytesFromHex(rep.bytes)));
    if (p) out.push(p); // non-STATE ids (0x7b/0x43/…) parse to null; skip them
  }
  return out;
}

const S16_MAX = 32767;
const S16_MIN = -32768;

test('fixture sanity: at-rest + touchpad steps present with reports', () => {
  assert.ok(stepReports('touchpad').length > 100, 'touchpad step has reports');
  assert.ok(stepReports('at-rest').length > 10, 'at-rest step has reports');
});

test('touchpad step: both trackpads register active touches, coords in int16 range', () => {
  const parsed = parseAll(stepReports('touchpad'));
  assert.ok(parsed.length > 100, 'expected STATE reports to parse');

  let leftActive = 0;
  let rightActive = 0;
  for (const p of parsed) {
    assert.ok(Array.isArray(p.touchpad) && p.touchpad.length === 2, 'two trackpads');
    const [l, r] = p.touchpad;
    for (const pad of [l, r]) {
      assert.ok(pad.x >= S16_MIN && pad.x <= S16_MAX, 'x in int16 range');
      assert.ok(pad.y >= S16_MIN && pad.y <= S16_MAX, 'y in int16 range');
      assert.ok(pad.area >= 0, 'area is unsigned');
      assert.equal(pad.active, pad.area > 0, 'active iff contact area > 0');
    }
    if (l.active) leftActive++;
    if (r.active) rightActive++;
  }
  assert.ok(leftActive > 20, `left pad saw touches (${leftActive})`);
  assert.ok(rightActive > 20, `right pad saw touches (${rightActive})`);
});

test('touchpad step: active touches span a real coordinate range (offset sanity)', () => {
  const parsed = parseAll(stepReports('touchpad'));
  const range = (a) => Math.max(...a) - Math.min(...a);
  for (const idx of [0, 1]) {
    const xs = [];
    const ys = [];
    for (const p of parsed) {
      const pad = p.touchpad[idx];
      if (pad.active) { xs.push(pad.x); ys.push(pad.y); }
    }
    assert.ok(xs.length > 20, `pad ${idx} has active samples`);
    // A wrong/swapped offset would pin an axis near a constant — real drags
    // sweep thousands of int16 counts.
    assert.ok(range(xs) > 5000, `pad ${idx} X spans a real range`);
    assert.ok(range(ys) > 5000, `pad ${idx} Y spans a real range`);
  }
});

test('touchpad step: light touches/slides never register a click', () => {
  // The touchpad step is finger-sliding only — pressure stays well below the
  // click threshold, so no pad should report `clicked` (issue #53).
  const parsed = parseAll(stepReports('touchpad'));
  let clicks = 0;
  for (const p of parsed) for (const pad of p.touchpad) if (pad.clicked) clicks++;
  assert.equal(clicks, 0, `no clicks during a pure touch/slide (saw ${clicks})`);
});

test('system-buttons step: a hard left-pad press registers a click', () => {
  // This step contains a deliberate hard left-pad press (pressure saturating
  // up to int16 max). The right pad is never hard-pressed in this capture.
  const parsed = parseAll(stepReports('system-buttons'));
  let leftClicks = 0;
  for (const p of parsed) {
    const [l, r] = p.touchpad;
    if (l.clicked) {
      leftClicks++;
      // A click implies contact and a pressure at/above the threshold.
      assert.ok(l.active, 'a clicked pad is also active (touching)');
      assert.ok(l.area >= 4000, `click pressure at/above threshold (${l.area})`);
    }
    // Whatever the state, clicked must never be set without contact.
    for (const pad of [l, r]) {
      if (pad.clicked) assert.ok(pad.active, 'clicked never set without contact');
    }
  }
  assert.ok(leftClicks > 0, `left pad registered a hard-press click (${leftClicks})`);
});

test('at-rest step: trackpads read inactive (no phantom touches from a bad offset)', () => {
  const parsed = parseAll(stepReports('at-rest'));
  assert.ok(parsed.length > 10, 'expected at-rest STATE reports');
  let active = 0;
  for (const p of parsed) for (const pad of p.touchpad) if (pad.active) active++;
  assert.ok(
    active <= parsed.length * 0.02,
    `pads should be inactive at rest (saw ${active} active across ${parsed.length} reports)`,
  );
});
