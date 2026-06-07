// ============================================================
// ControllerInventory — identity, lifecycle, capabilities, persistence
// ============================================================
//
// Headless: imports only the inventory + registry (no `three`, no DOM),
// so it runs under CI's dependency-free `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ControllerInventory,
  normalizeDescriptor,
  identityKey,
  capabilitiesFor,
  macOui,
  formatSerial,
  analyzeIdentity,
} from '../src/controller-inventory.js';
import { ControllerRegistry } from '../src/drivers/controller-registry.js';

// A controllable clock so timestamps are deterministic.
function clock(start = 1000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; return t; };
  now.set = (v) => { t = v; };
  return now;
}

// Descriptor builders.
const hid = (o) => ({ source: 'hid', ...o });
const gamepad = (id) => ({ source: 'gamepad', gamepadId: id });
const DUALSENSE_GP = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

test('normalizeDescriptor parses a Gamepad-API id into vid:pid + name + entry', () => {
  const n = normalizeDescriptor(gamepad(DUALSENSE_GP));
  assert.equal(n.vendorId, 0x054c);
  assert.equal(n.productId, 0x0ce6);
  assert.equal(n.productName, 'DualSense Wireless Controller');
  assert.ok(n.entry, 'resolves the dictionary entry');
  assert.equal(n.entry.name, 'Sony DualSense');
});

test('identityKey prefers serial, then vid:pid, then name', () => {
  assert.equal(identityKey({ serialNumber: 'a05a5ef610cb', vendorId: 0x054c, productId: 0x05c4 }), 'serial:a05a5ef610cb');
  assert.equal(identityKey({ vendorId: 0x054c, productId: 0x05c4 }), 'vidpid:054c:05c4');
  assert.equal(identityKey({ productName: 'Mystery Pad' }), 'name:mystery pad');
});

test('capabilitiesFor surfaces gyro/trackpadCount/haptics from the dictionary', () => {
  const ds = capabilitiesFor(ControllerRegistry.getEntry(0x054c, 0x0ce6)); // DualSense
  assert.equal(ds.gyro, true);
  assert.equal(ds.touchpad, true);
  assert.equal(ds.trackpadCount, 1);
  assert.equal(ds.haptics.count, 4);
  assert.equal(ds.lightbar, true);

  const xb = capabilitiesFor(ControllerRegistry.getEntry(0x045e, 0x0b13)); // Xbox Series
  assert.equal(xb.gyro, false);
  assert.equal(xb.trackpadCount, 0);
  assert.equal(xb.haptics.count, 4);

  const steam = capabilitiesFor(ControllerRegistry.getEntry(0x28de, 0x1302));
  assert.equal(steam.trackpadCount, 2);
});

test('connect creates a record with lifecycle + capabilities', () => {
  const now = clock(5000);
  const inv = new ControllerInventory({ now });
  const rec = inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x05c4, productName: 'Wireless Controller', serialNumber: 'a05a5ef610cb' }));
  assert.equal(rec.key, 'serial:a05a5ef610cb');
  assert.equal(rec.connected, true);
  assert.equal(rec.firstSeen, 5000);
  assert.equal(rec.lastConnected, 5000);
  assert.equal(rec.lastDisconnected, null);
  assert.equal(rec.connectCount, 1);
  assert.equal(rec.capabilities.gyro, true);
  assert.deepEqual([...rec.transports], ['hid']);
});

test('reconnect keeps firstSeen, bumps lastConnected + connectCount', () => {
  const now = clock(1000);
  const inv = new ControllerInventory({ now });
  inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x05c4, serialNumber: 'AA' }));
  now.advance(500);
  inv.observeDisconnect(hid({ vendorId: 0x054c, productId: 0x05c4, serialNumber: 'AA' }));
  now.advance(2000);
  const rec = inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x05c4, serialNumber: 'AA' }));
  assert.equal(rec.firstSeen, 1000);
  assert.equal(rec.lastDisconnected, 1500);
  assert.equal(rec.lastConnected, 3500);
  assert.equal(rec.connected, true);
  assert.equal(rec.connectCount, 2);
});

test('WebHID(serial) + Gamepad-API(vid:pid) fold into ONE record', () => {
  const now = clock();
  const inv = new ControllerInventory({ now });
  inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x0ce6, serialNumber: 'DEAD' }));
  inv.observeConnect(gamepad(DUALSENSE_GP)); // same vid:pid, no serial
  const list = inv.list();
  assert.equal(list.length, 1, 'one physical controller, one row');
  assert.equal(list[0].key, 'serial:DEAD');
  assert.deepEqual([...list[0].transports].sort(), ['gamepad', 'hid']);
});

test('Gamepad-API first, then a serial sighting upgrades the key to per-unit', () => {
  const now = clock();
  const inv = new ControllerInventory({ now });
  inv.observeConnect(gamepad(DUALSENSE_GP));            // vidpid key
  assert.ok(inv.get('vidpid:054c:0ce6'));
  inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x0ce6, serialNumber: 'BEEF' }));
  assert.equal(inv.get('vidpid:054c:0ce6'), null, 're-keyed away from vid:pid');
  const rec = inv.get('serial:BEEF');
  assert.ok(rec, 'now keyed by serial');
  assert.deepEqual([...rec.transports].sort(), ['gamepad', 'hid']);
});

test('two identical pads with distinct serials stay separate', () => {
  const now = clock();
  const inv = new ControllerInventory({ now });
  inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x0ce6, serialNumber: 'PAD1' }));
  inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x0ce6, serialNumber: 'PAD2' }));
  assert.equal(inv.list().length, 2);
  // A serial-less Gamepad-API sighting can't be correlated to either → its own row, honestly.
  inv.observeConnect(gamepad(DUALSENSE_GP));
  assert.equal(inv.list().length, 3, 'ambiguous gamepad sighting is not silently merged');
});

test('list() puts connected first, then most-recently-connected', () => {
  const now = clock(1000);
  const inv = new ControllerInventory({ now });
  inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x0ce6, serialNumber: 'A' }));
  now.advance(100);
  inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x05c4, serialNumber: 'B' }));
  now.advance(100);
  inv.observeDisconnect(hid({ vendorId: 0x054c, productId: 0x0ce6, serialNumber: 'A' }));
  const keys = inv.list().map((r) => r.key);
  assert.deepEqual(keys, ['serial:B', 'serial:A'], 'connected B first, disconnected A last');
});

test('persistence round-trips history; restored records start disconnected', () => {
  const now = clock(2000);
  const inv = new ControllerInventory({ now });
  inv.observeConnect(hid({ vendorId: 0x054c, productId: 0x05c4, serialNumber: 'S1' }));
  const json = JSON.parse(JSON.stringify(inv.toJSON())); // simulate localStorage

  const now2 = clock(9000);
  const restored = new ControllerInventory({ now: now2 });
  restored.loadJSON(json);
  const rec = restored.get('serial:S1');
  assert.ok(rec);
  assert.equal(rec.connected, false, 'nothing is live until a fresh connect');
  assert.equal(rec.firstSeen, 2000, 'history preserved');
  assert.ok(rec.transports instanceof Set, 'transports restored as a Set');

  // A fresh connect after restore keeps the original firstSeen.
  const back = restored.observeConnect(hid({ vendorId: 0x054c, productId: 0x05c4, serialNumber: 'S1' }));
  assert.equal(back.firstSeen, 2000);
  assert.equal(back.connected, true);
  assert.equal(back.lastConnected, 9000);
});

test('macOui / formatSerial: MAC serials yield an OUI, product serials do not', () => {
  // GameSir Super Nova's real captured MAC.
  assert.equal(macOui('a05a5ef610cb'), 'a05a5e');
  assert.equal(formatSerial('a05a5ef610cb'), 'a0:5a:5e:f6:10:cb');
  // Steam Controller's product serial is not a MAC.
  assert.equal(macOui('FXB9960202571'), null);
  assert.equal(formatSerial('FXB9960202571'), 'FXB9960202571');
  // Already-colon-formatted MACs work too.
  assert.equal(macOui('A0:5A:5E:F6:10:CB'), 'a05a5e');
  assert.equal(macOui(null), null);
});

test('analyzeIdentity: OUI distinguishes a real DS4 from a Super Nova (real captured MACs)', () => {
  // Both advertise Sony VID 054c; their Bluetooth MAC OUI tells them apart.
  const real = analyzeIdentity({ vendorId: 0x054c, serialNumber: '90fba6ba591c' });
  assert.equal(real.ouiVendor, 'Sony');
  assert.equal(real.verdict, 'genuine');

  const clone = analyzeIdentity({ vendorId: 0x054c, serialNumber: 'a05a5ef610cb' });
  assert.equal(clone.ouiVendor, 'GameSir');
  assert.equal(clone.verdict, 'clone', 'GameSir OUI under a Sony VID = spoof');
  assert.equal(clone.mac, 'a0:5a:5e:f6:10:cb');
});

test('analyzeIdentity: non-MAC and missing serials degrade honestly', () => {
  // Steam product serial — not a MAC, can't OUI-check.
  assert.equal(analyzeIdentity({ vendorId: 0x28de, serialNumber: 'FXB9960202571' }).verdict, 'no-mac');
  // Xbox 360 reports the XInput slot ("01"/"02") as serial — not a MAC.
  assert.equal(analyzeIdentity({ vendorId: 0x045e, serialNumber: '01' }).verdict, 'no-mac');
  // USB DS4 / browser: no serial at all.
  assert.equal(analyzeIdentity({ vendorId: 0x054c, serialNumber: null }).verdict, 'no-serial');
  // A MAC whose OUI we haven't catalogued.
  assert.equal(analyzeIdentity({ vendorId: 0x054c, serialNumber: '001122334455' }).verdict, 'unverified');
});

test('Xbox (Gamepad-API only) is recorded with limited capabilities', () => {
  const now = clock();
  const inv = new ControllerInventory({ now });
  const rec = inv.observeConnect(gamepad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'));
  assert.equal(rec.key, 'vidpid:045e:0b13');
  assert.equal(rec.capabilities.gyro, false);
  assert.deepEqual([...rec.transports], ['gamepad']);
});
