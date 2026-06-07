#!/usr/bin/env node
// ============================================================
// hid-serial-dump.cjs — list every HID device + its serialNumber
// ============================================================
//
// The browser (WebHID / Gamepad API) deliberately hides controller serial
// numbers. Node's `node-hid`, run in a real process (or Electron's main
// process), surfaces a `serialNumber` field — and for Bluetooth controllers
// that's typically the MAC address: a stable, per-unit identifier we can use
// to tell two identical pads apart.
//
// Run:
//   npm i node-hid        # ships prebuilt binaries for Win/macOS/Linux
//   node tools/hid-serial-dump.cjs            # game controllers only
//   node tools/hid-serial-dump.cjs --all      # every HID interface
//
// .cjs so it uses require() regardless of the repo's "type": "module".

let HID;
try {
  HID = require('node-hid');
} catch (e) {
  console.error(
    'node-hid is not installed.\n\n' +
    'Install it (prebuilt binaries — no compiler needed on Win/macOS/Linux):\n' +
    '  npm i node-hid\n\n' +
    'then re-run:\n' +
    '  node tools/hid-serial-dump.cjs\n'
  );
  process.exit(1);
}

const KNOWN = {
  0x054c: 'Sony', 0x057e: 'Nintendo', 0x28de: 'Valve',
  0x045e: 'Microsoft', 0x3537: 'GameSir', 0x2dc8: '8BitDo', 0x0f0d: 'Hori',
};

const showAll = process.argv.includes('--all');
const hx = (n, w = 4) => '0x' + ((n || 0) >>> 0).toString(16).padStart(w, '0');

let devices;
try {
  devices = HID.devices();
} catch (e) {
  console.error('HID.devices() failed:', e.message);
  process.exit(1);
}

const isController = (d) => Object.prototype.hasOwnProperty.call(KNOWN, d.vendorId);
const controllers = devices.filter(isController);
const others = devices.filter((d) => !isController(d));

function printDev(d) {
  const tag = KNOWN[d.vendorId] ? ` [${KNOWN[d.vendorId]}]` : '';
  console.log(`  ${hx(d.vendorId)}:${hx(d.productId).slice(2)}${tag}  ${d.product || '(no product)'}`);
  console.log(`     manufacturer : ${d.manufacturer || '-'}`);
  console.log(`     serialNumber : ${d.serialNumber ? '>>> ' + d.serialNumber + ' <<<' : '(none)'}`);
  console.log(`     interface=${d.interface}  usagePage=${hx(d.usagePage)} usage=${hx(d.usage)}  release=${d.release}`);
  console.log(`     path         : ${d.path}`);
}

console.log(`\nnode-hid sees ${devices.length} HID interface(s).`);
console.log('Note: one physical controller can expose several interfaces (the Steam Puck shows up to 5).\n');

console.log(`=== Game controllers (${controllers.length}) ===`);
if (!controllers.length) console.log('  (none found — is the controller connected & paired?)');
controllers.forEach(printDev);

if (showAll) {
  console.log(`\n=== Other HID devices (${others.length}) ===`);
  others.forEach(printDev);
} else {
  console.log(`\n(${others.length} other HID devices hidden — pass --all to show keyboards/mice/etc.)`);
}

console.log(
  '\nKey field: serialNumber. For Bluetooth controllers it is usually the MAC address\n' +
  '(a stable per-unit id that distinguishes even two identical pads). "(none)" means\n' +
  'this device/transport exposes no per-unit id — fall back to VID:PID.\n'
);
