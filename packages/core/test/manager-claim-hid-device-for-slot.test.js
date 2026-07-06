// ============================================================
// ControllerManager — claimHidDeviceForSlot (versus/co-op seat, HID-only pads)
// ============================================================
//
// The HID-only counterpart of claimPadForSlot, for controllers invisible to the
// Gamepad API (Steam Controller Puck, DualSense-BT). The game's versus lobby
// calls mgr.claimHidDeviceForSlot(slotId, device) when such a controller presses
// to join a chosen seat. Returns the claimed Slot (with the pool entry attached)
// or null.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, makeSyntheticGamepad } from '../src/manager.js';

function fakeDevice(vendorId, productId, productName) { return { vendorId, productId, productName }; }
function fakeEntry(device, { streaming = true } = {}) {
  return {
    device, driver: null, fusion: { startCalibration() {}, ingest() {} },
    synthetic: makeSyntheticGamepad(device),
    hasButtons: true, _everPressed: false,
    hidActiveSince: streaming ? 1 : 0, slot: null,
    hasFreshButtonPress() { return false; }, hasFreshInput() { return false; }, destroy() {},
  };
}

test('claimHidDeviceForSlot claims a pooled HID device into a specific empty slot', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2', 'P3'] });
  const dev = fakeDevice(0x28de, 0x1304, 'Steam Controller Puck');
  m._hidPool.set(dev, fakeEntry(dev));
  const slot = m.claimHidDeviceForSlot('P2', dev);
  assert.ok(slot, 'returns the claimed slot');
  assert.equal(slot.id, 'P2');
  assert.equal(m.getSlot('P2').state, 'claimed');
  assert.equal(m.getSlot('P2')._hidEntry.device, dev, 'streaming entry attached');
  assert.equal(m.getSlot('P1').state, 'empty', 'other seats untouched');
});

test('claimHidDeviceForSlot rejects missing device / unpooled device / occupied slot', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  assert.equal(m.claimHidDeviceForSlot('P1', null), null, 'missing device rejected');
  const ds = fakeDevice(0x054c, 0x0ce6, 'DualSense Wireless Controller');
  assert.equal(m.claimHidDeviceForSlot('P1', ds), null, 'device not in pool rejected');
  m._hidPool.set(ds, fakeEntry(ds));
  assert.ok(m.claimHidDeviceForSlot('P1', ds), 'claims into P1');
  const switchpro = fakeDevice(0x057e, 0x2009, 'Wireless Gamepad');
  m._hidPool.set(switchpro, fakeEntry(switchpro));
  assert.equal(m.claimHidDeviceForSlot('P1', switchpro), null, 'occupied slot rejected');
  assert.equal(m.claimHidDeviceForSlot('nope', switchpro), null, 'unknown slot rejected');
});
