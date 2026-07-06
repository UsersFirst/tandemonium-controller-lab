// ============================================================
// ControllerManager — two identical-vid:pid controllers
// ============================================================
//
// A real DualShock 4 and a DS4-spoofing clone (GameSir Super Nova in DS4
// mode) both enumerate as 054c:09cc AND report the same productName
// ("Wireless Controller"), so NOTHING static tells them apart — the browser
// exposes no serial. The old bind path took the first pool entry matching a
// seat's vid:pid, which cross-wired each seat to the wrong unit's HID handle
// (so a seat's gyro came from the other controller). These tests lock the
// report-stream correlation: a seat binds the entry whose OWN synthetic shows
// the same button the seat's Gamepad pad is pressing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, makeSyntheticGamepad } from '../src/manager.js';

const DS4_ID = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';
const DS5_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

function makePad(index, id, { buttons = {}, axes = [0, 0, 0, 0] } = {}) {
  const btns = [];
  for (let i = 0; i < 17; i++) btns.push({ pressed: false, touched: false, value: 0 });
  for (const [i, v] of Object.entries(buttons)) { btns[i].pressed = !!v; btns[i].value = v ? 1 : 0; }
  return { index, id, mapping: 'standard', connected: true, timestamp: 0, buttons: btns, axes: [...axes] };
}

// Two physically distinct units, same vid:pid + productName.
function ds4Device() { return { vendorId: 0x054c, productId: 0x09cc, productName: 'Wireless Controller' }; }

function fakeEntry(device) {
  return {
    device,
    driver: null,
    fusion: { startCalibration() {}, ingest() {} },
    synthetic: makeSyntheticGamepad(device),
    hasButtons: true,
    _everPressed: false,
    hidActiveSince: 0,
    slot: null,
    hasFreshButtonPress() { return false; },  // isolate the Gamepad-API claim + correlation path
    hasFreshInput() { return false; },
    destroy() {},
  };
}
// Simulate the unit's own HID report stream showing a button held (a real press
// also marks the handle as having ever pressed — see _everPressed).
function press(entry, i) { entry.synthetic.buttons[i].pressed = true; entry.synthetic.buttons[i].value = 1; entry._everPressed = true; }

test('claim-time: seat binds the entry whose report stream matches the pressed button', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const devA = ds4Device(), devB = ds4Device();
  const entryA = fakeEntry(devA), entryB = fakeEntry(devB);
  m._hidPool.set(devA, entryA);
  m._hidPool.set(devB, entryB);
  press(entryB, 1);   // the unit being held (circle) is device B

  // Its Gamepad pad shows the same button. First-match-by-vid:pid would grab
  // entryA (inserted first) — correlation must pick entryB instead.
  m.ingestFrame([makePad(0, DS4_ID, { buttons: { 1: true } })], 1000);

  const p1 = m.getSlot('P1');
  assert.equal(p1.state, 'claimed');
  assert.equal(p1._hidEntry, entryB, 'seat must bind the unit that is actually pressing');
  assert.equal(m._hidPool.has(devA), true, 'the other unit stays pooled');
  assert.equal(m._hidPool.has(devB), false, 'bound unit left the pool');
});

test('two identical units → two seats, each bound to its own handle (cascade)', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const devA = ds4Device(), devB = ds4Device();
  const entryA = fakeEntry(devA), entryB = fakeEntry(devB);
  m._hidPool.set(devA, entryA);
  m._hidPool.set(devB, entryB);
  press(entryA, 0);   // device A holds cross
  press(entryB, 3);   // device B holds triangle

  m.ingestFrame([
    makePad(0, DS4_ID, { buttons: { 0: true } }),   // A's pad
    makePad(1, DS4_ID, { buttons: { 3: true } }),   // B's pad
  ], 1000);

  assert.equal(m.getSlot('P1')._hidEntry, entryA, 'P1 (cross) → device A');
  assert.equal(m.getSlot('P2')._hidEntry, entryB, 'P2 (triangle) → device B');
  assert.equal(m._hidPool.size, 0, 'both units bound');
});

test('IMU-only handle (GameSir) binds by identity, not cross-wired to an idle phantom', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  // GameSir spoofs 054c:0ce6 to the Gamepad API but its WebHID handle is an
  // IMU-only 054c:09cc ("Wireless Controller"). An idle real DualSense (0ce6)
  // is also pooled (auto-pooled because the spoofed 0ce6 pad looked "live").
  const gamesirHid = { vendorId: 0x054c, productId: 0x09cc, productName: 'Wireless Controller' };
  const phantomDS = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
  const gsEntry = fakeEntry(gamesirHid); gsEntry.hasButtons = false;   // gyro-only spoof interface
  const dsEntry = fakeEntry(phantomDS); dsEntry.hasButtons = true; dsEntry._everPressed = true;  // a real DualSense that HAS been used
  m._hidPool.set(gamesirHid, gsEntry);
  m._hidPool.set(phantomDS, dsEntry);

  // Seat claims via the GameSir's Gamepad pad (enumerates as DualSense 0ce6).
  const pad = makePad(0, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', { buttons: { 0: true } });
  m.ingestFrame([pad], 1000);

  const p1 = m.getSlot('P1');
  assert.equal(p1.state, 'claimed');
  assert.equal(p1._hidEntry, gsEntry, 'binds the GameSir IMU-only gyro handle');
  assert.equal(m._hidPool.has(phantomDS), true, 'the idle phantom DualSense is NOT bound');
});

test('HID-pool claim fires on fresh stick input (DualSense-BT: invisible to the Gamepad API)', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const dev = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
  const entry = fakeEntry(dev);
  entry.hasFreshInput = () => true;   // a stick nudge (lights the dot) — no face-button press
  m._hidPool.set(dev, entry);

  // No Gamepad pads: a DualSense over BT in 0x31 mode has none, so its only
  // path to ACTIVE is the WebHID claim.
  m.ingestFrame([], 1000);

  assert.equal(m.getSlot('P1').state, 'claimed', 'claims via HID on fresh stick input, not just a button');
  assert.equal(m.getSlot('P1')._hidEntry, entry);
});

test('a WebHID-claimed slot adopts its own Gamepad pad instead of leaving a phantom seat', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const p1 = m.getSlot('P1');
  const dev = { vendorId: 0x054c, productId: 0x05c4, productName: 'Wireless Controller' };
  // Simulate a WebHID-first claim: a DS4 that seated via its HID handle (its
  // synthetic carries buttons now), so gamepadIndex is still null.
  p1.claim({ index: -1, id: 'HID::Wireless Controller Vendor: 054c Product: 05c4', mapping: 'standard' }, { silent: true });
  m._attachEntryToSlot(p1, fakeEntry(dev));
  assert.equal(p1.gamepadIndex, null, 'precondition: WebHID-claimed, no Gamepad pad yet');

  // That device's Gamepad-API pad (same vid:pid) shows up.
  const pad = makePad(0, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 05c4)');
  m.ingestFrame([pad], 1000);

  assert.equal(p1.gamepadIndex, 0, 'pad adopted into the WebHID-claimed slot');
  assert.equal(m.getSlot('P2').state, 'empty', 'no second (phantom) seat for the same physical device');
});

test('windowed fold: a claiming press split across frames (pad first, HID a frame later) still folds', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const a = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
  const b = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
  const eA = fakeEntry(a), eB = fakeEntry(b);
  m._hidPool.set(a, eA); m._hidPool.set(b, eB);

  // Frame 1: the Gamepad pad presses button 2 and claims; neither HID stream
  // shows it yet (report lands a frame later). A same-frame match would miss.
  m.ingestFrame([makePad(0, DS5_ID, { buttons: { 2: true } })], 1000);
  const p1 = m.getSlot('P1');
  assert.equal(p1.state, 'claimed');
  assert.equal(p1._hidEntry, null, 'no fold yet — HID stream has not shown the press');

  // Frame 2 (within foldWindowMs): unit A now reports the same button; pad released.
  press(eA, 2);
  m.ingestFrame([makePad(0, DS5_ID)], 1150);
  assert.equal(p1._hidEntry, eA, 'folds once the HID press lands within the window');
});

test('ambiguous input defers instead of cross-wiring, then resolves on a distinct press', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const devA = ds4Device(), devB = ds4Device();
  const entryA = fakeEntry(devA), entryB = fakeEntry(devB);
  m._hidPool.set(devA, entryA);
  m._hidPool.set(devB, entryB);

  // Frame 1: seat claims on a button, but NEITHER unit's stream shows it yet
  // (HID lag). The old code would have bound entryA (first match) — we must
  // NOT, or we risk cross-wiring.
  const pad = makePad(0, DS4_ID, { buttons: { 0: true } });
  m.ingestFrame([pad], 1000);
  const p1 = m.getSlot('P1');
  assert.equal(p1.state, 'claimed');
  assert.equal(p1._hidEntry, null, 'must defer while it cannot tell the units apart');

  // Frame 2: device B's report stream now shows the held button → resolve.
  press(entryB, 0);
  m.ingestFrame([pad], 1016);
  assert.equal(p1._hidEntry, entryB, 'binds the correlated unit once input disambiguates');
});
