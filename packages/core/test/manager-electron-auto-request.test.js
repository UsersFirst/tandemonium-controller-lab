// ============================================================
// ControllerManager.electronAutoRequestDevice — deprecated no-op (#101)
// ============================================================
//
// Auto-pairing not-yet-approved devices at boot is impossible: WebHID
// requestDevice() needs transient user activation, so a fire-and-forget boot
// call threw "Must be handling a user gesture" and pooled nothing. The method
// is now a no-op (kept for downstream/synced callers). This locks that it
// neither throws nor calls requestDevice, so the broken boot loop can't creep
// back in. Approved devices pool via autoPoolApprovedHid(); new ones pair via
// connectHidForSlot() from a user gesture.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';

test('electronAutoRequestDevice is a no-op: never calls requestDevice at boot', async () => {
  const mgr = new ControllerManager({ slotIds: ['P1', 'P2'] });

  let requestCalls = 0;
  // navigator is a read-only getter in modern Node — override via defineProperty.
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { hid: { requestDevice: async () => { requestCalls++; return []; } } },
  });
  try {
    await assert.doesNotReject(
      () => mgr.electronAutoRequestDevice(),
      'must not throw the "requires a user gesture" error at boot',
    );
    assert.strictEqual(requestCalls, 0, 'must not call navigator.hid.requestDevice (no boot gesture)');
    assert.strictEqual(mgr._hidPool.size, 0, 'pools nothing');
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    else delete globalThis.navigator;
  }
});
