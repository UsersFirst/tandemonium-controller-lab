// ============================================================
// PlayStationDriver — Bluetooth full-report activation handshake (#101)
// ============================================================
//
// Over BT the DualSense/DS4 start in compatibility mode (report 0x01, no IMU);
// reading a family feature report (DS5 0x05 / DS4 0x02) flips them to the full
// IMU report (0x31 / 0x11). On a still-negotiating hot-plug link that read
// THROWS, and the old code still waited ~450ms per attempt for a report that
// couldn't come — ~2s of dead init that serialized subsequent pool loads.
// These lock the hardened behavior: a thrown read skips the wait and fails
// fast, an accepted read + full report activates, and the background loop
// nudges immediately instead of idling a full interval.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PlayStationDriver } from '../src/drivers/playstation-driver.js';

function mockBtDS({ readRejects = false } = {}) {
  const listeners = new Map();
  return {
    vendorId: 0x054c, productId: 0x0ce6, opened: true, collections: [],
    reads: 0,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    async receiveFeatureReport() { this.reads++; if (readRejects) throw new Error('Failed to receive the feature report'); },
    _emit(type, ev) { for (const fn of (listeners.get(type) || [])) fn(ev); },
  };
}

test('BT activation: a thrown feature read skips the wait and fails fast', async () => {
  const dev = mockBtDS({ readRejects: true });
  let waited = false;
  const origAdd = dev.addEventListener.bind(dev);
  dev.addEventListener = (type, fn) => { if (type === 'inputreport') waited = true; origAdd(type, fn); };

  const drv = new PlayStationDriver(dev, 'bluetooth', { mode: 'ds5' });
  // perAttemptMs is huge on purpose — if the wait ran, this test would hang.
  const active = await drv._activateFullReportMode(0x05, { attempts: 3, perAttemptMs: 5000 });

  assert.strictEqual(active, false, 'no full report → not active');
  assert.strictEqual(waited, false, 'a thrown read must not enter the perAttemptMs wait');
  assert.strictEqual(dev.reads, 3, 'still re-issues the activating read each attempt');
});

test('BT activation: accepted read + full report (0x31) → active', async () => {
  const dev = mockBtDS({ readRejects: false });
  const drv = new PlayStationDriver(dev, 'bluetooth', { mode: 'ds5' });
  const p = drv._activateFullReportMode(0x05, { attempts: 1, perAttemptMs: 2000 });
  setTimeout(() => dev._emit('inputreport', { reportId: 0x31 }), 15);
  assert.strictEqual(await p, true, 'full report during the wait → active');
});

test('BT background re-activation nudges immediately, before the first interval', async () => {
  const dev = mockBtDS({ readRejects: false });
  const drv = new PlayStationDriver(dev, 'bluetooth', { mode: 'ds5' });
  const p = drv._startBackgroundReactivation(0x05, { intervalMs: 10000, maxMs: 60000 });
  await new Promise((r) => setTimeout(r, 40)); // « intervalMs: only an immediate nudge could fire
  assert.ok(dev.reads >= 1, 'fired an immediate read without idling a full interval');
  dev._emit('inputreport', { reportId: 0x31 }); // flip the stream so the loop finishes + clears its timer
  assert.strictEqual(await p, true);
});
