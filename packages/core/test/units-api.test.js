// ============================================================
// Controller units — public API and the edges of the twin rules
// ============================================================
//
// The acceptance and bug-table tests cover what the TV saw. These pin the API
// apps build on (units(), unit.frame(), steamSlot, slot presence events,
// ingestFrame's `why`) and the cases the twin rules must NOT break: a real Xbox
// pad next to a Steam Controller still joins, and a pad wrongly taken for a
// twin is let go on its first press of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, hidDevice, FACE_A } from './harness/rig.js';

async function withRig(opts, fn) {
  const rig = await makeRig(opts);
  try { await fn(rig); } finally { rig.dispose(); }
}

test('a real Xbox pad beside a pooled Steam Controller (no Steam) still joins: its first press waits twinClaimHoldMs, then claims', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1')] }, (rig) => {
    const x = rig.pads.plug('xbox');
    rig.tick(50);
    const id0 = rig.mgr.unitForPad(x).id;
    rig.tapPad(x, 'A', 40);                   // a quick tap, released before the hold ends
    assert.equal(rig.seat('P1').state, 'empty', 'held while the Steam Controller might report the same press');
    assert.equal(rig.mgr.unitForPad(x).id, id0, 'the pad keeps its unit (and roster row) while it waits');
    rig.tick(rig.mgr.opts.twinClaimHoldMs + 50);
    assert.deepEqual(rig.seat('P1'), { id: 'P1', state: 'claimed', hid: null, pad: x }, 'then the tap claims, released or not');
    assert.equal(rig.mgr.isTwinPad(x), false);
  });
});

test('a pad taken for a twin (pressed with the Steam Controller) is let go on its first press of its own', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1')] }, (rig) => {
    const x = rig.pads.plug('xbox', { hidden: true });
    rig.tick(50);
    // Two players hit A in the same instant.
    rig.hid.hold('body-1', FACE_A.steam, true); rig.pads.hold(x, 'A', true);
    rig.tick(80);
    rig.hid.hold('body-1', FACE_A.steam, false); rig.pads.hold(x, 'A', false);
    rig.tick(100);
    assert.equal(rig.mgr.isTwinPad(x), true, 'indistinguishable from a twin on that press');
    rig.tick(rig.mgr.opts.twinWindowMs + 100);
    rig.tapPad(x, 'B', 60);                   // the Xbox alone: no hardware press to mirror
    rig.tick(rig.mgr.opts.twinClaimHoldMs + 50);
    assert.equal(rig.mgr.isTwinPad(x), false, 'not a twin after all');
    rig.tapPad(x, 'A', 60).tick(rig.mgr.opts.twinClaimHoldMs + 50);
    assert.equal(rig.mgr.slots.filter((s) => s.gamepadIndex === x).length, 1, 'and it joins like any pad');
  });
});

test('units(): one per physical controller with sources, identity and a merged frame; twins are sources, not units', async () => {
  await withRig({ hid: [hidDevice.dualsenseUsb('ds'), hidDevice.steamPuck('body-1')], steam: [{ index: 0, handle: '100', type: '14' }] }, (rig) => {
    rig.mgr.autoClaimSuspended = true;
    const dsPad = rig.pads.plug('dualsense');
    const twin = rig.pads.plug('xbox', { hidden: true });
    rig.tick(50);
    rig.hid.hold('body-1', FACE_A.steam, true); rig.tick(8); rig.pads.hold(twin, 'A', true); rig.tick(60);
    const units = rig.mgr.units();
    assert.equal(units.length, 2);
    const ds = rig.mgr.unitForDevice(rig.hid.device('ds'));
    const sc = rig.mgr.unitForDevice(rig.hid.device('body-1'));
    assert.deepEqual(ds.sources.map((x) => x.kind), ['webhid', 'gamepad']);
    assert.equal(ds.padIndex, dsPad);
    assert.equal(ds.identity.name, 'Sony DualSense');
    assert.deepEqual(sc.sources.map((x) => x.kind), ['webhid', 'steam-xinput']);
    assert.equal(rig.mgr.unitForPad(twin), sc, 'the twin index resolves to its controller');
    assert.equal(sc.frame().buttons[0].pressed, true, 'frame reads the hardware');
    rig.hid.hold('body-1', FACE_A.steam, false); rig.tick(16);
    assert.equal(sc.frame().buttons[0].pressed, false, 'and not the twin\'s late echo');
    assert.ok(units.every((u) => typeof u.key === 'string' && u.presence === 'present' && u.connected));
  });
});

test('a pad-only Steam-captured controller carries its Steam slot (so an app can tell its stick is Steam\'s gyro)', async () => {
  await withRig({ steam: [{ index: 0, handle: '100', type: '14' }, { index: 1, handle: '101', type: '13' }] }, (rig) => {
    rig.pads.plug('xbox'); rig.pads.plug('xbox');
    rig.tick(50);
    assert.deepEqual(rig.mgr.unitForPad(0).steamSlot, { index: 0, handle: '100', type: '14' });
    assert.equal(rig.mgr.unitForPad(1).steamSlot.type, '13');
    assert.equal(rig.mgr.units().length, 2);
  });
});

test('claimPadForSlot on a twin seats its controller over WebHID', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1')], steam: [{ index: 0, handle: '100', type: '14' }] }, (rig) => {
    rig.mgr.autoClaimSuspended = true;
    const twin = rig.pads.plug('xbox');
    rig.tick(50);
    assert.equal(rig.mgr.isTwinPad(twin), true, 'Steam\'s map names it (counts agree), before any press');
    assert.equal(rig.mgr.claimPadForSlot('P2', rig.pads.snapshot()[twin], rig.pads.snapshot()), true);
    assert.deepEqual(rig.seat('P2'), { id: 'P2', state: 'claimed', hid: 'body-1', pad: null });
  });
});

test('presence: slot emits "presence" on silence and return; ingestFrame says why a seat was released', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1')] }, (rig) => {
    rig.tapHid('body-1', FACE_A.steam, 60).tick(100);
    const events = [];
    rig.mgr.getSlot('P1').on((s, reason, data) => { if (reason === 'presence' || reason === 'released') events.push([reason, data && data.connected]); });
    rig.mgr.releaseSilentSeats = false;
    rig.hid.silence('body-1', true); rig.tick(4200);
    rig.hid.silence('body-1', false); rig.tick(50);
    assert.deepEqual(events, [['presence', false], ['presence', true]]);
    rig.mgr.releaseSilentSeats = true;
    rig.hid.silence('body-1', true);
    let why = null;
    for (let i = 0; i < 300 && !why; i++) { rig.tick(16); why = rig.lastResult.why.P1 || null; }
    assert.equal(why, 'silent');
    assert.equal(rig.mgr.getSlot('P1').releaseReason, 'silent');
  });
});
