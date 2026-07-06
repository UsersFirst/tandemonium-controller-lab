// ============================================================
// ControllerManager — claimPadForSlot (versus/co-op seat assignment)
// ============================================================
//
// The game's versus lobby assigns a chosen controller to a chosen seat when the
// user presses to join it — claimPadForSlot(slotId, gp). Distinct from
// claimFirstAvailable (which PICKS a pad); here the caller supplies both.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';

const ID = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';
function makePad(index, id = ID) {
  const btns = [];
  for (let i = 0; i < 17; i++) btns.push({ pressed: false, touched: false, value: 0 });
  return { index, id, mapping: 'standard', connected: true, timestamp: 0, buttons: btns, axes: [0, 0, 0, 0] };
}

test('claimPadForSlot claims a specific pad into a specific empty slot', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2', 'P3'] });
  assert.equal(m.getSlot('P2').state, 'empty');
  assert.equal(m.claimPadForSlot('P2', makePad(1)), true);
  assert.equal(m.getSlot('P2').state, 'claimed');
  assert.equal(m.getSlot('P2').gamepadIndex, 1);
  assert.equal(m.getSlot('P1').state, 'empty', 'other seats untouched');
});

test('claimPadForSlot rejects occupied slot / missing pad / pad already seated', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  assert.equal(m.claimPadForSlot('P1', makePad(0)), true);
  assert.equal(m.claimPadForSlot('P1', makePad(2)), false, 'occupied slot rejected');
  assert.equal(m.claimPadForSlot('P2', null), false, 'missing pad rejected');
  assert.equal(m.claimPadForSlot('P2', makePad(0)), false, 'pad already owning P1 rejected');
  assert.equal(m.getSlot('P2').state, 'empty');
  assert.equal(m.claimPadForSlot('nope', makePad(3)), false, 'unknown slot rejected');
});
