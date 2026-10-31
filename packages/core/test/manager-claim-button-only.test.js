// ============================================================
// ControllerManager — Gamepad-API pads claim a seat on a BUTTON press only
// ============================================================
//
// Two Steam Controllers under Steam Input show up as two virtual XInput pads,
// and a Steam layout can route gyro onto the left stick. With stick motion
// counting as "activity", bumping the controller on the desk claimed P1 and the
// one in your hand could press anything without moving the menus. A seat now
// goes to the first controller whose BUTTON is pressed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, gamepadHasButtonPress } from '../src/manager.js';

const XINPUT = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';
function pad(index) {
  return {
    id: XINPUT, index, connected: true, mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
}
const pressA = (p, down = true) => { p.buttons[0].pressed = down; p.buttons[0].value = down ? 1 : 0; };

test('two pads at boot: tilting the other pad does not take P1; the button press does', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const held = pad(0), other = pad(1);
  let t = 1000;
  m.ingestFrame([held, other], t);                 // boot: two candidates, nobody seated
  assert.equal(m.getSlot('P1').state, 'empty');

  other.axes[0] = 0.4;                             // gyro → stick on the desk controller
  m.ingestFrame([held, other], t += 16);
  other.axes[0] = -0.3;
  m.ingestFrame([held, other], t += 16);
  assert.equal(m.getSlot('P1').state, 'empty', 'stick motion must not claim a seat');

  pressA(held);
  m.ingestFrame([held, other], t += 16);
  assert.equal(m.getSlot('P1').state, 'claimed');
  assert.equal(m.getSlot('P1').gamepadIndex, 0, 'P1 is the pad whose button was pressed');
  assert.equal(m.getSlot('P2').state, 'empty', 'the tilted pad is still free');
});

test('a single pad still seats on its first button press', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const p = pad(0);
  m.ingestFrame([], 1000);                         // no pads at boot
  m.ingestFrame([p], 1016);                        // plugged in later, idle
  p.axes[1] = 0.9;
  m.ingestFrame([p], 1032);
  assert.equal(m.getSlot('P1').state, 'empty');
  pressA(p);
  m.ingestFrame([p], 1048);
  assert.equal(m.getSlot('P1').gamepadIndex, 0);
});

test('gamepadHasButtonPress: buttons count, sticks do not', () => {
  const p = pad(0);
  assert.equal(gamepadHasButtonPress(null), false);
  p.axes = [1, -1, 1, -1];
  assert.equal(gamepadHasButtonPress(p), false);
  p.buttons[7].value = 0.8;                        // analog trigger past half
  assert.equal(gamepadHasButtonPress(p), true);
});
