// Contract + arbiter tests for the WebHID-first input architecture (#80).
// Dependency-free: imports only the pure modules (no `three`, no DOM), so
// it runs under `node --test` with no install — matching the rest of core.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE,
  SOURCE_PRIORITY,
  STANDARD_BUTTON_COUNT,
  makeEmptyFrame,
  frameFromGamepad,
  quatToPlain,
  identityMatchKey,
  chooseSource,
} from '../src/input-frame.js';
import { InputArbiter } from '../src/input-arbiter.js';

// ── makeEmptyFrame ──

test('makeEmptyFrame produces a zeroed standard frame', () => {
  const f = makeEmptyFrame(SOURCE.WEBHID, { label: 'X', vendorId: 1, productId: 2 });
  assert.equal(f.sourceId, SOURCE.WEBHID);
  assert.equal(f.buttons.length, STANDARD_BUTTON_COUNT);
  assert.ok(f.buttons.every((b) => b.pressed === false && b.value === 0));
  assert.deepEqual(f.axes, [0, 0, 0, 0]);
  assert.equal(f.motion, null);
  assert.equal(f.glyphs, null);
  assert.equal(f.identity.label, 'X');
  assert.equal(f.identity.profileKey, null); // defaulted
});

// ── frameFromGamepad ──

test('frameFromGamepad maps buttons, axes, and analog triggers', () => {
  const gp = {
    buttons: Array.from({ length: STANDARD_BUTTON_COUNT }, () => ({ pressed: false, value: 0 })),
    axes: [0.5, -0.5, 0.1, -0.1],
    timestamp: 123,
  };
  gp.buttons[0].pressed = true; gp.buttons[0].value = 1;   // cross
  gp.buttons[6].value = 0.42;                              // L2 analog
  gp.buttons[7].value = 0.99;                              // R2 analog

  const f = frameFromGamepad(gp, { sourceId: SOURCE.WEBHID, identity: { label: 'pad' }, timestamp: 123 });
  assert.equal(f.buttons[0].pressed, true);
  assert.equal(f.buttons[0].touched, true); // derived from pressed when touched absent
  assert.deepEqual(f.axes, [0.5, -0.5, 0.1, -0.1]);
  assert.equal(f.triggers.l2, 0.42);
  assert.equal(f.triggers.r2, 0.99);
  assert.equal(f.timestamp, 123);
});

test('frameFromGamepad does not alias the source gamepad button objects', () => {
  const gp = { buttons: [{ pressed: true, value: 1 }], axes: [] };
  const f = frameFromGamepad(gp, { sourceId: SOURCE.GAMEPAD_API, identity: {} });
  gp.buttons[0].pressed = false; // mutate source after building
  assert.equal(f.buttons[0].pressed, true, 'frame must hold its own copy');
});

test('frameFromGamepad carries motion through unchanged', () => {
  const motion = { quaternion: { x: 0, y: 0, z: 0, w: 1 }, gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 0 }, hasGyro: true };
  const f = frameFromGamepad({ buttons: [], axes: [] }, { sourceId: SOURCE.WEBHID, identity: {}, motion });
  assert.equal(f.motion, motion);
});

// ── quatToPlain ──

test('quatToPlain strips to a plain IPC-safe object and handles null', () => {
  class FakeQuat { constructor() { this.x = 1; this.y = 2; this.z = 3; this.w = 4; this.extra = 'nope'; } }
  const p = quatToPlain(new FakeQuat());
  assert.deepEqual(p, { x: 1, y: 2, z: 3, w: 4 });
  assert.equal(quatToPlain(null), null);
});

// ── identityMatchKey ──

test('identityMatchKey prefers unitId, then vid:pid, then label', () => {
  assert.equal(identityMatchKey({ unitId: 'aa:bb', vendorId: 1, productId: 2 }), 'unit:aa:bb');
  assert.equal(identityMatchKey({ vendorId: 0x054c, productId: 0x0ce6 }), 'vidpid:1356:3302');
  assert.equal(identityMatchKey({ label: 'DualSense' }), 'label:dualsense');
  assert.equal(identityMatchKey({}), 'unknown');
  assert.equal(identityMatchKey(null), 'unknown');
});

// ── chooseSource (WebHID-first selection) ──

test('chooseSource defaults to WebHID-first priority', () => {
  assert.equal(chooseSource([SOURCE.GAMEPAD_API, SOURCE.WEBHID]), SOURCE.WEBHID);
  assert.equal(chooseSource([SOURCE.GAMEPAD_API, SOURCE.STEAM_INPUT]), SOURCE.STEAM_INPUT);
  assert.equal(chooseSource([SOURCE.GAMEPAD_API]), SOURCE.GAMEPAD_API);
  assert.equal(chooseSource([]), null);
});

test('chooseSource: forced wins when available, ignored when not', () => {
  // Deck built-in case: force Steam Input even though WebHID is "present".
  assert.equal(
    chooseSource([SOURCE.WEBHID, SOURCE.STEAM_INPUT], { forced: SOURCE.STEAM_INPUT }),
    SOURCE.STEAM_INPUT,
  );
  // Forced source not actually available ⇒ fall back to priority.
  assert.equal(
    chooseSource([SOURCE.WEBHID], { forced: SOURCE.STEAM_INPUT }),
    SOURCE.WEBHID,
  );
});

test('chooseSource: preference wins over priority but not over force', () => {
  assert.equal(
    chooseSource([SOURCE.WEBHID, SOURCE.STEAM_INPUT], { preference: SOURCE.STEAM_INPUT }),
    SOURCE.STEAM_INPUT,
  );
  assert.equal(
    chooseSource([SOURCE.WEBHID, SOURCE.STEAM_INPUT], { forced: SOURCE.WEBHID, preference: SOURCE.STEAM_INPUT }),
    SOURCE.WEBHID,
  );
});

test('chooseSource accepts Set and object-keyed availability', () => {
  assert.equal(chooseSource(new Set([SOURCE.GAMEPAD_API, SOURCE.WEBHID])), SOURCE.WEBHID);
  assert.equal(chooseSource({ [SOURCE.STEAM_INPUT]: {}, [SOURCE.GAMEPAD_API]: {} }), SOURCE.STEAM_INPUT);
});

assert.deepEqual([...SOURCE_PRIORITY], ['webhid', 'steam-input', 'gamepad-api']);

// ── InputArbiter (dedup + per-controller selection) ──

// Minimal fake source: lists fixed controllers, read() echoes which source produced the frame.
function fakeSource(id, controllers) {
  return {
    id,
    start() {}, stop() {},
    list() { return controllers; },
    read(ctrl) { return { ...makeEmptyFrame(id, ctrl.identity), _readBy: id, _ctrlId: ctrl.id }; },
  };
}

test('arbiter reads exactly one source per physical controller (WebHID wins the dup)', () => {
  const identity = { vendorId: 0x054c, productId: 0x0ce6, label: 'DualSense' };
  const webhid = fakeSource(SOURCE.WEBHID, [{ id: 'w1', identity, hasGyro: true }]);
  const steam = fakeSource(SOURCE.STEAM_INPUT, [{ id: 's1', identity, hasGyro: true }]);

  const arb = new InputArbiter();
  arb.addSource(webhid).addSource(steam);
  const frames = arb.resolve();

  assert.equal(frames.length, 1, 'same physical controller must yield one frame, not two');
  assert.equal(frames[0]._readBy, SOURCE.WEBHID);
});

test('arbiter keeps distinct controllers separate', () => {
  const ds = { vendorId: 0x054c, productId: 0x0ce6, label: 'DualSense' };
  const xb = { vendorId: 0x045e, productId: 0x02ea, label: 'Xbox' };
  const webhid = fakeSource(SOURCE.WEBHID, [{ id: 'w1', identity: ds, hasGyro: true }]);
  const gamepad = fakeSource(SOURCE.GAMEPAD_API, [{ id: 'g1', identity: xb, hasGyro: false }]);

  const arb = new InputArbiter().addSource(webhid).addSource(gamepad);
  const frames = arb.resolve().sort((a, b) => a._readBy.localeCompare(b._readBy));

  assert.equal(frames.length, 2);
  assert.equal(frames[0]._readBy, SOURCE.GAMEPAD_API); // Xbox via Gamepad API
  assert.equal(frames[1]._readBy, SOURCE.WEBHID);      // DualSense via WebHID
});

test('arbiter honors a per-controller preference for Steam Input', () => {
  const identity = { vendorId: 0x054c, productId: 0x0ce6, label: 'DualSense' };
  const webhid = fakeSource(SOURCE.WEBHID, [{ id: 'w1', identity, hasGyro: true }]);
  const steam = fakeSource(SOURCE.STEAM_INPUT, [{ id: 's1', identity, hasGyro: true }]);

  const arb = new InputArbiter({ preferences: { [identityMatchKey(identity)]: SOURCE.STEAM_INPUT } });
  arb.addSource(webhid).addSource(steam);
  const frames = arb.resolve();

  assert.equal(frames.length, 1);
  assert.equal(frames[0]._readBy, SOURCE.STEAM_INPUT, 'opt-in preference should flip this pad to Steam Input');
});

test('arbiter forces a source (Deck built-in) over WebHID', () => {
  const identity = { unitId: 'neptune-builtin', label: 'Steam Deck' };
  const webhid = fakeSource(SOURCE.WEBHID, [{ id: 'w1', identity, hasGyro: true }]);
  const steam = fakeSource(SOURCE.STEAM_INPUT, [{ id: 's1', identity, hasGyro: true }]);

  const arb = new InputArbiter({
    forcedSourceFor: (key) => (key === 'unit:neptune-builtin' ? SOURCE.STEAM_INPUT : null),
  });
  arb.addSource(webhid).addSource(steam);
  const frames = arb.resolve();

  assert.equal(frames.length, 1);
  assert.equal(frames[0]._readBy, SOURCE.STEAM_INPUT);
});

test('arbiter survives a source whose list() throws', () => {
  const identity = { label: 'good' };
  const good = fakeSource(SOURCE.WEBHID, [{ id: 'w1', identity, hasGyro: false }]);
  const bad = { id: SOURCE.STEAM_INPUT, list() { throw new Error('boom'); }, read() {} };

  const arb = new InputArbiter().addSource(bad).addSource(good);
  const frames = arb.resolve();
  assert.equal(frames.length, 1);
  assert.equal(frames[0]._readBy, SOURCE.WEBHID);
});
