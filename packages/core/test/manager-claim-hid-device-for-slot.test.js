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
function fakeEntry(device, { streaming = true, driver = null } = {}) {
  return {
    device, driver, fusion: { startCalibration() {}, ingest() {} },
    synthetic: makeSyntheticGamepad(device),
    hasButtons: true, _everPressed: false,
    hidActiveSince: streaming ? 1 : 0, slot: null,
    hasFreshButtonPress() { return false; }, hasFreshInput() { return false; }, destroy() {},
  };
}

// A driver whose class advertises sibling-fanout, like SteamControllerDriver.
class FanoutDriver {}
FanoutDriver.needsSiblingFanout = true;
function fanoutEntry(device, opts = {}) { return fakeEntry(device, { ...opts, driver: new FanoutDriver() }); }

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

test('claimHidDeviceForSlot keeps a streaming fan-out handle (two Steam bodies on one Puck → distinct seats)', () => {
  // The 2026 Steam Controller Puck is a multi-receiver: two paired bodies each
  // stream STATE on their OWN same-vid:pid vendor interface. Both handles are
  // streaming, so each must seat as ITSELF — not collapse onto "the first
  // streaming sibling", which would attach one body to both seats.
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const bodyA = fakeDevice(0x28de, 0x1304, 'Steam Controller Puck'); // MI_02
  const bodyB = fakeDevice(0x28de, 0x1304, 'Steam Controller Puck'); // MI_03
  m._hidPool.set(bodyA, fanoutEntry(bodyA, { streaming: true }));
  m._hidPool.set(bodyB, fanoutEntry(bodyB, { streaming: true }));

  const s1 = m.claimHidDeviceForSlot('P1', bodyA);
  const s2 = m.claimHidDeviceForSlot('P2', bodyB);
  assert.ok(s1 && s2, 'both seats claimed');
  assert.equal(m.getSlot('P1')._hidEntry.device, bodyA, 'P1 bound to body A (MI_02)');
  assert.equal(m.getSlot('P2')._hidEntry.device, bodyB, 'P2 bound to body B (MI_03) — not a duplicate of A');
  assert.notEqual(m.getSlot('P1')._hidEntry.device, m.getSlot('P2')._hidEntry.device, 'distinct physical units');
});

test('claimHidDeviceForSlot reroutes a SILENT fan-out handle to a streaming sibling (single-body Puck)', () => {
  // Single controller behind the Puck: the granted handle may be an interface
  // that never emits STATE. Then (and only then) we reroute to the streaming
  // same-vid:pid sibling.
  const m = new ControllerManager({ slotIds: ['P1'] });
  const silent = fakeDevice(0x28de, 0x1304, 'Steam Controller Puck');    // e.g. MI_04, no STATE
  const streaming = fakeDevice(0x28de, 0x1304, 'Steam Controller Puck'); // MI_03, streaming
  m._hidPool.set(silent, fanoutEntry(silent, { streaming: false }));
  m._hidPool.set(streaming, fanoutEntry(streaming, { streaming: true }));
  const slot = m.claimHidDeviceForSlot('P1', silent);
  assert.ok(slot, 'claimed');
  assert.equal(m.getSlot('P1')._hidEntry.device, streaming, 'rerouted silent handle to the streaming sibling');
});
