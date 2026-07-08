// ============================================================
// ControllerManager — two Steam Controllers on one Puck seat distinctly
// ============================================================
//
// The 2026 Steam Controller Puck is a multi-receiver: two paired bodies each
// stream STATE on their OWN same-vid:pid vendor interface, and NEITHER appears
// in the Gamepad API (the Puck is vendor-defined HID). So both seat purely via
// ingestFrame's WebHID-activity claim path (hasFreshInput), with no Gamepad pad
// to correlate against. Because the manager pools each interface as its own
// entry with its own synthetic report stream (reports are NOT fanned across
// siblings), a press on body #1 lights only its interface — so P1 binds body #1
// and P2 binds body #2, each to its own gyro/buttons. This is what start:multi
// relies on. See [[multi-steam-controller]].

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, makeSyntheticGamepad } from '../src/manager.js';

// Two distinct physical bodies behind one Puck: identical vid:pid + productName,
// no serial exposed to the browser. Distinguished only by report stream.
function puckDevice() { return { vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck' }; }

// A faithful-enough HID-only entry: fresh input is driven by whatever button is
// currently pressed on THIS entry's own synthetic (its own interface's stream).
function steamEntry(device) {
  const entry = {
    device,
    driver: null,
    fusion: { startCalibration() {}, ingest() {} },
    synthetic: makeSyntheticGamepad(device),
    hasButtons: true,
    _everPressed: false,
    hidActiveSince: 1,     // streaming STATE since boot (~249 Hz)
    slot: null,
    _recentBtns: new Map(),
    destroy() {},
  };
  const anyPressed = () => entry.synthetic.buttons.some((b) => b && (b.pressed || (b.value || 0) > 0.5));
  entry.hasFreshButtonPress = anyPressed;
  entry.hasFreshInput = anyPressed;
  return entry;
}

// Press a button on this body's own interface stream (and mark it as having
// pressed, like a real report would via _everPressed).
function press(entry, i) { entry.synthetic.buttons[i].pressed = true; entry.synthetic.buttons[i].value = 1; entry._everPressed = true; }
function release(entry, i) { entry.synthetic.buttons[i].pressed = false; entry.synthetic.buttons[i].value = 0; }

test('two Steam bodies, sequential presses → P1 binds body A, P2 binds body B', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2', 'P3', 'P4'] });
  const devA = puckDevice(), devB = puckDevice();
  const entryA = steamEntry(devA), entryB = steamEntry(devB);
  m._hidPool.set(devA, entryA);
  m._hidPool.set(devB, entryB);

  // Body A presses to join. No Gamepad pads exist for a Steam Controller.
  press(entryA, 0);                    // cross
  m.ingestFrame([], 1000);
  release(entryA, 0);

  assert.equal(m.getSlot('P1').state, 'claimed', 'P1 claimed by the first body to press');
  assert.equal(m.getSlot('P1')._hidEntry, entryA, 'P1 bound to body A');
  assert.equal(m.getSlot('P2').state, 'empty', 'body B has not pressed yet');
  assert.equal(m._hidPool.has(devA), false, 'body A left the pool');

  // Body B presses to join a second seat.
  press(entryB, 1);                    // circle
  m.ingestFrame([], 1200);
  release(entryB, 1);

  assert.equal(m.getSlot('P2').state, 'claimed', 'P2 claimed by the second body');
  assert.equal(m.getSlot('P2')._hidEntry, entryB, 'P2 bound to body B — its OWN handle, not A again');
  assert.notEqual(m.getSlot('P1')._hidEntry, m.getSlot('P2')._hidEntry, 'distinct physical units per seat');
  assert.equal(m._hidPool.size, 0, 'both bodies bound');
});

test('two Steam bodies pressing in the SAME frame still seat distinctly (no cross-wire)', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const devA = puckDevice(), devB = puckDevice();
  const entryA = steamEntry(devA), entryB = steamEntry(devB);
  m._hidPool.set(devA, entryA);
  m._hidPool.set(devB, entryB);

  press(entryA, 0);
  press(entryB, 3);
  m.ingestFrame([], 1000);

  assert.equal(m.getSlot('P1')._hidEntry, entryA, 'P1 → body A');
  assert.equal(m.getSlot('P2')._hidEntry, entryB, 'P2 → body B');
  assert.equal(m._hidPool.size, 0, 'both bound, one seat each');
});

test('a single Steam body claims exactly ONE seat (not one per streaming interface)', () => {
  // Guards the failure mode where every streaming interface of one body would
  // grab its own seat. Here there is one body = one streaming interface, so
  // exactly one seat should fill.
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const dev = puckDevice();
  const entry = steamEntry(dev);
  m._hidPool.set(dev, entry);

  press(entry, 0);
  m.ingestFrame([], 1000);

  assert.equal(m.getSlot('P1')._hidEntry, entry, 'P1 bound to the one body');
  assert.equal(m.getSlot('P2').state, 'empty', 'no phantom second seat');
});
