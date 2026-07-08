// ============================================================
// ControllerManager.connectHidForSlot — { prompt } gates the requestDevice scan
// ============================================================
//
// connectHidForSlot has two phases: (1) pool an already-approved-but-unpooled
// device (getDevices, cheap), (2) fall back to requestDevice to grant a new one.
// requestDevice in Electron enumerates every system HID device and briefly
// blocks — a real stall on a redundant click when everything is already paired.
// `prompt: false` runs only the cheap phase so callers can avoid that scan when
// it wouldn't help. See [[multi-steam-controller]].

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';

function withNavigator({ approved = [], onRequest }, fn) {
  let requestCalls = 0;
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      hid: {
        getDevices: async () => approved,
        requestDevice: async (opts) => { requestCalls++; return onRequest ? onRequest(opts) : []; },
      },
    },
  });
  return Promise.resolve(fn(() => requestCalls)).finally(() => {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    else delete globalThis.navigator;
  });
}

test('prompt:false never calls requestDevice, even when nothing is poolable', async () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  m.poolDevice = async () => { throw new Error('should not pool'); };   // no candidate → not reached
  await withNavigator({ approved: [] }, async (calls) => {
    const dev = await m.connectHidForSlot('P1', { prompt: false });
    assert.equal(dev, null, 'returns null with nothing to pool');
    assert.equal(calls(), 0, 'requestDevice NOT called (no blocking scan)');
  });
});

test('prompt:true falls back to requestDevice when nothing is already approved', async () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  let pooled = null;
  m.poolDevice = async (d) => { pooled = d; return { device: d }; };
  const newDev = { vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck' };
  await withNavigator({ approved: [], onRequest: () => [newDev] }, async (calls) => {
    const dev = await m.connectHidForSlot('P1', { prompt: true });
    assert.equal(calls(), 1, 'requestDevice called to grant a new device');
    assert.equal(dev, newDev, 'returns the newly granted device');
    assert.equal(pooled, newDev, 'and pools it');
  });
});

test('either mode pools an already-approved-but-unpooled device without requestDevice', async () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  let pooled = null;
  m.poolDevice = async (d) => { pooled = d; return { device: d }; };
  const ds = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
  await withNavigator({ approved: [ds] }, async (calls) => {
    const dev = await m.connectHidForSlot('P1', { prompt: false });
    assert.equal(dev, ds, 'pooled the approved device');
    assert.equal(pooled, ds);
    assert.equal(calls(), 0, 'no requestDevice needed — it was already approved');
  });
});
