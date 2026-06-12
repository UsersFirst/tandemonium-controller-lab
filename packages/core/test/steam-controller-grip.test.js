// ============================================================
// SteamControllerDriver — capacitive grip sensors (GripSense, #44)
// ============================================================
//
// Replays a real Steam Controller Puck (28de:1304) grip-sense capture (squeeze
// left grip, then right) and asserts both register. Grip flags live in byte 4:
// 0x20 = left, 0x10 = right (digital, no pressure) — identified by correlating
// each bit against which grip was squeezed in this capture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SteamControllerDriver } from '../src/drivers/steam-controller-driver.js';
import { bytesFromHex, dataView } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'steam-controller-puck-grip_28de-1304.json'), 'utf8'),
);

function parseStep(id) {
  const reports = fixture.steps.find((s) => s.id === id)?.reports ?? [];
  const d = new SteamControllerDriver(
    { opened: true, collections: [], productId: 0x1304 }, 'usb', null,
  );
  return reports
    .map((r) => d.parseReport(r.reportId, dataView(bytesFromHex(r.bytes))))
    .filter(Boolean);
}

test('grip-sense step: both capacitive grips register', () => {
  const p = parseStep('grip-sense');
  assert.ok(p.length > 20, 'expected STATE reports to parse');
  assert.ok(p.every((x) => x.grips && typeof x.grips.left === 'boolean'), 'grips parsed every report');
  assert.ok(p.filter((x) => x.grips.left).length > 0, 'left grip should register');
  assert.ok(p.filter((x) => x.grips.right).length > 0, 'right grip should register');
});
