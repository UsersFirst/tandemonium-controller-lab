// ============================================================
// ControllerManager.controllerRoster / slotIdentity
// ============================================================
//
// Every controller the page can see, one row each, with the states the seat
// screens use (connected → joined → seated → ready). Feeds uf-controller-roster
// (strip on seat screens, list in the Controls sheet) in the lab lobby and in
// Tandemonium. See docs/UI-KIT-TV-COMPONENTS.md §2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager } from '../src/manager.js';

const ID = {
  dualsense: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
  switchPro: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
  xbox: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
};

function makePad(index, id, { buttons = {}, axes = [0, 0, 0, 0] } = {}) {
  const btns = [];
  for (let i = 0; i < 17; i++) btns.push({ pressed: false, touched: false, value: 0 });
  for (const [i, v] of Object.entries(buttons)) { btns[i].pressed = !!v; btns[i].value = v ? 1 : 0; }
  return { index, id, mapping: 'standard', connected: true, timestamp: 0, buttons: btns, axes };
}

function seatP1(m, pads) {
  m.ingestFrame(pads.map((p, i) => (i === 0 ? makePad(p.index, p.id, { buttons: { 0: true } }) : p)), 1000);
  assert.equal(m.getSlot('P1').state, 'claimed', 'precondition: P1 claimed');
}

test('a claimed slot is JOINED; unclaimed pads are CONNECTED', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const pads = [makePad(0, ID.dualsense), makePad(1, ID.switchPro)];
  seatP1(m, pads);
  const rows = m.controllerRoster(pads);
  assert.equal(rows.length, 2);
  const [p1, sp] = rows;
  assert.deepEqual([p1.kind, p1.slotId, p1.state, p1.shortName, p1.glyphFamily, p1.connection], ['slot', 'P1', 'joined', 'DualSense', 'playstation', 'gamepad']);
  assert.deepEqual([sp.kind, sp.state, sp.shortName, sp.glyphFamily, sp.gamepadIndex], ['pad', 'connected', 'Switch Pro', 'nintendo', 1]);
  assert.equal(p1.key, 's:P1');
  assert.equal(sp.key, 'g:1');
});

test('seatOf turns a joined slot into SEATED or READY, with player and seat', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const pads = [makePad(0, ID.dualsense)];
  seatP1(m, pads);

  let rows = m.controllerRoster(pads, { seatOf: () => ({ player: 1 }) });
  assert.deepEqual([rows[0].state, rows[0].player, rows[0].seat], ['joined', 1, null], 'a player number without a seat stays joined');

  rows = m.controllerRoster(pads, { seatOf: () => ({ player: 1, seat: { team: 'coop', role: 'captain' } }) });
  assert.equal(rows[0].state, 'seated');
  assert.deepEqual(rows[0].seat, { team: 'coop', role: 'captain' });

  rows = m.controllerRoster(pads, { seatOf: () => ({ player: 1, seat: { team: 'a' }, ready: true }) });
  assert.equal(rows[0].state, 'ready');
  assert.deepEqual(rows[0].seat, { team: 'a', role: null });
});

test('more controllers than seats: every one is listed (the review asked for 8)', () => {
  const m = new ControllerManager({ slotIds: ['P1', 'P2'] });
  const pads = [makePad(0, ID.dualsense), makePad(1, ID.switchPro), makePad(2, ID.xbox), makePad(3, ID.dualsense)];
  seatP1(m, pads);
  const rows = m.controllerRoster(pads, { keyboard: true });
  assert.equal(rows.length, 5, '1 joined + 3 connected pads + keyboard');
  assert.deepEqual(rows.map((r) => r.state), ['joined', 'connected', 'connected', 'connected', 'connected']);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'keys are unique, even for two DualSenses');
});

test('a stuck-stick ghost pad and a pad the host filters out are skipped', () => {
  const m = new ControllerManager({ slotIds: ['P1'], padFilter: (gp) => gp.index !== 2 });
  const pads = [makePad(0, ID.dualsense), makePad(1, ID.switchPro, { axes: [0.9, 0, 0, 0] }), makePad(2, ID.xbox)];
  const rows = m.controllerRoster(pads);
  assert.deepEqual(rows.map((r) => r.gamepadIndex), [0], 'ghost (index 1) and filtered (index 2) are not rows');
});

test('pooled WebHID entries are CONNECTED; idle Puck siblings hidden; a matching pad is not repeated', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  class FanoutDriver {} FanoutDriver.needsSiblingFanout = true;
  const puck = { vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck' };
  const ds = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
  m._hidPool.set(puck, { device: puck, driver: Object.assign(new FanoutDriver(), { connectionType: 'usb' }), hidActiveSince: 1, synthetic: null });
  m._hidPool.set({ id: 'idle' }, { device: puck, driver: new FanoutDriver(), hidActiveSince: 0, synthetic: null });
  m._hidPool.set(ds, { device: ds, driver: { connectionType: 'bluetooth' }, hidActiveSince: 0, synthetic: null });

  const rows = m.controllerRoster([makePad(0, ID.dualsense)]);
  assert.equal(rows.length, 2, 'streaming Puck body + DualSense; idle sibling hidden; the DualSense pad is the pooled row');
  const [p, d] = rows;
  assert.deepEqual([p.kind, p.state, p.shortName, p.connection, p.glyphFamily], ['pool', 'connected', 'Steam Controller', 'puck', 'steam']);
  assert.equal(p.name, 'Steam Controller 2026 (via Puck)');
  assert.deepEqual([d.shortName, d.connection, d.hwName], ['DualSense', 'bluetooth', 'DualSense Wireless Controller']);
});

test('keyboard row: connected by default, seated through its own seat info', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  let [k] = m.controllerRoster([], { keyboard: true });
  assert.deepEqual([k.kind, k.key, k.state, k.glyphFamily, k.connection], ['keyboard', 'k', 'connected', 'keyboard', 'keyboard']);
  [k] = m.controllerRoster([], { keyboard: { player: 2, seat: { team: 'coop', role: 'stoker' } } });
  assert.deepEqual([k.state, k.player, k.seat.role], ['seated', 2, 'stoker']);
  assert.equal(m.controllerRoster([]).length, 0, 'no keyboard row unless asked');
});

test('slotIdentity prefers the bound driver entry over the Gamepad label', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const pads = [makePad(0, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')];
  seatP1(m, pads);
  assert.equal(m.slotIdentity('P1').shortName, 'DualShock 4', 'label alone: the Sony entry');
  // Bind a HID entry whose driver identified a GameSir clone by its IMU layout.
  const superNova = { name: 'GameSir Super Nova (DS4 mode)', shortName: 'Super Nova', protocol: 'dualsense' };
  m.getSlot('P1')._hidEntry = { device: { vendorId: 0x054c, productId: 0x09cc }, driver: { entry: superNova, connectionType: 'usb' } };
  const id = m.slotIdentity('P1');
  assert.deepEqual([id.shortName, id.glyphFamily], ['Super Nova', 'playstation']);
  assert.equal(m.controllerRoster(pads)[0].connection, 'usb');
  assert.equal(m.slotIdentity('nope').shortName, 'Controller');
});

test('active reflects input this frame', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const rows = m.controllerRoster([makePad(0, ID.switchPro, { buttons: { 1: true } }), makePad(1, ID.xbox)]);
  // index 0 has a button down but it's unclaimed: still a connected, active row
  assert.deepEqual(rows.map((r) => r.active), [true, false]);
});
