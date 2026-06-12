// ============================================================
// SteamControllerDriver — system buttons incl. the "…" quick-access button
// ============================================================
//
// Replays a real Steam Controller Puck (28de:1304) capture of the system-
// buttons step — taken with the "…" quick-access button pressed — and asserts
// the parse. quickAccess is btn0 bit 0x10 (the one unused face-byte bit); it
// was silent in the original capture and identified from this one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SteamControllerDriver } from '../src/drivers/steam-controller-driver.js';
import { bytesFromHex, dataView } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'steam-controller-puck-system_28de-1304.json'), 'utf8'),
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
const fired = (parsed, key) => parsed.filter((p) => p.buttons?.[key]).length;

test('system-buttons step: Steam/View/Menu and the "…" quick-access all register', () => {
  const p = parseStep('system-buttons');
  assert.ok(p.length > 20, 'expected STATE reports to parse');
  for (const k of ['ps', 'create', 'options', 'quickAccess']) {
    assert.ok(fired(p, k) > 0, `${k} should register`);
  }
});
