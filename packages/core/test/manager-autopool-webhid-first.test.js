// ============================================================
// ControllerManager.autoPoolApprovedHid — WebHID-first boot pooling
// ============================================================
//
// WebHID is the primary input path: boot-pooling pools EVERY approved, known
// HID device, with NO "is it live in the Gamepad API?" gate. That gate used to
// drop HID-only controllers (the Steam Controller Puck is vendor-defined HID
// and never appears in the Gamepad API) whenever any other Gamepad-API pad was
// connected. The Gamepad API / XInput is now purely a FALLBACK (ingestFrame's
// Gamepad-claim loop). Stale approved-but-absent pairings are cleaned by the
// phantom-eviction sweep in ingestFrame, not by refusing to pool them. See
// [[multi-steam-controller]].

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';

const PUCK = { vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck' };
const DS5  = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
const UNKNOWN = { vendorId: 0x1234, productId: 0x5678, productName: 'Mystery Pad' };

function withNavigator({ approvedHid, gamepads = [] }, fn) {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      hid: { getDevices: async () => approvedHid },
      getGamepads: () => gamepads,
    },
  });
  return Promise.resolve(fn()).finally(() => {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    else delete globalThis.navigator;
  });
}

function xboxPad(index) {
  return { index, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', mapping: 'standard', buttons: [], axes: [] };
}

// Spy on poolDevice so we exercise the pooling DECISION, not the heavy driver
// init + `three` import that core's dependency-free tests avoid.
function spyPool(m) {
  const pooled = [];
  m.poolDevice = async (d) => { pooled.push(d); return { device: d }; };
  return pooled;
}

test('pools a HID-only Steam Puck even when the only live Gamepad-API pad is something else', async () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const pooled = spyPool(m);
  await withNavigator({ approvedHid: [PUCK], gamepads: [xboxPad(0)] }, () => m.autoPoolApprovedHid());
  assert.ok(pooled.includes(PUCK), 'Puck pooled despite no Gamepad-API liveness (no gate)');
});

test('pools a known device with NO live Gamepad-API counterpart at all (gate removed)', async () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const pooled = spyPool(m);
  // Formerly treated as a "stale pairing" and skipped; now pooled. If it turns
  // out to be absent, the phantom-eviction sweep in ingestFrame removes it.
  await withNavigator({ approvedHid: [DS5], gamepads: [] }, () => m.autoPoolApprovedHid());
  assert.ok(pooled.includes(DS5), 'known device pooled regardless of Gamepad-API liveness');
});

test('pools every approved known device (Steam + DualSense together)', async () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2', 'P3'] });
  const pooled = spyPool(m);
  await withNavigator({ approvedHid: [PUCK, DS5], gamepads: [] }, () => m.autoPoolApprovedHid());
  assert.ok(pooled.includes(PUCK) && pooled.includes(DS5), 'both pooled');
});

test('ignores unknown devices', async () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const pooled = spyPool(m);
  await withNavigator({ approvedHid: [UNKNOWN] }, () => m.autoPoolApprovedHid());
  assert.ok(!pooled.includes(UNKNOWN), 'unknown device not pooled');
});

test('does not re-pool a device already in the pool', async () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  // Pretend PUCK is already pooled.
  m._hidPool.set(PUCK, { device: PUCK });
  const pooled = spyPool(m);
  await withNavigator({ approvedHid: [PUCK] }, () => m.autoPoolApprovedHid());
  assert.ok(!pooled.includes(PUCK), 'already-pooled device skipped');
});
