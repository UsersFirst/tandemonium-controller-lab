// ============================================================
// Controller units — the Tandemonium #581 TV-playtest bug table (game #607)
// ============================================================
//
// One test per row of the bug table in lab #141, at the manager level. Each
// failed on core 0.6.3 (the game carried a workaround); docs/controller-units.md
// maps each row to the part of the unit model that prevents it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, hidDevice, FACE_A } from './harness/rig.js';

async function withRig(opts, fn) {
  const rig = await makeRig(opts);
  try { await fn(rig); } finally { rig.dispose(); }
}

test('bug 1 · under Steam, a DualSense on WebHID + its XInput twin: one unit, ✕ seats it when the app claims that unit', async () => {
  // Steam captured the DualSense (type 13 = PS5) and re-emits it as an XInput pad.
  await withRig({ hid: [hidDevice.dualsenseUsb('ds')], steam: [{ index: 0, handle: '200', type: '13' }] }, (rig) => {
    rig.mgr.autoClaimSuspended = true;       // a seat screen: the app is the only claimer
    const twin = rig.pads.plug('xbox', { hidden: true });
    rig.tick(50);
    rig.hid.hold('ds', FACE_A.ds5Usb, true); rig.tick(8);
    rig.pads.hold(twin, 'A', true); rig.tick(60);
    const units = rig.mgr.units();
    assert.equal(units.length, 1, 'one physical controller → one unit');
    const u = units[0];
    assert.equal(rig.keyOf(u.device), 'ds');
    assert.equal(u.twinPadIndex, twin, 'the XInput pad is that unit\'s Steam twin');
    assert.equal(u.frame().buttons[0].pressed, true, 'the unit reads ✕');
    assert.equal(rig.mgr.claimUnitForSlot('P2', u), rig.mgr.getSlot('P2'));
    assert.deepEqual(rig.seat('P2'), { id: 'P2', state: 'claimed', hid: 'ds', pad: null }, 'seated on its WebHID source, never the twin');
  });
});

test('bug 2 · a hot-plugged DualSense: frozen Gamepad entry + live WebHID source are one unit whose frame reads the HID press', async () => {
  await withRig({ hid: [hidDevice.dualsenseUsb('ds')] }, (rig) => {
    rig.mgr.autoClaimSuspended = true;
    const i = rig.pads.plug('dualsense');
    rig.pads.freeze(i);
    rig.tick(100);
    const units = rig.mgr.units();
    assert.equal(units.length, 1, 'one card, not two');
    assert.equal(units[0].padIndex, i, 'the frozen pad is a source of the DualSense unit');
    rig.hid.hold('ds', FACE_A.ds5Usb, true); rig.tick(40);
    assert.equal(units[0].frame().buttons[0].pressed, true, '✕ landing only in the WebHID synthetic reads on the unit');
    rig.hid.hold('ds', FACE_A.ds5Usb, false); rig.tick(40);
  });
});

test('bug 3 · a seated DualSense is listed once, not also as its (frozen) Gamepad entry (seat screen)', async () => {
  await withRig({ hid: [hidDevice.dualsenseUsb('ds')] }, (rig) => {
    rig.mgr.autoClaimSuspended = true;       // versus seat screen: the app seats explicitly
    const i = rig.pads.plug('dualsense');
    rig.pads.freeze(i);
    rig.tick(100);
    assert.ok(rig.mgr.claimHidDeviceForSlot('P1', rig.hid.device('ds')));
    rig.tick(100);
    const rows = rig.roster().filter((r) => /dualsense/i.test(r.name || ''));
    assert.equal(rows.length, 1, 'one roster row for one DualSense');
    assert.equal(rows[0].kind, 'slot');
  });
});

test('bug 4 · Steam\'s "Xbox" twin of a seated Steam Controller, revealed only on its first press, never shows nor takes a seat', async () => {
  // Chromium hides the twin until its first press, so Steam's slot list (two
  // named slots) and Chromium's pad count disagree exactly when it matters.
  await withRig({ hid: [hidDevice.steamPuck('body-1'), hidDevice.steamPuck('body-2')], steam: [{ index: 0, handle: '100', type: '14' }, { index: 1, handle: '101', type: '14' }] }, (rig) => {
    rig.tapHid('body-1', FACE_A.steam, 60).tick(200);
    rig.tapHid('body-2', FACE_A.steam, 60).tick(200);
    assert.equal(rig.seat('P2').hid, 'body-2', '(setup) body 2 is the stoker');
    const twin = rig.pads.plug('xbox', { hidden: true });
    rig.hid.hold('body-2', FACE_A.steam, true); rig.tick(10);
    rig.pads.hold(twin, 'A', true); rig.tick(80);
    rig.hid.hold('body-2', FACE_A.steam, false); rig.tick(10);
    rig.pads.hold(twin, 'A', false); rig.tick(400);
    assert.equal(rig.mgr.slots.filter((s) => s.gamepadIndex === twin).length, 0, 'the twin takes no seat');
    assert.ok(!rig.roster().some((r) => /xbox/i.test(r.name || '')), 'no "Xbox" row');
    assert.equal(rig.mgr.isTwinPad(twin), true);
  });
});

test('bug 5 · a quick tap released on WebHID before its twin reads pressed: the body is P1, the twin holds nothing', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1')], steam: [{ index: 0, handle: '100', type: '14' }] }, (rig) => {
    const twin = rig.pads.plug('xbox', { hidden: true });
    rig.tick(50);
    rig.tapHid('body-1', FACE_A.steam, 40);
    rig.tick(60);                                  // released on WebHID 60 ms before…
    rig.tapPad(twin, 'A', 50);                     // …the twin's late virtual press
    rig.tick(600);
    assert.equal(rig.seat('P1').hid, 'body-1', 'P1 is the body');
    assert.deepEqual(rig.mgr.slots.filter((s) => s.state === 'claimed').map((s) => s.id), ['P1'], 'one controller, one seat');
  });
});

test('bug 5b · the twin\'s press lands BEFORE the hardware\'s, on a twin never seen before: still no twin seat', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1')], steam: [] }, (rig) => {
    const twin = rig.pads.plug('xbox', { hidden: true });
    rig.tick(50);
    rig.tapPad(twin, 'A', 70);
    rig.tick(40);
    rig.tapHid('body-1', FACE_A.steam, 70);
    rig.tick(600);
    assert.equal(rig.mgr.slots.filter((s) => s.state === 'claimed' && s.gamepadIndex === twin && !s._hidEntry).length, 0, 'no slot holds the twin');
    assert.equal(rig.seat('P1').hid, 'body-1', 'the body is Player 1 (the seat its twin\'s press asked for)');
  });
});

test('bug 6 · a DualSense switched on after launch (compat-mode Gamepad entry, then frozen): a WebHID press seats it — no deadlock', async () => {
  await withRig({ hid: [] }, async (rig) => {
    const i = rig.pads.plug('dualsense');         // Chromium lists it from its first compat reports…
    await rig.add(hidDevice.dualsenseUsb('ds'));  // …the driver pools it and switches it to full reports…
    rig.pads.freeze(i);                           // …which freezes the Gamepad entry
    rig.tick(300);
    assert.equal(rig.seat('P1').state, 'empty');
    rig.hid.hold('ds', FACE_A.ds5Usb, true); rig.tick(100);
    rig.hid.hold('ds', FACE_A.ds5Usb, false); rig.tick(100);
    assert.equal(rig.seat('P1').hid, 'ds', 'the press seats it as Player 1');
  });
});

test('bug 7 · Steam Controllers switched off do not stay JOINED holding Player 1; with seat release off, the seat reads disconnected', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1')], manager: { releaseSilentSeats: false } }, (rig) => {
    rig.tapHid('body-1', FACE_A.steam, 60).tick(200);
    const slot = rig.mgr.getSlot('P1');
    assert.equal(slot.connected, true);
    rig.hid.silence('body-1', true);
    rig.tick(4500);
    assert.equal(slot.state, 'claimed', 'the app kept the seat (mid-ride policy)');
    assert.equal(slot.connected, false, 'but it is not connected: the app pauses on this');
    assert.equal(rig.mgr.unitForSlot('P1').presence, 'silent');
    rig.hid.silence('body-1', false);
    rig.tick(50);
    assert.equal(slot.connected, true, 'its first report back reconnects it, no press needed');
    // Seat-screen policy: release.
    rig.mgr.releaseSilentSeats = true;
    rig.hid.silence('body-1', true);
    rig.tick(4500);
    assert.equal(slot.state, 'empty', 'with release on, the seat is freed');
  });
});

test('bug 8 · "switched off" and "never streamed" are different states; timestamps are never zeroed', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1'), hidDevice.puckIdleSibling('idle')], manager: { releaseSilentSeats: false } }, (rig) => {
    rig.tapHid('body-1', FACE_A.steam, 60).tick(200);
    const slot = rig.mgr.getSlot('P1');
    const unit = rig.mgr.unitForSlot('P1');
    rig.hid.silence('body-1', true);
    const lastReport = rig.now;
    rig.tick(1500);                                  // past hidStaleMs (800)
    slot.effectiveGamepad(rig.pads.snapshot());      // used to zero hidActiveSince here
    assert.ok(unit.lastReportAt > 0 && Math.abs(unit.lastReportAt - lastReport) <= 8, 'the last report time survives staleness');
    assert.ok(slot._hidEntry.hidActiveSince > 0, 'effectiveGamepad no longer zeroes hidActiveSince');
    assert.equal(unit.presence, 'present', 'stale is not yet off');
    rig.tick(3000);
    assert.equal(unit.presence, 'silent', 'off after silentAfterMs');
    const idle = rig.mgr.allUnits().find((u) => rig.keyOf(u.device) === 'idle');
    assert.equal(idle.presence, 'latent', 'an idle receiver interface never streamed: latent, not silent');
  });
});
