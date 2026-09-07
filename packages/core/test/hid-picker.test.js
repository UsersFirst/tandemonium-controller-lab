// ============================================================
// pickNewHidDevice — which device should an OS HID picker grant?
// ============================================================
//
// The failure this exists to prevent: a host that always hands back the first
// device makes pairing a SECOND controller impossible, because every
// requestDevice() re-grants the one already held. The cases below are the ones
// that actually occur on a desk with more than one pad — in particular TWO
// IDENTICAL pads, where a flat vid:pid exclusion would refuse the second.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickNewHidDevice } from '../src/controller-inventory.js';

const DS = { vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller' };
const PUCK = { vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck' };
const dev = (id, base, extra = {}) => ({ deviceId: id, ...base, ...extra });

test('no devices offered → nothing picked, and it says so', () => {
  const { device, reason } = pickNewHidDevice([]);
  assert.equal(device, null);
  assert.match(reason, /no devices/i);
});

test('nothing held → the first device', () => {
  const a = dev('a', PUCK), b = dev('b', DS);
  assert.equal(pickNewHidDevice([a, b]).device, a);
});

test('prefers a model we do not hold at all (the Puck + DualSense case)', () => {
  // The laptop case: the Puck was granted in an earlier session and is pooled
  // across five interfaces; the DualSense has never been granted.
  const puckIfaces = [0, 1, 2, 3, 4].map((i) => dev('p' + i, PUCK));
  const ds = dev('ds', DS);
  const held = puckIfaces.map(() => ({ ...PUCK }));
  const { device, reason } = pickNewHidDevice([...puckIfaces, ds], { held });
  assert.equal(device, ds, 'the DualSense is the only thing new');
  assert.match(reason, /new device/);
});

test('TWO IDENTICAL pads: holding one still pairs the other', () => {
  // Same vid:pid, no serials — a flat "exclude this vid:pid" rule would refuse
  // to pair the second pad. Counts decide it: two attached, one held.
  const first = dev('ds1', DS), second = dev('ds2', DS);
  const { device, reason } = pickNewHidDevice([first, second], { held: [{ ...DS }] });
  assert.equal(device, first, 'picks a unit of that model rather than refusing');
  assert.match(reason, /spare unit/);

  // And once both are held, nothing reads as spare.
  const both = pickNewHidDevice([first, second], { held: [{ ...DS }, { ...DS }] });
  assert.match(both.reason, /cannot tell units apart/);
});

test('a second Steam Controller body on a held Puck reads as a spare interface', () => {
  // Two bodies stream on their own interfaces of one receiver; the app has
  // pooled only one so far.
  const ifaces = [0, 1, 2].map((i) => dev('p' + i, PUCK));
  const { device, reason } = pickNewHidDevice(ifaces, { held: [{ ...PUCK }] });
  assert.ok(ifaces.includes(device));
  assert.match(reason, /spare unit/);
});

test('serials decide it outright when the picker has them', () => {
  const mine = dev('a', DS, { serialNumber: 'AA:BB:CC:DD:EE:01' });
  const theirs = dev('b', DS, { serialNumber: 'AA:BB:CC:DD:EE:02' });
  const held = [{ ...DS, serialNumber: 'AA:BB:CC:DD:EE:01' }];
  const { device, reason } = pickNewHidDevice([mine, theirs], { held });
  assert.equal(device, theirs, 'the serial we hold is skipped even though the model matches');
  assert.match(reason, /new device/);

  // Every serial held → the pick is honest about it.
  const all = pickNewHidDevice([mine, theirs], {
    held: [{ ...DS, serialNumber: 'AA:BB:CC:DD:EE:01' }, { ...DS, serialNumber: 'AA:BB:CC:DD:EE:02' }],
  });
  assert.match(all.reason, /already held \(serial matches\)/);
});

test('grantedIds only breaks ties, so repeated requests walk the list', () => {
  const a = dev('a', PUCK), b = dev('b', DS);
  // Nothing held: both rank equally, so the granted one yields to the other.
  assert.equal(pickNewHidDevice([a, b], { grantedIds: ['a'] }).device, b);
  assert.equal(pickNewHidDevice([a, b], { grantedIds: ['a', 'b'] }).device, a, 'falls back once all are granted');
  // A tie-break never outranks evidence: 'b' is a model we hold, 'a' is not.
  assert.equal(pickNewHidDevice([a, b], { grantedIds: ['a'], held: [{ ...DS }] }).device, a);
});
