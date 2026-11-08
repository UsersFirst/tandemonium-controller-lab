// ============================================================
// rig — the real ControllerManager on fake devices and a virtual clock
// ============================================================
//
// Wires FakeHid (navigator.hid) and FakeGamepads (navigator.getGamepads) into
// a real ControllerManager with the real drivers, and drives it on a virtual
// clock: `rig.tick(ms)` advances time in 4 ms steps, streams one report per
// step from every streaming fake device (~250 Hz, like the hardware) and runs
// `ingestFrame` every 16 ms (one 60 Hz game frame). Tests read as the
// playtest did: "press A on body 2, 70 ms later its XInput twin presses".
//
// Pooling is the one async part (driver init awaits feature reads and the IMU
// probe), so `await makeRig()` / `await rig.connect(key)` pump reports on real
// timers until the pool settles; everything after that is synchronous.
//
// A SensorFusion needs `three`, which CI does not install, so the rig hands
// the manager a stub fusion through `createFusion` (core >= 0.7.0).

import { ControllerManager } from '../../src/manager.js';
import { SteamControllerDriver } from '../../src/drivers/steam-controller-driver.js';
import { FakeHid } from './fake-hid.js';
import { FakeGamepads } from './fake-gamepads.js';

export * from './fake-hid.js';
export * from './fake-gamepads.js';

const REPORT_MS = 4;
const FRAME_MS = 16;

/** A fusion that accepts everything and integrates nothing (no `three`). */
export function stubFusion() {
  return {
    yawReturnHalfLife: 0,
    startCalibration() {}, ingest() {}, recenter() {},
    get orientation() { return { x: 0, y: 0, z: 0, w: 1 }; },
  };
}

const realNow = performance.now.bind(performance);
const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

/**
 * @param {object} o
 * @param {object[]} [o.hid]      FakeHid device specs present (and granted) at boot
 * @param {string[]} [o.slots]    slot ids (default P1..P4)
 * @param {object}   [o.manager]  extra ControllerManager options
 * @param {Array<{index:number, handle:string, type:string}>|null} [o.steam]
 *        Steam's XInput slot map, as the app feeds it (null = not under Steam)
 * @param {boolean}  [o.quiet]    silence driver console chatter (default true)
 */
export async function makeRig({ hid: specs = [], slots = ['P1', 'P2', 'P3', 'P4'], manager = {}, steam = null, quiet = true } = {}) {
  let t = 1000;
  performance.now = () => t;
  const saved = { log: console.log, warn: console.warn };
  if (quiet) { console.log = () => {}; console.warn = () => {}; }

  const hid = new FakeHid(specs);
  const pads = new FakeGamepads({ now: () => t });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, enumerable: true,
    value: { hid, getGamepads: () => pads.snapshot(), userAgent: 'node-test' },
  });

  const mgr = new ControllerManager({ slotIds: slots, createFusion: stubFusion, ...manager });
  mgr.wireHidHotplug();

  const rig = {
    hid, pads, mgr,
    steam,
    get now() { return t; },
    frames: 0,
    /** Advance the virtual clock, streaming reports and running game frames. */
    tick(ms = FRAME_MS) {
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + REPORT_MS);
        hid.emitAll();
        if (Math.floor(t / FRAME_MS) !== Math.floor((t - REPORT_MS) / FRAME_MS)) rig.frame();
      }
      return rig;
    },
    /** One ingestFrame at the current time. */
    frame() {
      if (typeof mgr.setSteamInputMap === 'function') mgr.setSteamInputMap(rig.steam);
      rig.lastResult = mgr.ingestFrame(pads.snapshot(), t);
      rig.frames++;
      return rig.lastResult;
    },
    /** Pump reports on real timers until `pred()` holds (pooling is async). */
    async settle(pred = () => mgr._pooling.size === 0, ms = 3000) {
      const t0 = realNow();
      await new Promise((r) => setTimeout(r, 0));
      while (!(pred() && mgr._pooling.size === 0) && realNow() - t0 < ms) {
        hid.emitAll();
        await new Promise((r) => setTimeout(r, 1));
      }
      hid.emitAll();
    },
    async connect(key) {
      hid.connect(key);
      await rig.settle(() => isHeld(mgr, hid.device(key)));
    },
    async add(spec) {
      hid.add(spec);
      await rig.settle(() => isHeld(mgr, hid.device(spec.key)));
    },
    keyOf(device) { return device ? device.__fakeKey : null; },
    /** { state, hid, pad } of a slot, HID device named by its fake key. */
    seat(id) {
      const s = mgr.getSlot(id);
      return { id, state: s.state, hid: rig.keyOf(s.hidDevice), pad: s.gamepadIndex };
    },
    /** Every seat that holds `key` over WebHID. */
    seatsHolding(key) { return mgr.slots.filter((s) => rig.keyOf(s.hidDevice) === key).map((s) => s.id); },
    /** Hold A on a HID device (and optionally its pad) for `ms`, then release and let it settle. */
    tapHid(key, bit, ms = 70) { hid.hold(key, bit, true); rig.tick(ms); hid.hold(key, bit, false); return rig; },
    tapPad(i, name = 'A', ms = 70) { pads.hold(i, name, true); rig.tick(ms); pads.hold(i, name, false); return rig; },
    roster() { return mgr.controllerRoster(pads.snapshot()); },
    dispose() {
      try { mgr.unwireHidHotplug(); } catch {}
      const entries = new Set([...mgr._hidPool.values()]);
      for (const s of mgr.slots) if (s._hidEntry) entries.add(s._hidEntry);
      for (const e of entries) { try { e.destroy(); } catch {} }
      SteamControllerDriver._lizardOwners?.clear?.();
      performance.now = realNow;
      if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc);
      console.log = saved.log; console.warn = saved.warn;
    },
  };

  // Driver init awaits reports (IMU probe, BT full-report confirm): stream on
  // real timers while the boot pool runs.
  const pump = setInterval(() => hid.emitAll(), 1);
  try { await mgr.autoPoolApprovedHid(); } finally { clearInterval(pump); }
  await rig.settle();
  // Let every streaming device deliver its first reports before the test starts.
  rig.tick(100);
  return rig;
}

function isHeld(mgr, device) {
  if (!device) return false;
  return mgr._hidPool.has(device) || mgr.slots.some((s) => s.hidDevice === device);
}
