// ============================================================
// device-identity — shortName, glyphFamily, swapAB, connection
// ============================================================
//
// What every seat, chip and button prompt shows for a controller. These names
// replace the lab lobby's devName() and Tandemonium's per-screen naming
// (docs/UI-KIT-TV-COMPONENTS.md §1).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICES } from '../src/devices.js';
import {
  GLYPH_FAMILIES, KEYBOARD_IDENTITY, glyphFamilyOf, shortNameOf, identityOf,
  identifyGamepadId, identifyHidDevice, readableGamepadName, connectionOf,
} from '../src/device-identity.js';

const ID = {
  dualsense: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
  ds4v2: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
  switchPro: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
  cyclone: 'Gamepad (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
  xbox: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
  unknown: 'USB Gamepad (STANDARD GAMEPAD Vendor: 0079 Product: 0011)',
};

test('every DEVICES entry has a shortName and a known glyph family', () => {
  for (const e of DEVICES) {
    assert.ok(e.shortName && typeof e.shortName === 'string', `${e.name} has a shortName`);
    assert.ok(e.shortName.length <= 16, `${e.name}: shortName "${e.shortName}" fits a seat`);
    assert.ok(GLYPH_FAMILIES.includes(glyphFamilyOf(e)), `${e.name} → ${glyphFamilyOf(e)}`);
  }
});

test('glyph family follows the protocol, and an entry can override it', () => {
  assert.equal(glyphFamilyOf({ protocol: 'dualsense' }), 'playstation');
  assert.equal(glyphFamilyOf({ protocol: 'switch-pro' }), 'nintendo');
  assert.equal(glyphFamilyOf({ protocol: 'xbox' }), 'xbox');
  assert.equal(glyphFamilyOf({ protocol: 'steam-controller' }), 'steam');
  assert.equal(glyphFamilyOf({ protocol: 'something-new' }), 'generic');
  assert.equal(glyphFamilyOf({ protocol: 'dualsense', glyphFamily: 'xbox' }), 'xbox', 'override wins');
  assert.equal(glyphFamilyOf({ protocol: 'dualsense', glyphFamily: 'bogus' }), 'playstation', 'a typo falls back to the protocol');
  assert.equal(glyphFamilyOf(null), 'generic');
});

test('shortNameOf falls back to the full name, then "Controller"', () => {
  assert.equal(shortNameOf({ name: 'Full', shortName: 'Short' }), 'Short');
  assert.equal(shortNameOf({ name: 'Full' }), 'Full');
  assert.equal(shortNameOf(null), 'Controller');
});

test('identifyGamepadId: priority pads get their short names and glyphs', () => {
  const ds = identifyGamepadId(ID.dualsense);
  assert.deepEqual([ds.name, ds.shortName, ds.glyphFamily, ds.swapAB], ['Sony DualSense', 'DualSense', 'playstation', false]);

  const sp = identifyGamepadId(ID.switchPro);
  assert.deepEqual([sp.shortName, sp.glyphFamily, sp.swapAB], ['Switch Pro', 'nintendo', false]);

  const xb = identifyGamepadId(ID.xbox);
  assert.deepEqual([xb.shortName, xb.glyphFamily], ['Xbox Series', 'xbox']);
});

test('identifyGamepadId: a DS4-mode GameSir over the Gamepad API reads as a DualShock 4', () => {
  // It spoofs Sony 054c:09cc; only the bound HID driver's IMU probe can tell
  // it is a Super Nova (manager.slotIdentity prefers driver.entry for that).
  const id = identifyGamepadId(ID.ds4v2);
  assert.equal(id.shortName, 'DualShock 4');
  assert.equal(id.glyphFamily, 'playstation');
});

test('identifyGamepadId: GameSir Cyclone in Switch mode keeps the swapAB quirk', () => {
  const id = identifyGamepadId(ID.cyclone);
  assert.equal(id.shortName, 'Cyclone');
  assert.equal(id.glyphFamily, 'nintendo');
  assert.equal(id.swapAB, true);
});

test('identifyGamepadId: an unknown pad is named from its id string', () => {
  const id = identifyGamepadId(ID.unknown);
  assert.deepEqual([id.name, id.shortName, id.glyphFamily, id.entry], ['USB Gamepad', 'USB Gamepad', 'generic', null]);
});

test('readableGamepadName strips mapping/vid:pid noise (Chromium and Firefox forms)', () => {
  assert.equal(readableGamepadName(ID.unknown), 'USB Gamepad');
  assert.equal(readableGamepadName('054c-0ce6-DualSense Wireless Controller'), 'DualSense Wireless Controller');
  assert.equal(readableGamepadName(''), 'Controller');
});

test('identifyHidDevice: by vid:pid, both Steam Controller paths read "Steam Controller"', () => {
  const direct = identifyHidDevice({ vendorId: 0x28de, productId: 0x1302, productName: 'x' });
  const puck = identifyHidDevice({ vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck' });
  assert.equal(direct.shortName, 'Steam Controller');
  assert.equal(puck.shortName, 'Steam Controller');
  assert.equal(puck.name, 'Steam Controller 2026 (via Puck)', 'the Puck resolves to the via-Puck entry, not direct USB-C');
  assert.equal(puck.glyphFamily, 'steam');
  const odd = identifyHidDevice({ vendorId: 1, productId: 2, productName: 'Odd Pad' });
  assert.deepEqual([odd.shortName, odd.glyphFamily], ['Odd Pad', 'generic']);
});

test('identityOf(null) and the keyboard identity', () => {
  assert.deepEqual(identityOf(null), { name: 'Controller', shortName: 'Controller', glyphFamily: 'generic', swapAB: false, entry: null });
  assert.equal(KEYBOARD_IDENTITY.glyphFamily, 'keyboard');
  assert.ok(Object.isFrozen(KEYBOARD_IDENTITY));
});

test('connectionOf: Puck, USB/Bluetooth from the driver, WebHID, Gamepad', () => {
  assert.equal(connectionOf({ device: { vendorId: 0x28de, productId: 0x1304 }, driver: { connectionType: 'usb' } }), 'puck');
  assert.equal(connectionOf({ device: { vendorId: 0x054c, productId: 0x0ce6 }, driver: { connectionType: 'bluetooth' } }), 'bluetooth');
  assert.equal(connectionOf({ device: { vendorId: 0x054c, productId: 0x0ce6 }, driver: { connectionType: 'usb' } }), 'usb');
  assert.equal(connectionOf({ device: { vendorId: 0x054c, productId: 0x0ce6 } }), 'webhid');
  assert.equal(connectionOf({}), 'gamepad');
});
