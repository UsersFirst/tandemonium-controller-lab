// ============================================================
// DEVICES dictionary — structural invariants
// ============================================================
//
// The dictionary is the single source of truth for known controllers.
// A malformed entry (typo'd protocol key, missing capability, bad
// imuSignature) would fail silently at runtime, so assert the shape here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICES, PROTOCOLS, PENDING_DEVICES } from '../src/devices.js';
import { ControllerDriver } from '../src/drivers/base-driver.js';

const VALID_IMU_SIGNATURES = new Set(['sony-ds5', 'sony-ds4', 'gamesir-ds4']);
const u16 = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffff;

test('every PROTOCOLS value is a ControllerDriver subclass', () => {
  for (const [key, Driver] of Object.entries(PROTOCOLS)) {
    assert.equal(typeof Driver, 'function', `protocol ${key} must map to a class`);
    assert.ok(
      Driver.prototype instanceof ControllerDriver,
      `protocol ${key} (${Driver.name}) must extend ControllerDriver`,
    );
  }
});

test('every DEVICES entry has a well-formed shape', () => {
  for (const e of DEVICES) {
    const where = e.name || `${e.vendorId}:${e.productId}`;
    assert.equal(typeof e.name, 'string', `${where}: name must be a string`);
    assert.ok(u16(e.vendorId), `${where}: vendorId out of range`);
    assert.ok(u16(e.productId), `${where}: productId out of range`);
    assert.ok(PROTOCOLS[e.protocol], `${where}: protocol "${e.protocol}" not in PROTOCOLS`);

    const c = e.capabilities;
    assert.ok(c && typeof c === 'object', `${where}: missing capabilities`);
    for (const cap of ['gyro', 'accel', 'touchpad']) {
      assert.equal(typeof c[cap], 'boolean', `${where}: capabilities.${cap} must be boolean`);
    }

    assert.ok(e.gamepadIdPattern instanceof RegExp, `${where}: gamepadIdPattern must be a RegExp`);
    if (e.gamepadIdMatch !== undefined) {
      assert.ok(e.gamepadIdMatch instanceof RegExp, `${where}: gamepadIdMatch must be a RegExp`);
    }
    if (e.imuSignature !== undefined) {
      assert.ok(
        VALID_IMU_SIGNATURES.has(e.imuSignature),
        `${where}: unknown imuSignature "${e.imuSignature}"`,
      );
    }
  }
});

test('capabilities and feature inventory agree on gyro/accel/touchpad', () => {
  for (const e of DEVICES) {
    if (!e.features) continue;
    // If a WebHID capability is true, the hardware feature inventory must
    // not claim the feature is absent (the wizard relies on this).
    for (const cap of ['gyro', 'accel', 'touchpad']) {
      if (e.capabilities[cap] === true && e.features[cap] !== undefined) {
        assert.notEqual(
          e.features[cap], false,
          `${e.name}: capabilities.${cap}=true but features.${cap}=false`,
        );
      }
    }
  }
});

test('spoof entries reference another entry sharing their vid:pid', () => {
  for (const e of DEVICES) {
    if (!e.spoofs) continue;
    assert.equal(typeof e.spoofs.of, 'string', `${e.name}: spoofs.of must name the spoofed device`);
    assert.ok(u16(e.spoofs.vendorId) && u16(e.spoofs.productId), `${e.name}: spoofs vid:pid malformed`);
    const siblings = DEVICES.filter(
      (o) => o !== e && o.vendorId === e.vendorId && o.productId === e.productId,
    );
    assert.ok(
      siblings.length >= 1,
      `${e.name}: declares spoofs but no sibling entry shares ${e.vendorId.toString(16)}:${e.productId.toString(16)}`,
    );
  }
});

test('PENDING_DEVICES are documented but not registered', () => {
  assert.ok(Array.isArray(PENDING_DEVICES));
  for (const p of PENDING_DEVICES) {
    const registered = DEVICES.some((e) => e.vendorId === p.vendorId && e.productId === p.productId);
    assert.ok(!registered, `${p.name}: pending entry should not already be in DEVICES`);
  }
});
