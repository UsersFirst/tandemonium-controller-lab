// ============================================================
// Controller units — acceptance cases ported from Tandemonium (#141 / game #607)
// ============================================================
//
// The game's smokes (scripts/smoke-webhid.mjs, smoke-steam-input.mjs) ran the
// real drivers + ControllerManager in headless Chrome with fake devices. These
// are the same scenarios at the manager level, on test/harness/rig.js: real
// drivers, real HidEntry parsing, a virtual clock. Case ids match the game's
// docs/test-script.md.
//
// See docs/controller-units.md for the model these encode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, hidDevice, FACE_A, FACE_B } from './harness/rig.js';

/** Run `fn(rig)` and always dispose the rig (restores the clock and navigator). */
async function withRig(opts, fn) {
  const rig = await makeRig(opts);
  try { await fn(rig); } finally { rig.dispose(); }
}

const STEAM_ONE_SLOT = [{ index: 0, handle: '100', type: '14' }];

/** One physical press: the body's HID report now, its XInput twin `lagMs` later (Steam's late virtual press). */
function pressWithTwin(rig, key, bit, twinIdx, padBtn = 'A', { lagMs = 8, holdMs = 120 } = {}) {
  rig.hid.hold(key, bit, true);
  if (lagMs > 0) rig.tick(lagMs);
  rig.pads.hold(twinIdx, padBtn, true);
  rig.tick(holdMs);
  rig.hid.hold(key, bit, false);
  if (lagMs > 0) rig.tick(lagMs);
  rig.pads.hold(twinIdx, padBtn, false);
  rig.tick(300);
}

test('IN-10 · Steam Controller via Puck: HID-only seat by pressing A', async () => {
  await withRig({ hid: [hidDevice.steamPuck('puck')] }, (rig) => {
    const pooled = [...rig.mgr._hidPool.values()].find((e) => rig.keyOf(e.device) === 'puck');
    assert.ok(pooled, 'the Puck interface is pooled');
    assert.equal(pooled.driver.entry.name, 'Steam Controller 2026 (via Puck)');
    assert.ok(rig.hid.stats('puck').featureSends >= 2, 'lizard-mode handshake sent (CLEAR + SET_SETTINGS)');
    assert.equal(rig.seat('P1').state, 'empty', 'no seat until a button is pressed');
    rig.hid.hold('puck', FACE_A.steam, true);
    rig.tick(50);
    rig.hid.hold('puck', FACE_A.steam, false);
    assert.deepEqual(rig.seat('P1'), { id: 'P1', state: 'claimed', hid: 'puck', pad: null }, 'pressing A seats P1 on the Puck over WebHID');
  });
});

test('MC-11 · two identical DualSense keep their own seats across a disconnect + reconnect', async () => {
  await withRig({ hid: [hidDevice.dualsenseUsb('ds-a'), hidDevice.dualsenseUsb('ds-b')] }, async (rig) => {
    const a = rig.pads.plug('dualsense'), b = rig.pads.plug('dualsense');
    rig.tick(50);
    const both = (pad, key, on) => { rig.hid.hold(key, FACE_A.ds5Usb, on); rig.pads.hold(pad, 'A', on); };
    both(a, 'ds-a', true); rig.tick(100); both(a, 'ds-a', false); rig.tick(300);
    both(b, 'ds-b', true); rig.tick(100); both(b, 'ds-b', false); rig.tick(300);
    assert.deepEqual(rig.seat('P1'), { id: 'P1', state: 'claimed', hid: 'ds-a', pad: a });
    assert.deepEqual(rig.seat('P2'), { id: 'P2', state: 'claimed', hid: 'ds-b', pad: b });

    rig.pads.unplug(b);
    rig.hid.disconnect('ds-b');
    rig.tick(50);
    assert.equal(rig.seat('P2').state, 'orphan', 'B unplugged → P2 orphaned');
    assert.equal(rig.seat('P1').hid, 'ds-a', 'P1 keeps unit A');

    await rig.connect('ds-b');
    rig.pads.replug(b);
    rig.tick(100);
    if (rig.seat('P2').state !== 'claimed' || rig.seat('P2').hid !== 'ds-b') { both(b, 'ds-b', true); rig.tick(100); both(b, 'ds-b', false); rig.tick(200); }
    assert.equal(rig.hid.stats('ds-b').objects, 2, 'the reconnect handed out a new HIDDevice object');
    assert.deepEqual(rig.seat('P2'), { id: 'P2', state: 'claimed', hid: 'ds-b', pad: b }, 'B back → P2 reclaimed with unit B');
    assert.deepEqual(rig.seat('P1'), { id: 'P1', state: 'claimed', hid: 'ds-a', pad: a }, 'P1 still on unit A');
  });
});

test('MC-12 · two Puck bodies + an idle receiver interface: two seats, no cross-wiring', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1'), hidDevice.steamPuck('body-2'), hidDevice.puckIdleSibling('puck-idle')] }, (rig) => {
    rig.tapHid('body-1', FACE_A.steam, 60).tick(300);
    rig.tapHid('body-2', FACE_A.steam, 60).tick(300);
    assert.equal(rig.seat('P1').hid, 'body-1');
    assert.equal(rig.seat('P2').hid, 'body-2');
    assert.deepEqual(rig.seatsHolding('puck-idle'), [], 'the idle receiver interface takes no seat');
    const seated = rig.roster().filter((r) => r.kind === 'slot');
    assert.equal(seated.length, 2, 'the roster lists two seated controllers');
    assert.equal(rig.roster().length, 2, 'and nothing else: the idle interface is not a controller');
    assert.equal(rig.mgr.units().length, 2, 'two physical controllers');
  });
});

test('MC-16 · co-op, two Puck bodies: the stoker stands up (B) and A seats it again on its own body', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1'), hidDevice.steamPuck('body-2'), hidDevice.puckIdleSibling('puck-idle')] }, (rig) => {
    rig.tapHid('body-1', FACE_A.steam, 60).tick(300);
    rig.tapHid('body-2', FACE_A.steam, 60).tick(300);
    assert.equal(rig.seat('P2').hid, 'body-2');
    // The app's "stand up" (B) is releaseSlotToPool.
    rig.tapHid('body-2', FACE_B.steam, 60);
    assert.equal(rig.mgr.releaseSlotToPool('P2', rig.now), true);
    rig.tick(rig.mgr.opts.reclaimCooldownMs + 200);
    assert.equal(rig.seat('P2').state, 'empty');
    rig.tapHid('body-2', FACE_A.steam, 60).tick(200);
    assert.deepEqual(rig.seatsHolding('body-2'), ['P2'], 'A seats body 2 again, on its own body');
    assert.equal(rig.seat('P1').hid, 'body-1');
  });
});

test('MC-17 · under Steam each body is also an XInput pad (slot map ≠ pad count): the twin never shows nor takes a seat', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1'), hidDevice.steamPuck('body-2'), hidDevice.puckIdleSibling('puck-idle')], steam: STEAM_ONE_SLOT }, (rig) => {
    const twin1 = rig.pads.plug('xbox', { hidden: true });
    const twin2 = rig.pads.plug('xbox', { hidden: true });
    rig.tick(50);
    // Body 1 and its twin pressed in the same instant (same game frame).
    pressWithTwin(rig, 'body-1', FACE_A.steam, twin1, 'A', { lagMs: 0 });
    assert.deepEqual(rig.seat('P1'), { id: 'P1', state: 'claimed', hid: 'body-1', pad: null }, 'P1 is body 1, not its twin');
    pressWithTwin(rig, 'body-2', FACE_A.steam, twin2, 'A');
    assert.deepEqual(rig.seatsHolding('body-2'), ['P2'], 'body 2 takes the next seat on its own body');
    const twinSeats = () => rig.mgr.slots.filter((s) => s.state === 'claimed' && (s.gamepadIndex === twin1 || s.gamepadIndex === twin2)).map((s) => s.id);
    assert.deepEqual(twinSeats(), [], 'no seat holds a twin');
    const xboxRows = () => rig.roster().filter((r) => /xbox/i.test(r.name || ''));
    assert.deepEqual(xboxRows(), [], 'no "Xbox" row');
    // Stand up with B (pressed on body + twin), then A again.
    pressWithTwin(rig, 'body-2', FACE_B.steam, twin2, 'B');
    rig.mgr.releaseSlotToPool('P2', rig.now);
    rig.tick(rig.mgr.opts.reclaimCooldownMs + 200);
    assert.deepEqual(xboxRows(), [], 'no "Xbox" twin row after standing up');
    pressWithTwin(rig, 'body-2', FACE_A.steam, twin2, 'A');
    assert.deepEqual(rig.seat('P2'), { id: 'P2', state: 'claimed', hid: 'body-2', pad: null }, 'A seats body 2 again; the twin claimed nothing');
    assert.deepEqual(twinSeats(), []);
    assert.equal(rig.mgr.units().length, 2, 'two units, not four');
  });
});

test('MC-18 · quick taps under Steam, twin press late AND early: no slot holds a twin; P1 stays on its body', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1'), hidDevice.steamPuck('body-2'), hidDevice.puckIdleSibling('puck-idle')], steam: STEAM_ONE_SLOT }, (rig) => {
    const twin1 = rig.pads.plug('xbox', { hidden: true });
    const twin2 = rig.pads.plug('xbox', { hidden: true });
    rig.tick(50);
    pressWithTwin(rig, 'body-1', FACE_A.steam, twin1, 'A', { lagMs: 0 });
    assert.equal(rig.seat('P1').hid, 'body-1');
    const tap = (key, padIdx, padFirst) => {
      if (padFirst) { rig.tapPad(padIdx, 'A', 70); rig.tick(40); rig.tapHid(key, FACE_A.steam, 70); }
      else { rig.tapHid(key, FACE_A.steam, 70); rig.tick(90); rig.tapPad(padIdx, 'A', 70); }
      rig.tick(250);
    };
    for (let i = 0; i < 4; i++) tap('body-1', twin1, false);     // P1 taps; its twin lags
    for (let i = 0; i < 3; i++) tap('body-2', twin2, false);     // body 2 taps; twin lags
    tap('body-2', twin2, true);                                  // twin first, hardware after
    rig.tick(1000);
    const held = rig.mgr.slots.filter((s) => s.state === 'claimed' && (s.gamepadIndex === twin1 || s.gamepadIndex === twin2) && !s._hidEntry).map((s) => s.id);
    assert.deepEqual(held, [], 'no slot holds an XInput twin');
    assert.equal(rig.seat('P1').hid, 'body-1', 'Player 1 is still body 1, never its twin');
    assert.equal(rig.mgr.slots.filter((s) => s.state === 'claimed').length, 2, 'two controllers, two seats');
  });
});

test('MC-19 · P1 free, a DualSense behind its frozen Gamepad twin: ✕ over WebHID only makes it P1', async () => {
  await withRig({ hid: [hidDevice.dualsenseUsb('ds')] }, (rig) => {
    const i = rig.pads.plug('dualsense');
    rig.pads.freeze(i);                  // listed from compat-mode reports, then the driver switched it to 0x31
    rig.tick(800);
    assert.equal(rig.seat('P1').state, 'empty', '(setup) nobody holds Player 1');
    rig.hid.hold('ds', FACE_A.ds5Usb, true);
    rig.tick(100);
    rig.hid.hold('ds', FACE_A.ds5Usb, false);
    assert.equal(rig.seat('P1').state, 'claimed', '✕ on the DualSense (WebHID only) seats Player 1');
    assert.equal(rig.seat('P1').hid, 'ds');
  });
});

test('MC-20 · a Puck body as P1 goes silent: seat freed after 4 s, gone from the roster, back on a press', async () => {
  await withRig({ hid: [hidDevice.steamPuck('body-1'), hidDevice.puckIdleSibling('puck-idle'), hidDevice.dualsenseUsb('ds')] }, (rig) => {
    rig.tapHid('body-1', FACE_A.steam, 60).tick(200);
    assert.equal(rig.seat('P1').hid, 'body-1');
    assert.equal(rig.mgr.getSlot('P1').connected, true, '(setup) P1 connected');
    rig.hid.silence('body-1', true);
    rig.tick(2000);
    assert.equal(rig.seat('P1').state, 'claimed', 'a 2 s pause is not "switched off"');
    rig.tick(2500);
    assert.equal(rig.seat('P1').state, 'empty', 'no reports for 4 s: body 1 gives up Player 1');
    assert.ok(rig.lastResult.released.includes('P1') || rig.mgr.getSlot('P1').state === 'empty');
    assert.ok(!rig.roster().some((r) => /steam controller/i.test(r.name || '')), 'and drops out of the controller list');
    rig.hid.silence('body-1', false);
    rig.tick(100);
    rig.tapHid('body-1', FACE_A.steam, 60).tick(200);
    assert.equal(rig.seat('P1').hid, 'body-1', 'switched back on, a press seats it as Player 1 again');
  });
});

test('IN-19 · two Steam Controllers as virtual XInput pads, gyro on the stick: the desk one never takes P1, the pressed one does', async () => {
  await withRig({ steam: [{ index: 0, handle: '100', type: '14' }, { index: 1, handle: '101', type: '14' }] }, (rig) => {
    rig.pads.plug('xbox'); rig.pads.plug('xbox');
    rig.tick(300);
    rig.pads.stick(1, 'LX', 0.3); rig.tick(300);
    rig.pads.stick(1, 'LX', -0.2); rig.tick(300);
    rig.pads.stick(1, 'LX', 0); rig.tick(300);
    assert.equal(rig.seat('P1').state, 'empty', 'tilting a second Steam Controller does not take Player 1');
    rig.tapPad(0, 'A', 120).tick(300);
    assert.equal(rig.seat('P1').state, 'claimed');
    assert.equal(rig.seat('P1').pad, 0, 'the controller you press on is Player 1');
  });
});
