// ============================================================
// ControllerManager — late/reconnected HID binding
// ============================================================
//
// A dual-path controller (GameSir Super Nova: buttons/sticks via the
// Gamepad API, gyro via WebHID, both vid:pid 054c:09cc) gets its HID
// entry bound at claim time by _attachMatchingPoolEntry. But on a
// reconnect (e.g. the Super Nova auto-disconnects on the charger and
// re-pairs on pickup), the Gamepad-API pad re-claims the slot BEFORE the
// async WebHID `connect` re-pools the device — so the claim-time bind
// finds nothing, and the HID-pool claim loop can't help because it's
// gated on a fresh button press the IMU-only HID interface never emits.
// Result: working buttons, dead gyro toggle. These tests lock the
// per-frame reconciliation pass that re-binds late pool entries.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, makeSyntheticGamepad } from '../src/manager.js';

const GAMESIR_ID = 'GameSir Super Nova (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';
const DUALSENSE_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

function makePad(index, id, { buttons = {}, axes = [0, 0, 0, 0] } = {}) {
  const btns = [];
  for (let i = 0; i < 17; i++) btns.push({ pressed: false, touched: false, value: 0 });
  for (const [i, v] of Object.entries(buttons)) {
    btns[i].pressed = !!v;
    btns[i].value = v ? 1 : 0;
  }
  return { index, id, mapping: 'standard', connected: true, timestamp: 0, buttons: btns, axes: [...axes] };
}

/**
 * Minimal stand-in for a HidEntry as seen by the manager's binding path.
 * IMU-only by default: hasButtons=false, hasFreshButtonPress()=false —
 * exactly the GameSir-as-DS4 HID interface that the old code could never
 * bind after a reconnect.
 */
function fakeEntry(device) {
  return {
    device,
    driver: null, // _applyPlayerFeedback no-ops on a null driver
    fusion: { startCalibration() {}, ingest() {} },
    synthetic: makeSyntheticGamepad(device),
    hasButtons: false,
    hidActiveSince: 0,
    slot: null,
    hasFreshButtonPress() { return false; },
    destroy() {},
  };
}

const gamesirDevice = () => ({ vendorId: 0x054c, productId: 0x09cc, productName: 'GameSir Super Nova' });

test('reconnect: a late/reconnected IMU-only HID entry binds to its already-claimed slot', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const p1 = m.getSlot('P1');

  // Frame 1 — Gamepad API claims P1 (button press) with the pool empty,
  // mirroring a reconnect where the pad surfaces before the WebHID handle.
  const pad = makePad(0, GAMESIR_ID, { buttons: { 0: true } });
  m.ingestFrame([pad], 1000);
  assert.equal(p1.state, 'claimed', 'P1 should claim on the button press');
  assert.equal(p1._hidEntry, null, 'no HID entry bound yet (pool was empty at claim time)');
  assert.equal(p1.fusion, null, 'gyro fusion unavailable until the HID entry binds');

  // The WebHID handle finally re-pools (async connect landed).
  const dev = gamesirDevice();
  const entry = fakeEntry(dev);
  m._hidPool.set(dev, entry);

  // Frame 2 — reconciliation binds the late entry despite no fresh button.
  m.ingestFrame([pad], 1016);
  assert.equal(p1._hidEntry, entry, 'reconciliation should bind the reconnected HID entry');
  assert.equal(p1.fusion, entry.fusion, 'slot now proxies the HID fusion — gyro toggle can enable');
  assert.equal(m._hidPool.size, 0, 'entry moved out of the pool into the slot');
});

test('reconnect: reconciliation does NOT bind an entry to a non-matching slot', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const p1 = m.getSlot('P1');

  // P1 is a DualSense (054c:0ce6); the pooled HID entry is a GameSir
  // (054c:09cc) — different vid:pid and a non-matching name.
  const pad = makePad(0, DUALSENSE_ID, { buttons: { 0: true } });
  m.ingestFrame([pad], 1000);
  assert.equal(p1.state, 'claimed');

  const dev = gamesirDevice();
  const entry = fakeEntry(dev);
  m._hidPool.set(dev, entry);

  m.ingestFrame([pad], 1016);
  assert.equal(p1._hidEntry, null, 'GameSir entry must not bind to a DualSense slot');
  assert.equal(m._hidPool.size, 1, 'entry stays in the pool');
});

test('reconnect: _findClaimedUnboundSlotForEntry matches by productName when vid:pid differs', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const p1 = m.getSlot('P1');
  // Claim with a label that has no parseable vid:pid but contains the name.
  const pad = makePad(0, 'GameSir Super Nova', { buttons: { 0: true } });
  m.ingestFrame([pad], 1000);
  assert.equal(p1.state, 'claimed');

  // HID device reports a different vid:pid but the same productName.
  const dev = { vendorId: 0x3537, productId: 0x1004, productName: 'GameSir Super Nova' };
  const entry = fakeEntry(dev);
  assert.equal(m._findClaimedUnboundSlotForEntry(entry), p1, 'should match on productName substring');
});
