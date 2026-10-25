// ============================================================
// ControllerManager — Tier 2 must not cross-wire identical units
// ============================================================
//
// Two identical DualSense units, P1 already claimed by its Gamepad pad with no
// HID handle bound yet. The player presses a button: the unit's own HID report
// shows it a frame BEFORE the pad's Gamepad sample does. On that frame Tier 1
// can't correlate (the pad shows nothing yet), and Tier 2 used to bind the only
// never-pressed handle — the OTHER player's unit. Then P2 got the first unit.
// A press in flight on a same-model handle means "wait a frame", not "bind the
// silent one".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, makeSyntheticGamepad } from '../src/manager.js';

const DS5_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
const ds5Device = () => ({ vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' });

function makePad(index, id, buttons = {}) {
  const btns = [];
  for (let i = 0; i < 17; i++) btns.push({ pressed: false, touched: false, value: 0 });
  for (const [i, v] of Object.entries(buttons)) { btns[i].pressed = !!v; btns[i].value = v ? 1 : 0; }
  return { index, id, mapping: 'standard', connected: true, timestamp: 0, buttons: btns, axes: [0, 0, 0, 0] };
}
function fakeEntry(device) {
  return {
    device, driver: null,
    fusion: { startCalibration() {}, ingest() {} },
    synthetic: makeSyntheticGamepad(device),
    hasButtons: true, _everPressed: false, hidActiveSince: 0, slot: null,
    hasFreshButtonPress() { return false; },
    hasFreshInput() { return false; },
    destroy() {},
  };
}
function press(entry, i) { entry.synthetic.buttons[i].pressed = true; entry.synthetic.buttons[i].value = 1; entry._everPressed = true; }

test('a HID press a frame before its pad shows it binds that unit, not the silent twin', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const devA = ds5Device(), devB = ds5Device();
  const entryA = fakeEntry(devA), entryB = fakeEntry(devB);
  m._hidPool.set(devA, entryA);
  m._hidPool.set(devB, entryB);

  // P1 claimed by pad 0 (unit A) at boot: two identical candidates, no input → no HID bound yet.
  assert.ok(m.claimFirstAvailable('P1', [makePad(0, DS5_ID), null]));
  const p1 = m.getSlot('P1');
  assert.equal(p1._hidEntry, null, 'ambiguous at claim: nothing bound');
  m.ingestFrame([makePad(0, DS5_ID), makePad(1, DS5_ID)], 1000);
  assert.equal(p1._hidEntry, null, 'still ambiguous with no input');

  // Frame 1: unit A's HID report shows cross; pad 0's sample doesn't yet.
  press(entryA, 0);
  m.ingestFrame([makePad(0, DS5_ID), makePad(1, DS5_ID)], 1016);
  assert.notEqual(p1._hidEntry, entryB, "must not bind the other player's silent unit");

  // Frame 2: the pad catches up — now it correlates to unit A.
  m.ingestFrame([makePad(0, DS5_ID, { 0: true }), makePad(1, DS5_ID)], 1033);
  assert.equal(p1._hidEntry, entryA, 'P1 binds its own unit once the pad shows the press');
});

test('a lone silent handle (spoof / gyro-only) still binds when no press is in flight', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const devA = ds5Device(), devB = ds5Device();
  const entryA = fakeEntry(devA), entryB = fakeEntry(devB);
  m._hidPool.set(devA, entryA);
  m._hidPool.set(devB, entryB);
  entryA._everPressed = true;   // pressed long ago (outside the fold window), idle now
  assert.ok(m.claimFirstAvailable('P1', [makePad(0, DS5_ID)]));
  m.ingestFrame([makePad(0, DS5_ID)], 5000);
  assert.equal(m.getSlot('P1')._hidEntry, entryB, 'Tier 2 unchanged when nothing is pressing');
});
