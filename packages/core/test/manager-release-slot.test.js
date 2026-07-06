// ============================================================
// ControllerManager — releaseSlotToPool (lobby "leave" / B)
// ============================================================
//
// The lobby's two-step B (ready → unready → leave seat) needs a public
// seat-release. releaseSlotToPool empties the seat and arms the same
// await-silence + reclaim cooldown as the PS/Home hold gesture, so the
// still-connected controller doesn't instantly re-grab the seat it just left.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';

const ID = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';

function makePad(index, id, { buttons = {} } = {}) {
  const btns = [];
  for (let i = 0; i < 17; i++) btns.push({ pressed: false, touched: false, value: 0 });
  for (const [i, v] of Object.entries(buttons)) { btns[i].pressed = !!v; btns[i].value = v ? 1 : 0; }
  return { index, id, mapping: 'standard', connected: true, timestamp: 0, buttons: btns, axes: [0, 0, 0, 0] };
}

test('releaseSlotToPool frees a claimed seat and blocks instant re-claim', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const p1 = m.getSlot('P1');
  m.ingestFrame([makePad(0, ID, { buttons: { 0: true } })], 1000);
  assert.equal(p1.state, 'claimed', 'precondition: seated');

  assert.equal(m.releaseSlotToPool('P1', 1100), true);
  assert.equal(p1.state, 'empty', 'seat emptied');

  // Still-held controller must NOT immediately re-claim (await-silence + cooldown).
  m.ingestFrame([makePad(0, ID, { buttons: { 0: true } })], 1116);
  assert.equal(p1.state, 'empty', 'held controller does not re-grab the seat it just left');

  // Goes idle (clears await-silence), then a fresh press past the cooldown re-seats.
  m.ingestFrame([makePad(0, ID)], 1200);
  m.ingestFrame([makePad(0, ID, { buttons: { 0: true } })], 3000);
  assert.equal(p1.state, 'claimed', 're-claims after silence + reclaim cooldown');
});

test('releaseSlotToPool is a no-op on an empty slot', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  assert.equal(m.releaseSlotToPool('P1'), false);
});
