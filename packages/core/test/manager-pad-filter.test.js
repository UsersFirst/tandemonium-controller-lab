// ============================================================
// ControllerManager — opts.padFilter (host veto over Gamepad-API pads)
// ============================================================
//
// Under a Steam launch, Steam re-emits a controller it captured as a generic
// virtual XInput pad. With a Steam Controller already live over WebHID that
// XInput device is the SAME physical pad; seating it cross-drives two seats
// from one controller (Tandemonium #362). The host can tell the twin apart
// (Steam's getControllerForGamepadIndex) and vetoes it via padFilter; the
// manager must then never claim it — not at boot, not on activity, not on an
// explicit seat claim — while other pads seat normally.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';

const XINPUT = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';
const DS = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
function makePad(index, id) {
  const btns = [];
  for (let i = 0; i < 17; i++) btns.push({ pressed: false, touched: false, value: 0 });
  return { index, id, mapping: 'standard', connected: true, timestamp: 0, buttons: btns, axes: [0, 0, 0, 0] };
}
function press(gp, i) { gp.buttons[i].pressed = true; gp.buttons[i].value = 1; }
function release(gp, i) { gp.buttons[i].pressed = false; gp.buttons[i].value = 0; }

test('padFilter keeps a vetoed pad out of boot claim, activity claim and seat claim', () => {
  const twin = makePad(0, XINPUT);
  const ds = makePad(1, DS);
  const m = new ControllerManager({ slotIds: ['P1', 'P2'], padFilter: (gp) => gp !== twin });

  // Boot claim: the twin is the only clean candidate at index 0 — still skipped.
  assert.equal(m.claimFirstAvailable('P1', [twin]), null, 'boot claim skips the vetoed pad');
  assert.equal(m.getSlot('P1').state, 'empty');

  // Activity claim: a press on the twin never seats it; a press on the DS does.
  press(twin, 0);
  m.ingestFrame([twin, ds], 1000);
  release(twin, 0);
  assert.equal(m.slots.every((s) => s.state === 'empty'), true, 'twin activity claims nothing');
  press(ds, 0);
  m.ingestFrame([twin, ds], 1016);
  release(ds, 0);
  assert.equal(m.getSlot('P1').state, 'claimed');
  assert.equal(m.getSlot('P1').gamepadIndex, 1, 'the DualSense seated instead');

  // Explicit seat claim: refused for the twin, fine for another pad.
  assert.equal(m.claimPadForSlot('P2', twin), false, 'seat claim refuses the vetoed pad');
  assert.equal(m.getSlot('P2').state, 'empty');
});

test('without padFilter (default) every pad is eligible; a throwing filter is ignored', () => {
  const gp = makePad(0, XINPUT);
  const m = new ControllerManager({ slotIds: ['P1'] });
  assert.equal(m.claimPadForSlot('P1', gp), true);

  const m2 = new ControllerManager({ slotIds: ['P1'], padFilter: () => { throw new Error('boom'); } });
  assert.equal(m2.claimPadForSlot('P1', makePad(2, XINPUT)), true, 'a broken filter fails open');
});
