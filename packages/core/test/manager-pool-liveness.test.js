// ============================================================
// ControllerManager — phantom HID eviction (pool liveness)
// ============================================================
//
// A spoofing pad (GameSir Super Nova presenting DualSense 054c:0ce6 to the
// Gamepad API) makes autoPoolApprovedHid pull in OTHER approved same-vid:pid
// handles that aren't physically present. Silent, they bloat per-frame cost
// and confound same-id binding. ingestFrame evicts a pooled handle that has
// never streamed a raw report past the probation window; a present controller
// (which streams within tens of ms) is kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, makeSyntheticGamepad } from '../src/manager.js';

const dev = (pid, name = 'X') => ({ vendorId: 0x054c, productId: pid, productName: name });
function fakeEntry(device, { pooledAt = 0, lastRawReportAt = 0 } = {}) {
  return {
    device, driver: null, fusion: { startCalibration() {}, ingest() {} },
    synthetic: makeSyntheticGamepad(device), hasButtons: false, hidActiveSince: 0,
    pooledAt, lastRawReportAt, slot: null,
    hasFreshButtonPress() { return false; }, hasFreshInput() { return false; }, destroy() {},
  };
}

test('evicts a pooled handle that never streams past the probation window', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const d = dev(0x0ce6, 'DualSense Wireless Controller');
  m._hidPool.set(d, fakeEntry(d, { pooledAt: 1000, lastRawReportAt: 0 }));
  m.ingestFrame([], 1000 + m.opts.poolProbationMs + 100);
  assert.equal(m._hidPool.has(d), false, 'silent phantom evicted');
});

test('keeps a pooled handle that has streamed a report', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const d = dev(0x0ce6, 'DualSense Wireless Controller');
  m._hidPool.set(d, fakeEntry(d, { pooledAt: 1000, lastRawReportAt: 1200 }));
  m.ingestFrame([], 1000 + m.opts.poolProbationMs + 100);
  assert.equal(m._hidPool.has(d), true, 'present/streaming device kept');
});

test('keeps a freshly-pooled silent handle inside the grace window', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const d = dev(0x09cc, 'Wireless Controller');
  m._hidPool.set(d, fakeEntry(d, { pooledAt: 1000, lastRawReportAt: 0 }));
  m.ingestFrame([], 1500);   // still inside probation
  assert.equal(m._hidPool.has(d), true, 'not evicted before probation elapses');
});

test('test doubles without a numeric pooledAt are never swept', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const d = dev(0x0ce6);
  const e = fakeEntry(d); delete e.pooledAt;   // legacy/minimal double
  m._hidPool.set(d, e);
  m.ingestFrame([], 999999);
  assert.equal(m._hidPool.has(d), true, 'entries without pooledAt are left alone');
});

test('a fan-out (Steam Puck) interface is NOT evicted for silence — it waits for a body', () => {
  // An idle Puck interface (receiver slot with no body paired yet) streams no
  // reports, but it is present, not a ghost. Evicting it breaks power-on after
  // launch. Removal is via hotplug disconnect (whole Puck unplugged), not this
  // silence sweep. See [[multi-steam-controller]].
  class FanoutDriver {}
  FanoutDriver.needsSiblingFanout = true;
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const puck = { vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck' };
  const e = fakeEntry(puck, { pooledAt: 1000, lastRawReportAt: 0 }); // never streamed
  e.driver = new FanoutDriver();
  m._hidPool.set(puck, e);
  m.ingestFrame([], 1000 + m.opts.poolProbationMs + 5000);   // well past probation
  assert.equal(m._hidPool.has(puck), true, 'idle Puck interface kept, not swept as a phantom');
});
