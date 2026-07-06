// ============================================================
// SteamControllerDriver — Puck lizard-mode owner election (#101)
// ============================================================
//
// The Puck exposes 5 HID interfaces sharing vid:pid; the manager pools each
// as its own driver instance. init() must elect a SINGLE lizard-mode owner
// (probe + 800ms heartbeat). The owner already broadcasts CLEAR to all five
// siblings, so running init on every instance was 5x redundant SET_REPORT
// churn (the NotAllowedError storm that janked the renderer ~4s). These lock
// "exactly one heartbeat timer" and "ownership is released on destroy".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SteamControllerDriver } from '../src/drivers/steam-controller-driver.js';

const PUCK_PID = 0x1304;
const key = (d) => `${d.vendorId}:${d.productId}`;

// Minimal Puck HID interface. All instances share vid:pid, as the 5 real
// interfaces do. No navigator.hid in the test env, so _candidatePuckDevices
// resolves to just [this.device] — which is all the election test needs.
function mockPuckDevice() {
  return {
    vendorId: 0x28de, productId: PUCK_PID, productName: 'Steam Controller Puck',
    opened: true,
    collections: [{
      usagePage: 0xff00, usage: 0x0001,
      featureReports: [{ reportId: 0x01, items: [{ reportSize: 8, reportCount: 64 }] }],
    }],
    async open() { this.opened = true; },
    async sendFeatureReport() { /* accept the CLEAR / SET_SETTINGS */ },
  };
}

test('Puck: exactly one interface owns the lizard-mode heartbeat (no 5x churn)', async () => {
  SteamControllerDriver._lizardOwners.clear();
  const drivers = Array.from({ length: 5 }, () => new SteamControllerDriver(mockPuckDevice(), 'usb', null));
  try {
    for (const drv of drivers) await drv.init();
    const withTimer = drivers.filter((d) => d._lizardTimer != null);
    assert.strictEqual(withTimer.length, 1, 'one heartbeat timer across all 5 interfaces');
  } finally {
    for (const drv of drivers) drv.destroy();
  }
});

test('Puck: destroying the owner releases ownership so a fresh connect re-elects', async () => {
  SteamControllerDriver._lizardOwners.clear();
  const a = new SteamControllerDriver(mockPuckDevice(), 'usb', null);
  const b = new SteamControllerDriver(mockPuckDevice(), 'usb', null);
  try {
    await a.init();
    await b.init();
    assert.ok(a._lizardTimer && !b._lizardTimer, 'a owns, b skips');

    a.destroy();
    assert.strictEqual(SteamControllerDriver._lizardOwners.get(key(a.device)), undefined, 'ownership released on destroy');

    const c = new SteamControllerDriver(mockPuckDevice(), 'usb', null);
    await c.init();
    assert.ok(c._lizardTimer, 'a fresh instance re-elects as owner after the previous owner was destroyed');
    c.destroy();
  } finally {
    b.destroy();
  }
});
