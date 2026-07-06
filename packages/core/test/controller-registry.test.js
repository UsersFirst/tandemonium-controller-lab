// ============================================================
// ControllerRegistry — DEVICES-backed lookup surface
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerRegistry } from '../src/drivers/controller-registry.js';
import { PlayStationDriver } from '../src/drivers/playstation-driver.js';
import { SwitchProDriver } from '../src/drivers/switch-pro-driver.js';

const PS_VID = 0x054c, DS4V2_PID = 0x09cc; // shared by Sony DS4 v2 + GameSir clones
const SWITCH_VID = 0x057e, SWITCH_PID = 0x2009;

test('getEntry returns the first (canonical Sony) entry for a spoofed vid:pid', () => {
  const e = ControllerRegistry.getEntry(PS_VID, DS4V2_PID);
  assert.ok(e);
  assert.equal(e.name, 'Sony DualShock 4 v2');
  assert.equal(e.protocol, 'dualsense');
});

test('getDriver maps the entry to its protocol class', () => {
  assert.equal(ControllerRegistry.getDriver(PS_VID, DS4V2_PID), PlayStationDriver);
  assert.equal(ControllerRegistry.getDriver(SWITCH_VID, SWITCH_PID), SwitchProDriver);
  assert.equal(ControllerRegistry.getDriver(0xdead, 0xbeef), null);
});

test('getAllEntries surfaces every spoof sharing a vid:pid', () => {
  const all = ControllerRegistry.getAllEntries(PS_VID, DS4V2_PID);
  const names = all.map((e) => e.name);
  assert.ok(all.length >= 3, `expected Sony + 2 GameSir clones, got ${names.join(', ')}`);
  assert.ok(names.includes('Sony DualShock 4 v2'));
  assert.ok(names.some((n) => /Super Nova/.test(n)));
  assert.ok(names.some((n) => /Cyclone 2/.test(n)));
});

test('getEntriesByImuFamily narrows a shared vid:pid to the matching layout', () => {
  const fam = ControllerRegistry.getEntriesByImuFamily(PS_VID, DS4V2_PID, 'gamesir-ds4');
  assert.ok(fam.length >= 1);
  assert.ok(fam.every((e) => e.imuSignature === 'gamesir-ds4'));
  assert.ok(fam.every((e) => /GameSir/.test(e.name)));
  // The Sony entry (sony-ds4) must NOT be in the gamesir-ds4 family.
  assert.ok(!fam.some((e) => e.name === 'Sony DualShock 4 v2'));
});

test('identifyFromGamepadId resolves PlayStation ids to the dualsense protocol with gyro', () => {
  const info = ControllerRegistry.identifyFromGamepadId(
    'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
  );
  assert.ok(info);
  assert.equal(info.protocol, 'dualsense');
  assert.equal(info.hasGyro, true);
  assert.equal(info.hasTouchpad, true);
  // The vid:pid disambiguates within the shared PLAYSTATION_ID pattern, so a
  // 09cc id resolves to DS4 v2 (not the first PS entry, DualSense).
  assert.equal(info.driverName, 'Sony DualShock 4 v2');
});

test('identifyFromGamepadId disambiguates Sony pads by vid:pid (DS4 05c4 ≠ DualSense 0ce6)', () => {
  // All Sony pads share ONE PLAYSTATION_ID pattern; without vid:pid the first
  // match (DualSense) mislabels every DS4. A GameSir spoofing DS4 v1 (054c:05c4)
  // must read as DualShock 4 v1, not DualSense.
  const ds4v1 = ControllerRegistry.identifyFromGamepadId(
    'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 05c4)');
  assert.equal(ds4v1.driverName, 'Sony DualShock 4 v1');

  const ds5 = ControllerRegistry.identifyFromGamepadId(
    'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
  assert.equal(ds5.driverName, 'Sony DualSense');
});

test('identifyFromGamepadId is variant-first: GameSir Cyclone beats Switch Pro', () => {
  const cyclone = ControllerRegistry.identifyFromGamepadId(
    'Gamepad (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
  );
  assert.equal(cyclone.driverName, 'GameSir Cyclone (Switch mode)');

  const pro = ControllerRegistry.identifyFromGamepadId(
    'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
  );
  assert.equal(pro.driverName, 'Nintendo Switch Pro');
});

test('getGamepadQuirks applies swapAB only to the Cyclone variant', () => {
  assert.deepEqual(
    ControllerRegistry.getGamepadQuirks('Gamepad (STANDARD GAMEPAD Vendor: 057e Product: 2009)'),
    { swapAB: true },
  );
  assert.deepEqual(
    ControllerRegistry.getGamepadQuirks('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'),
    {},
  );
});

test('getHIDFilters includes capable controllers and excludes Xbox stubs', () => {
  const filters = ControllerRegistry.getHIDFilters();
  assert.ok(filters.length > 0);
  // Xbox entries are NO_CAPS → must not appear.
  assert.ok(!filters.some((f) => f.vendorId === 0x045e), 'Xbox (no WebHID caps) should be excluded');
  // PlayStation, Switch, and Steam Controller should be present.
  assert.ok(filters.some((f) => f.vendorId === 0x054c));
  assert.ok(filters.some((f) => f.vendorId === 0x057e));
  assert.ok(filters.some((f) => f.vendorId === 0x28de));
  // Default filter shape carries the gamepad usage page.
  const ps = filters.find((f) => f.vendorId === 0x054c);
  assert.equal(ps.usagePage, 0x0001);
  assert.equal(ps.usage, 0x0005);
});

test('parseGamepadVendorProduct extracts hex vid:pid (and rejects junk)', () => {
  assert.deepEqual(
    ControllerRegistry.parseGamepadVendorProduct('X (Vendor: 054c Product: 09cc)'),
    { vendorId: 0x054c, productId: 0x09cc },
  );
  assert.equal(ControllerRegistry.parseGamepadVendorProduct('no ids here'), null);
  assert.equal(ControllerRegistry.parseGamepadVendorProduct(''), null);
});

test('isKnownDevice reflects dictionary membership', () => {
  assert.equal(ControllerRegistry.isKnownDevice({ vendorId: PS_VID, productId: DS4V2_PID }), true);
  assert.equal(ControllerRegistry.isKnownDevice({ vendorId: 0xdead, productId: 0xbeef }), false);
});
