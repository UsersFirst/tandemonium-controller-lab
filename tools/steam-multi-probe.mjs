#!/usr/bin/env node
// ============================================================
// steam-multi-probe.mjs — map multiple Steam Controllers to Puck interfaces
// ============================================================
//
// The 2026 Steam Controller Puck (0x28de:0x1304) exposes several
// vendor-defined HID interfaces (usagePage 0xff00). node-hid reports the
// SAME serialNumber for every one of them (it's the Puck's serial, not the
// controller body's), so two controller bodies paired to one Puck can NOT be
// told apart by serial. The open question this tool answers on real hardware:
//
//   Does each paired controller body stream STATE reports on its OWN Puck
//   vendor interface (MI_02 / MI_03 / MI_04 / MI_05 …), so we can key per-unit
//   identity off the interface path? Or do all bodies multiplex through one
//   interface with a controller-index byte in the report?
//
// It opens every 0xff00 vendor interface, sends the lizard-mode disable
// (CLEAR_DIGITAL_MAPPINGS + SET_SETTINGS) + an 800ms heartbeat so STATE
// reports actually flow, and prints a live per-interface table: report count,
// last STATE report id, and whether input is currently changing. Press
// buttons / move sticks on ONE controller at a time and watch which interface
// lights up.
//
//   node tools/steam-multi-probe.mjs
//
// Ctrl-C to stop.

import HID from 'node-hid';

const VALVE = 0x28de;
const PUCK_PID = 0x1304;

// Lizard-mode disable protocol (mirrors packages/core/src/drivers/steam-controller-driver.js)
const CMD_CLEAR_DIGITAL_MAPPINGS = 0x81;
const CMD_SET_SETTINGS = 0x87;
const SETTING_RIGHT_TRACKPAD_MODE = 0x07;
const SETTING_LEFT_TRACKPAD_MODE = 0x08;
const TRACKPAD_MODE_NONE = 0x00;
const HEARTBEAT_MS = 800;

// STATE report gating (from the driver): 53 payload bytes, id 0x45 (or 0x42).
const STATE_REPORT_IDS = new Set([0x45, 0x42]);

const hx = (n, w = 2) => '0x' + ((n || 0) >>> 0).toString(16).padStart(w, '0');

function clearPayload() {
  const buf = Buffer.alloc(64);
  buf[0] = CMD_CLEAR_DIGITAL_MAPPINGS;
  return buf;
}
function setSettingsPayload() {
  const buf = Buffer.alloc(64);
  buf[0] = CMD_SET_SETTINGS;
  buf[1] = 6;
  buf[2] = SETTING_LEFT_TRACKPAD_MODE;  buf[3] = TRACKPAD_MODE_NONE; buf[4] = 0x00;
  buf[5] = SETTING_RIGHT_TRACKPAD_MODE; buf[6] = TRACKPAD_MODE_NONE; buf[7] = 0x00;
  return buf;
}

// node-hid's sendFeatureReport takes a buffer whose [0] byte is the report id.
// The Steam Controller's vendor feature reports use report id 0. We try 0
// first, then 1/2 as the WebHID driver does.
function sendLizardDisable(dev, label) {
  for (const reportId of [0x00, 0x01, 0x02]) {
    try {
      dev.sendFeatureReport(Buffer.concat([Buffer.from([reportId]), clearPayload()]));
      dev.sendFeatureReport(Buffer.concat([Buffer.from([reportId]), setSettingsPayload()]));
      return reportId;
    } catch { /* try next id */ }
  }
  return null;
}

const vendorIfaces = HID.devices().filter(
  (d) => d.vendorId === VALVE && d.productId === PUCK_PID && d.usagePage === 0xff00 && d.usage === 0x0001,
);

if (vendorIfaces.length === 0) {
  console.error('No Steam Controller Puck vendor interfaces (0xff00/0x0001) found. Is the Puck plugged in?');
  process.exit(1);
}

console.log(`Found ${vendorIfaces.length} Puck vendor interface(s). Opening + disabling lizard mode…\n`);

const monitors = [];
for (const info of vendorIfaces) {
  const mi = (info.path.match(/MI_([0-9A-Fa-f]{2})/) || [])[1] ?? '??';
  const label = `MI_${mi}`;
  let dev;
  try {
    dev = new HID.HID(info.path);
  } catch (err) {
    console.log(`  ${label}: open FAILED — ${err.message}`);
    continue;
  }
  const state = {
    label, dev,
    reports: 0, stateReports: 0, lastId: null,
    lastPayload: null, changed: false, changeCount: 0,
    acceptedFeatureId: null,
  };
  dev.on('data', (data) => {
    state.reports++;
    // node-hid prepends the report id as byte 0 when the device uses numbered
    // reports. So node-hid index = WebHID offset + 1. The driver reads btn0 at
    // WebHID offset 1 → node-hid index 2; sticks at WebHID 9..16 → 10..17.
    // Bytes 5..8 (WebHID) are the triggers, 29..32 a fast-incrementing
    // timestamp — we deliberately EXCLUDE the timestamp so "ACTIVE" reflects
    // real user input, not the free-running clock.
    const reportId = data[0];
    if (STATE_REPORT_IDS.has(reportId)) {
      state.stateReports++;
      state.lastId = reportId;
      // ACTIVE = a digital control changed. Buttons btn0..btn2 + grip flags =
      // node-hid indices 2,3,4,5. Sticks are analog-noisy at rest, so we key
      // ACTIVE off buttons only — press any face/shoulder/dpad button to light
      // an interface. (Stick/trackpad mapping can be checked via btn=[] plus a
      // later analog view if needed.)
      const watch = [2, 3, 4, 5];
      if (state.lastPayload) {
        let diff = false;
        for (const i of watch) {
          if (data[i] !== state.lastPayload[i]) { diff = true; break; }
        }
        if (diff) { state.changed = true; state.changeCount++; }
      }
      state.btnHex = [2, 3, 4].map((i) => (data[i] ?? 0).toString(16).padStart(2, '0')).join(' ');
      state.lastPayload = Buffer.from(data);
    }
  });
  dev.on('error', () => {});
  state.acceptedFeatureId = sendLizardDisable(dev, label);
  monitors.push(state);
  console.log(`  ${label}: opened (feature id ${state.acceptedFeatureId != null ? hx(state.acceptedFeatureId) : 'none accepted'})  path=…${info.path.slice(-32)}`);
}

if (monitors.length === 0) { console.error('\nCould not open any vendor interface.'); process.exit(1); }

console.log('\nHeartbeating lizard-disable every 800ms. Press buttons / move sticks on ONE controller at a time.');
console.log('Watch which MI_xx interface shows STATE reports + ACTIVE.\n');

const heartbeat = setInterval(() => {
  for (const m of monitors) {
    try { m.dev.sendFeatureReport(Buffer.concat([Buffer.from([m.acceptedFeatureId ?? 0]), clearPayload()])); } catch {}
  }
}, HEARTBEAT_MS);

const report = setInterval(() => {
  const lines = monitors.map((m) => {
    const active = m.changed ? 'ACTIVE' : '  -   ';
    m.changed = false;
    return `  ${m.label}  state=${String(m.stateReports).padStart(6)}  btn=[${m.btnHex || '-- -- --'}]  ${active}  changes=${m.changeCount}`;
  });
  console.log(`[${new Date().toISOString().slice(11, 19)}]`);
  console.log(lines.join('\n'));
}, 1000);

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(report);
  console.log('\n\n=== SUMMARY ===');
  for (const m of monitors) {
    console.log(`  ${m.label}: ${m.stateReports} STATE reports, ${m.changeCount} input-change ticks, lastId=${m.lastId != null ? hx(m.lastId) : 'none'}`);
    try { m.dev.close(); } catch {}
  }
  const streaming = monitors.filter((m) => m.stateReports > 0);
  console.log(`\n${streaming.length} interface(s) streamed STATE: ${streaming.map((m) => m.label).join(', ') || 'none'}`);
  console.log('If each controller mapped to a DISTINCT interface, per-unit identity = interface path.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
