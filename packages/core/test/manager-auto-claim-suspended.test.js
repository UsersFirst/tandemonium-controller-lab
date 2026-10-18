// ============================================================
// ControllerManager — autoClaimSuspended
// ============================================================
//
// A seat-select screen wants to be the ONLY thing deciding who owns what.
// Tandemonium's versus step has set `manager.autoClaimSuspended = true` since
// it was written, but the manager never read it: ingestFrame kept
// activity-claiming pads into empty slots and binding pooled HID entries to
// claimed slots by vid:pid. With two identical pads (two DualSenses, or two
// Steam Controllers on one Puck) that bind pulled the second pad's stream into
// Player 1's slot — and the second pad drove the host's menus.
//
// These tests lock the contract: while suspended, no automatic claim and no
// automatic bind; explicit claims still work; a slot keeps what it has.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, makeSyntheticGamepad } from '../src/manager.js';

const DS_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
function makePad(index, id = DS_ID, { buttons = {} } = {}) {
  const btns = [];
  for (let i = 0; i < 17; i++) btns.push({ pressed: false, touched: false, value: 0 });
  for (const [i, v] of Object.entries(buttons)) { btns[i].pressed = !!v; btns[i].value = v ? 1 : 0; }
  return { index, id, mapping: 'standard', connected: true, timestamp: 0, buttons: btns, axes: [0, 0, 0, 0] };
}
const dev = (name = 'DualSense Wireless Controller') => ({ vendorId: 0x054c, productId: 0x0ce6, productName: name });
function fakeEntry(device, { fresh = true } = {}) {
  return {
    device, driver: null, fusion: { startCalibration() {}, ingest() {} },
    synthetic: makeSyntheticGamepad(device), hasButtons: true, hidActiveSince: 1000, _everPressed: true,
    pooledAt: 0, lastRawReportAt: 1000, slot: null, _recentBtns: [],
    hasFreshButtonPress() { return fresh; }, hasFreshInput() { return fresh; }, destroy() {},
  };
}

// Two frames: the first records axis baselines, the second sees the press as fresh.
function press(m, pads, t = 1000) { m.ingestFrame(pads, t); m.ingestFrame(pads, t + 16); }

test('suspended: a pressed, unclaimed Gamepad pad is NOT auto-claimed; unsuspended it is', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  m.autoClaimSuspended = true;
  press(m, [makePad(0, DS_ID, { buttons: { 0: true } })]);
  assert.equal(m.getSlot('P1').state, 'empty', 'no activity claim while suspended');
  m.autoClaimSuspended = false;
  press(m, [makePad(0, DS_ID, { buttons: { 0: true } })], 2000);
  assert.equal(m.getSlot('P1').state, 'claimed', 'activity claim resumes');
});

test('suspended: a pooled HID entry with fresh input neither claims an empty slot nor binds to a claimed same-vid:pid slot', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  // P1: a DualSense over the Gamepad API, explicitly seated (host).
  assert.equal(m.claimPadForSlot('P1', makePad(0)), true);
  assert.equal(m.getSlot('P1')._hidEntry, null);
  // A SECOND DualSense arrives through WebHID (same vid:pid) and is pressed.
  const d2 = dev();
  m._hidPool.set(d2, fakeEntry(d2));
  m.autoClaimSuspended = true;
  press(m, [makePad(0)]);
  assert.equal(m.getSlot('P1')._hidEntry, null, 'the second pad was NOT bound into the host slot');
  assert.equal(m.getSlot('P2').state, 'empty', 'and was NOT auto-claimed into the empty seat');
  assert.equal(m._hidPool.has(d2), true, 'it stays pooled — a candidate for the seat screen');
});

test('suspended: explicit claims still work (the seat screen is the claimer)', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2', 'P3'] });
  m.autoClaimSuspended = true;
  assert.equal(m.claimPadForSlot('P1', makePad(0)), true, 'explicit pad claim');
  const d2 = dev();
  m._hidPool.set(d2, fakeEntry(d2));
  const slot = m.claimHidDeviceForSlot('P2', d2);
  assert.ok(slot, 'explicit HID claim');
  assert.equal(m.getSlot('P2').state, 'claimed');
  assert.equal(m.getSlot('P2')._hidEntry?.device, d2, 'bound to the seat that claimed it');
  press(m, [makePad(0)], 3000);
  assert.equal(m.getSlot('P1').gamepadIndex, 0, 'P1 keeps its pad across frames');
  assert.equal(m.getSlot('P3').state, 'empty');
});

test('not suspended (default): the vid:pid bind still happens — the behaviour the flag exists to stop', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  assert.equal(m.claimPadForSlot('P1', makePad(0)), true);
  const d2 = dev();
  m._hidPool.set(d2, fakeEntry(d2));
  press(m, [makePad(0)]);
  assert.equal(m.autoClaimSuspended, false);
  assert.ok(m.getSlot('P1')._hidEntry, 'without the flag the same-vid:pid entry binds to P1 (documented, pre-existing)');
});
