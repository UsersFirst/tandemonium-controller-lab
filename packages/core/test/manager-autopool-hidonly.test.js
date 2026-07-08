// ============================================================
// ControllerManager.autoPoolApprovedHid — HID-only devices bypass the
// "must be live in the Gamepad API" stale-pairing gate
// ============================================================
//
// The boot-pooling gate skips approved HID devices whose vid:pid has no live
// Gamepad-API pad, so a stale pairing from a past session isn't opened. But a
// Steam Controller Puck is vendor-defined HID and NEVER appears in the Gamepad
// API — so when it's present alongside some other Gamepad-API pad (an Xbox),
// the gate would wrongly skip the present Puck and Steam multiplayer would find
// no controllers. Entries flagged `hidOnly` bypass the gate. See
// [[multi-steam-controller]].

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';

// Steam Controller Puck (hidOnly in the dictionary) + a normal DualSense.
const PUCK = { vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck' };
const DS5  = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
const UNKNOWN = { vendorId: 0x1234, productId: 0x5678, productName: 'Mystery Pad' };

function withNavigator({ approvedHid, gamepads }, fn) {
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

// A gamepad-shaped object whose id carries a vid:pid (Xbox here).
function xboxPad(index) {
  return { index, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', mapping: 'standard', buttons: [], axes: [] };
}

// Spy on poolDevice so we test the GATE decision, not the heavy pooling
// machinery (real driver init + the `three` import, which core tests avoid).
function spyPool(m) {
  const pooled = [];
  m.poolDevice = async (d) => { pooled.push(d); return { device: d }; };
  return pooled;
}

test('autoPoolApprovedHid pools a present Steam Puck even when another pad is the only live Gamepad-API device', async () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const pooled = spyPool(m);
  // Only the Xbox is "live" in the Gamepad API; the Puck is HID-only and never
  // shows there. The Puck must still pool.
  await withNavigator({ approvedHid: [PUCK], gamepads: [xboxPad(0)] }, () => m.autoPoolApprovedHid());
  assert.ok(pooled.includes(PUCK), 'hidOnly Puck pooled despite no Gamepad-API liveness');
});

test('autoPoolApprovedHid still SKIPS a non-hidOnly device with no live Gamepad-API counterpart', async () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const pooled = spyPool(m);
  // A DualSense that is approved-but-absent (only the Xbox is live) is a stale
  // pairing — the gate should still skip it (unchanged behavior).
  await withNavigator({ approvedHid: [DS5], gamepads: [xboxPad(0)] }, () => m.autoPoolApprovedHid());
  assert.ok(!pooled.includes(DS5), 'stale non-hidOnly pairing still skipped');
});

test('autoPoolApprovedHid pools a non-hidOnly device when its OWN Gamepad-API pad is live', async () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const pooled = spyPool(m);
  const ds5Pad = { index: 0, id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', mapping: 'standard', buttons: [], axes: [] };
  await withNavigator({ approvedHid: [DS5], gamepads: [ds5Pad] }, () => m.autoPoolApprovedHid());
  assert.ok(pooled.includes(DS5), 'DualSense pooled when its own pad is live (unchanged)');
});

test('autoPoolApprovedHid ignores unknown devices entirely', async () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const pooled = spyPool(m);
  await withNavigator({ approvedHid: [UNKNOWN], gamepads: [] }, () => m.autoPoolApprovedHid());
  assert.ok(!pooled.includes(UNKNOWN), 'unknown device not pooled');
});
