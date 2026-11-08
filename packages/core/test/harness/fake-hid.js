// ============================================================
// fake-hid — a scripted navigator.hid for the core tests (node, no browser)
// ============================================================
//
// Ported from Tandemonium's scripts/lib/fake-webhid.mjs (the headless-Chrome
// smoke fake), so the same scenarios run here against the REAL drivers and
// the real ControllerManager: registry connect → driver init (BT feature read,
// IMU probe, Puck lizard-mode handshake) → HidEntry parsing → pool → seat.
//
// Differences from the browser fake: nothing streams on its own. The rig
// (./rig.js) calls `emitAll()` on its virtual clock, so a test is a plain
// sequence of "press, advance 70 ms, release" steps with no real timers.
//
//   const hid = new FakeHid([hidDevice.dualsenseUsb('ds-a'), ...]);
//   hid.hold('ds-a', FACE_A.ds5Usb, true);   // OR a bit into every report
//   hid.disconnect('ds-a');                  // fires 'disconnect'
//   hid.silence('body-2', true);             // connected, stops reporting (body switched off)
//   hid.connect('ds-a');                     // a NEW HIDDevice object, as Chrome does
//
// Devices added with `granted: false` aren't in getDevices() until a
// requestDevice() call matching their vid:pid grants them.

import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/', import.meta.url);

/** Reports of one capture step as [{ reportId, hex }]. */
export function fixtureReports(file, step = 'at-rest') {
  const j = JSON.parse(readFileSync(new URL(file, FIXTURES), 'utf8'));
  const s = j.steps.find((x) => x.id === step);
  if (!s) throw new Error(`fixture ${file} has no step ${step}`);
  return s.reports.map((r) => ({ reportId: r.reportId ?? 1, hex: r.bytes }));
}

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
const s16 = (u8, o, v) => { const x = v & 0xffff; u8[o] = x & 0xff; u8[o + 1] = x >> 8; };

/**
 * DualSense USB report 0x01 at the driver's documented layout: sticks centred,
 * dpad neutral, IMU at byte 15 with ~1 g on one accel axis and a little gyro
 * noise so the IMU probe scores it at rest.
 */
export function dualsenseUsbReports(n = 30) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u8 = new Uint8Array(63);
    u8[0] = u8[1] = u8[2] = u8[3] = 128;
    u8[7] = 0x08;
    const g = 15;
    s16(u8, g, (i % 3) - 1); s16(u8, g + 2, ((i + 1) % 3) - 1); s16(u8, g + 4, 0);
    s16(u8, g + 6, 40); s16(u8, g + 8, 8190); s16(u8, g + 10, -60);
    out.push({ reportId: 0x01, hex: hex(u8) });
  }
  return out;
}

const items = (bytes) => [{ reportSize: 8, reportCount: bytes }];

/** HID collections per transport, as the drivers' detectConnectionType reads them. */
export const COLLECTIONS = {
  psUsb: [{ usagePage: 0x01, usage: 0x05, inputReports: [{ reportId: 0x01, items: items(63) }], outputReports: [{ reportId: 0x02, items: items(47) }], featureReports: [{ reportId: 0x05, items: items(40) }] }],
  ds4Usb: [{ usagePage: 0x01, usage: 0x05, inputReports: [{ reportId: 0x01, items: items(63) }], outputReports: [{ reportId: 0x05, items: items(31) }], featureReports: [{ reportId: 0x02, items: items(36) }, { reportId: 0x11, items: items(48) }] }],
  ds4Bt: [{ usagePage: 0x01, usage: 0x05, inputReports: [{ reportId: 0x01, items: items(9) }, { reportId: 0x11, items: items(77) }], outputReports: [{ reportId: 0x11, items: items(77) }], featureReports: [{ reportId: 0x02, items: items(36) }] }],
  puck: [{ usagePage: 0xff00, usage: 0x01, inputReports: [{ reportId: 0x45, items: items(53) }, { reportId: 0x7b, items: items(53) }], outputReports: [], featureReports: [{ reportId: 0x01, items: items(64) }] }],
};

/** Ready-made device specs. `key` is the test's own name for the device. */
export const hidDevice = {
  dualsenseUsb: (key, extra = {}) => ({ key, vendorId: 0x054c, productId: 0x0ce6, productName: 'DualSense Wireless Controller', collections: COLLECTIONS.psUsb, reports: dualsenseUsbReports(), ...extra }),
  superNova: (key, extra = {}) => ({ key, vendorId: 0x054c, productId: 0x09cc, productName: 'Wireless Controller', collections: COLLECTIONS.ds4Usb, reports: fixtureReports('gamesir-super-nova-ds4_054c-09cc.json'), ...extra }),
  ds4Bt: (key, extra = {}) => ({ key, vendorId: 0x054c, productId: 0x05c4, productName: 'Wireless Controller', collections: COLLECTIONS.ds4Bt, reports: fixtureReports('sony-dualshock4-v1-bt_054c-05c4.json'), ...extra }),
  /** A Puck interface that enumerates but never streams (an idle receiver slot). */
  puckIdleSibling: (key, extra = {}) => ({ key, vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck', collections: COLLECTIONS.puck, reports: [], ...extra }),
  /** One Steam Controller body streaming STATE on its own Puck interface. */
  steamPuck: (key, extra = {}) => ({ key, vendorId: 0x28de, productId: 0x1304, productName: 'Steam Controller Puck', collections: COLLECTIONS.puck, reports: fixtureReports('steam-controller-puck_28de-1304.json'), ...extra }),
};

/** Where each family's buttons sit in the report (report id stripped). */
export const FACE_A = {
  ds5Usb: { offset: 7, mask: 0x20 },     // DualSense USB: face byte 7, cross = 0x20
  ds4Usb: { offset: 4, mask: 0x20 },     // DS4 USB: face byte 4
  ds4Bt: { offset: 6, mask: 0x20 },      // DS4 BT: +2 header
  steam: { offset: 1, mask: 0x01 },      // Steam STATE 0x45: btn0 bit 0 = A
};
export const FACE_B = {
  ds5Usb: { offset: 7, mask: 0x40 },     // circle
  steam: { offset: 1, mask: 0x02 },      // Steam B
};

const parseHex = (h) => Uint8Array.from(h.trim().split(/\s+/).map((b) => parseInt(b, 16)));

class FakeHIDDevice extends EventTarget {
  constructor(rec) {
    super();
    this._rec = rec;
    this.vendorId = rec.spec.vendorId; this.productId = rec.spec.productId;
    this.productName = rec.spec.productName; this.collections = rec.spec.collections || [];
    this.opened = false; this.oninputreport = null;
    this.__fakeKey = rec.spec.key;
  }
  async open() { if (!this._rec.connected || this._rec.device !== this) throw new Error('NotFoundError: Device not connected'); this.opened = true; }
  async close() { this.opened = false; }
  async forget() { this._rec.granted = false; await this.close(); }
  async sendReport() { if (!this.opened) throw new Error('InvalidStateError: closed'); this._rec.stats.outputSends++; }
  async sendFeatureReport() { if (!this.opened) throw new Error('InvalidStateError: closed'); this._rec.stats.featureSends++; }
  async receiveFeatureReport() { if (!this.opened) throw new Error('InvalidStateError: closed'); this._rec.stats.featureReads++; return new DataView(new ArrayBuffer(64)); }
}

export class FakeHid extends EventTarget {
  constructor(specs = []) {
    super();
    /** key → record */
    this.recs = new Map();
    for (const s of specs) this._add(s);
  }

  _add(spec) {
    const rec = {
      spec, granted: spec.granted !== false, connected: spec.connected !== false, i: 0, silent: false,
      reports: spec.reports.map((r) => ({ reportId: r.reportId, bytes: parseHex(r.hex) })),
      overrides: new Map(), stats: { emitted: 0, featureReads: 0, featureSends: 0, outputSends: 0, objects: 1 },
    };
    rec.device = new FakeHIDDevice(rec);
    this.recs.set(spec.key, rec);
    return rec;
  }

  _fire(type, device) {
    const ev = new Event(type);
    Object.defineProperty(ev, 'device', { value: device });
    this.dispatchEvent(ev);
  }

  // ── navigator.hid surface ──
  async getDevices() { return [...this.recs.values()].filter((r) => r.granted && r.connected).map((r) => r.device); }
  async requestDevice({ filters = [] } = {}) {
    const match = (r) => !filters.length || filters.some((f) => (f.vendorId == null || f.vendorId === r.spec.vendorId) && (f.productId == null || f.productId === r.spec.productId));
    const picked = [...this.recs.values()].filter((r) => r.connected && !r.granted && match(r));
    picked.forEach((r) => { r.granted = true; });
    return picked.map((r) => r.device);
  }

  // ── scripting ──
  add(spec) { const r = this._add(spec); if (r.granted && r.connected) this._fire('connect', r.device); return spec.key; }
  disconnect(key) {
    const r = this.recs.get(key); if (!r || !r.connected) return false;
    r.connected = false; r.device.opened = false;
    this._fire('disconnect', r.device);
    return true;
  }
  /** Reconnect: Chrome hands out a NEW HIDDevice object for the same unit. */
  connect(key) {
    const r = this.recs.get(key); if (!r || r.connected) return false;
    r.connected = true; r.i = 0; r.overrides.clear();
    r.device = new FakeHIDDevice(r); r.stats.objects++;
    if (r.granted) this._fire('connect', r.device);
    return true;
  }
  /** Hold a report bit on (or off). Sends one report at once, as a real ~250 Hz pad would within ms. */
  hold(key, bit, on) {
    const r = this.recs.get(key); if (!r) return false;
    const id = bit.offset + ':' + bit.mask;
    if (on) r.overrides.set(id, bit); else r.overrides.delete(id);
    this._emit(r);
    return true;
  }
  /** The device stays connected but stops reporting (a Steam Controller body switched off on its Puck). */
  silence(key, on) { const r = this.recs.get(key); if (!r) return false; r.silent = !!on; return true; }
  device(key) { const r = this.recs.get(key); return r ? r.device : null; }
  stats(key) { const r = this.recs.get(key); return r ? { opened: r.device.opened, connected: r.connected, granted: r.granted, ...r.stats } : null; }

  /** One report from every open, connected, non-silent, streaming device. */
  emitAll() { for (const r of this.recs.values()) this._emit(r); }

  _emit(r) {
    const d = r.device;
    if (!d || !d.opened || !r.connected || r.silent || !r.reports.length) return;
    const rep = r.reports[r.i++ % r.reports.length];
    const u8 = rep.bytes.slice();
    for (const o of r.overrides.values()) if (o.offset < u8.length) u8[o.offset] |= o.mask;
    r.stats.emitted++;
    const ev = new Event('inputreport');
    Object.defineProperty(ev, 'reportId', { value: rep.reportId });
    Object.defineProperty(ev, 'data', { value: new DataView(u8.buffer) });
    Object.defineProperty(ev, 'device', { value: d });
    if (typeof d.oninputreport === 'function') d.oninputreport(ev);
    d.dispatchEvent(ev);
  }
}
