// ============================================================
// ControllerManager.poolDevice — concurrent callers share one pooling
// ============================================================
//
// poolDevice awaits driver init. At boot the host's autoPoolApprovedHid and
// its connectHidForSlot('P1', { prompt: false }) can both reach the same
// already-granted device inside that await. Before the fix each pooled it, so
// one physical controller had two HidEntries and could seat as P1 and P2
// (tandemonium #472, smoke:webhid).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';
import { ControllerRegistry } from '../src/drivers/controller-registry.js';

const fakeDriver = () => ({ connectionType: 'usb', destroy() {}, disconnect() {} });

async function withSlowConnect(fn) {
  const orig = ControllerRegistry.connect;
  let connects = 0;
  ControllerRegistry.connect = async () => { connects++; await new Promise((r) => setTimeout(r, 30)); return fakeDriver(); };
  try { await fn(() => connects); } finally { ControllerRegistry.connect = orig; }
}

test('two concurrent poolDevice calls for one device connect once and return the same entry', async () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const device = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller', collections: [], opened: true, addEventListener() {}, removeEventListener() {} };
  await withSlowConnect(async (connects) => {
    const [a, b] = await Promise.all([m.poolDevice(device), m.poolDevice(device)]);
    assert.ok(a, 'pooled');
    assert.equal(a, b, 'both callers get the same entry');
    assert.equal(connects(), 1, 'the driver connected once');
    assert.equal(m._hidPool.size, 1, 'one pool entry');
  });
});

test('connectHidForSlot racing autoPoolApprovedHid pools the device once', async () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const device = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller', collections: [], opened: true, addEventListener() {}, removeEventListener() {} };
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { hid: { getDevices: async () => [device], requestDevice: async () => [], addEventListener() {}, removeEventListener() {} } },
  });
  try {
    await withSlowConnect(async (connects) => {
      await Promise.all([m.autoPoolApprovedHid(), m.connectHidForSlot('P1', { prompt: false })]);
      assert.equal(connects(), 1, 'one driver connect for one controller');
      const held = [...m._hidPool.values()].filter((e) => e.device === device).length
        + m.slots.filter((s) => s.hidDevice === device).length;
      assert.equal(held, 1, 'the controller is held once (pool or slot), never twice');
    });
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    else delete globalThis.navigator;
  }
});
