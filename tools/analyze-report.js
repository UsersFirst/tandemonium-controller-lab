#!/usr/bin/env node
// ============================================================
// analyze-report.js — auto-analysis of a Test Report JSON
// ============================================================
//
// Reads a controller-test-report/v1 JSON file emitted by the overlay's
// Capture HID Report wizard, performs per-step byte-variance analysis,
// and prints a candidate DEVICES entry plus IMU offsets + warnings.
//
// What the analyzer does:
//   1. Build per-byte stats (mean/stddev/range) for each step.
//   2. Localize the IMU region by finding bytes whose stddev *explodes*
//      during the pitch/roll/yaw steps but is near-zero at rest. Tries
//      every plausible 6-int16 gyro+accel window and picks the one
//      whose accel magnitude lands closest to 8192 (=1g, standard
//      ±4g/16-bit DS4 sensitivity).
//   3. Find the trigger bytes (high variance during triggers-shoulders
//      with monotonic 0→255 sweeps).
//   4. Find the button bytes (variance bursts during face/system steps).
//   5. Emit a candidate DEVICES entry + free-text warnings about steps
//      that produced no usable data (e.g. user skipped the touchpad).
//
// Usage:
//   node tools/analyze-report.js path/to/controller-test-report.json
//
// Limitations:
//   - Heuristics, not parsing — the output is a STARTING POINT, not
//     ground truth. Always verify by re-running the overlay with the
//     proposed offsets and checking the gyro behavior.
//   - Assumes the protocol family is one we already support (dualsense,
//     switch-pro, xbox, steam-controller). New protocols need a driver
//     class before the analyzer's output can be applied.

import fs from 'node:fs';
import path from 'node:path';

// ── CLI ────────────────────────────────────────────────────────
const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: node tools/analyze-report.js <path-to-report.json>');
  process.exit(1);
}
if (!fs.existsSync(reportPath)) {
  console.error('File not found:', reportPath);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.schema !== 'controller-test-report/v1') {
  console.warn('WARN: unexpected schema:', report.schema, '— attempting analysis anyway.');
}

// ── Helpers ────────────────────────────────────────────────────
const parseBytes = (hex) => hex.split(' ').map(b => parseInt(b, 16));
const int16LE = (b, off) => {
  let v = b[off] | (b[off + 1] << 8);
  return v > 0x7fff ? v - 0x10000 : v;
};
const fmt = (n, w = 1) => Number.isFinite(n) ? n.toFixed(w) : String(n);

function stepByteStats(step) {
  if (!step.reports?.length) return null;
  const len = parseBytes(step.reports[0].bytes).length;
  const stats = [];
  for (let pos = 0; pos < len; pos++) {
    let min = 255, max = 0, sum = 0, sumSq = 0;
    for (const rep of step.reports) {
      const v = parseBytes(rep.bytes)[pos];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      sumSq += v * v;
    }
    const n = step.reports.length;
    const mean = sum / n;
    const variance = (sumSq / n) - (mean * mean);
    stats.push({ pos, min, max, range: max - min, mean, stddev: Math.sqrt(Math.max(0, variance)) });
  }
  return stats;
}

function getStep(id) {
  return report.steps.find(s => s.id === id && !s.skipped && s.reports?.length);
}

// ── Header ─────────────────────────────────────────────────────
console.log('═'.repeat(64));
console.log('Controller Test Report Analysis');
console.log('═'.repeat(64));
console.log('File       :', path.basename(reportPath));
console.log('Captured   :', report.capturedAt);
console.log('Device     :', report.device.productName, `(${report.device.vendorIdHex}:${report.device.productIdHex}, ${report.device.connectionType})`);
console.log('Alias      :', report.alias || '(none)');
console.log('User note  :', report.userNote || '(none)');
console.log('Picked     :', report.pickedEntry?.name || '(none — used registry default)');
console.log('Registry   :', report.registryMatch?.name || '(no match)', report.registryMatch?.protocol ? `(${report.registryMatch.protocol})` : '');
console.log('Steps      :', report.steps.map(s => `${s.id}${s.skipped ? '(skipped)' : `(${s.reportCount})`}`).join(', '));
console.log();

// ── Step stats ─────────────────────────────────────────────────
const stats = {};
for (const s of report.steps) {
  stats[s.id] = stepByteStats(s);
}

const restStats = stats['at-rest'];
if (!restStats) {
  console.error('FATAL: at-rest step missing or empty — analysis needs a baseline.');
  process.exit(1);
}

// ── IMU offset search ──────────────────────────────────────────
// At-rest accel magnitude should be ~1g. For Sony's DS4/DS5 scale,
// 1g = 8192 raw. We try each candidate gyro offset (g) with accel at
// g+6, compute mean accel magnitude across at-rest, and pick the offset
// whose magnitude is closest to 8192.
function evaluateImuOffset(gyroOffset, atRestReports) {
  const accelOffset = gyroOffset + 6;
  const reportLen = parseBytes(atRestReports[0].bytes).length;
  if (accelOffset + 6 > reportLen) return null;
  let sumMag = 0, n = 0;
  for (const rep of atRestReports) {
    const b = parseBytes(rep.bytes);
    const ax = int16LE(b, accelOffset);
    const ay = int16LE(b, accelOffset + 2);
    const az = int16LE(b, accelOffset + 4);
    sumMag += Math.sqrt(ax * ax + ay * ay + az * az);
    n++;
  }
  const meanMag = sumMag / n;
  // Also need: gyro should be NEAR ZERO at rest. Compute mean(|g|).
  let sumGyroAbs = 0;
  for (const rep of atRestReports) {
    const b = parseBytes(rep.bytes);
    sumGyroAbs += Math.abs(int16LE(b, gyroOffset)) +
                  Math.abs(int16LE(b, gyroOffset + 2)) +
                  Math.abs(int16LE(b, gyroOffset + 4));
  }
  const meanGyroAbs = sumGyroAbs / n;
  // Score: distance from 8192 (lower is better) penalized by gyro magnitude
  // (small gyro values mean we're at rest as expected).
  const accelScore = Math.abs(meanMag - 8192);
  const gyroScore = meanGyroAbs;
  return { gyroOffset, accelOffset, meanAccelMag: meanMag, meanGyroAbs, score: accelScore + gyroScore };
}

const atRestStep = getStep('at-rest');
const candidates = [];
const reportLen = parseBytes(atRestStep.reports[0].bytes).length;
for (let g = 11; g + 12 <= reportLen; g++) {
  const r = evaluateImuOffset(g, atRestStep.reports);
  if (r) candidates.push(r);
}
candidates.sort((a, b) => a.score - b.score);

console.log('── IMU offset search ' + '─'.repeat(43));
console.log('Top 5 candidates (best = accel mag closest to 8192, gyro near 0):');
console.log('  offset  accel_mag   gyro_abs   score');
for (const c of candidates.slice(0, 5)) {
  console.log(`  g=${String(c.gyroOffset).padStart(2)} a=${String(c.accelOffset).padStart(2)}  ${fmt(c.meanAccelMag).padStart(8)}   ${fmt(c.meanGyroAbs).padStart(7)}   ${fmt(c.score)}`);
}
const bestImu = candidates[0];
console.log(`\nWinner: gyroOffset=${bestImu.gyroOffset}, accelOffset=${bestImu.accelOffset}`);
console.log(`  At-rest accel magnitude ${fmt(bestImu.meanAccelMag)} (target 8192 = 1g; ${fmt(bestImu.meanAccelMag / 8192 * 100, 1)}% of 1g)`);
console.log();

// ── Per-axis gyro response check ───────────────────────────────
function gyroAxisActivity(step, gyroOffset) {
  if (!step) return null;
  const gx = [], gy = [], gz = [];
  for (const rep of step.reports) {
    const b = parseBytes(rep.bytes);
    gx.push(int16LE(b, gyroOffset));
    gy.push(int16LE(b, gyroOffset + 2));
    gz.push(int16LE(b, gyroOffset + 4));
  }
  const stdOf = (arr) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length);
  };
  return { gxStd: stdOf(gx), gyStd: stdOf(gy), gzStd: stdOf(gz) };
}

console.log('── Gyro axis mapping ' + '─'.repeat(43));
console.log('Per-axis stddev during each rotation step — high stddev = active axis:');
console.log('  step    gyroX_std  gyroY_std  gyroZ_std   likely axis');
for (const id of ['pitch', 'roll', 'yaw']) {
  const s = getStep(id);
  if (!s) { console.log(`  ${id.padEnd(7)} (skipped or empty)`); continue; }
  const r = gyroAxisActivity(s, bestImu.gyroOffset);
  const top = ['X', 'Y', 'Z'][[r.gxStd, r.gyStd, r.gzStd].indexOf(Math.max(r.gxStd, r.gyStd, r.gzStd))];
  console.log(`  ${id.padEnd(7)} ${fmt(r.gxStd).padStart(9)}  ${fmt(r.gyStd).padStart(9)}  ${fmt(r.gzStd).padStart(9)}   gyro ${top}`);
}
console.log();

// ── Button byte detection ──────────────────────────────────────
// Bytes that change during face-buttons / system-buttons / triggers
// steps but stay constant at rest are button registers. For each, list
// which bit positions flip (XOR with at-rest baseline).
function activeBytes(step, restStats, opts = {}) {
  if (!step) return [];
  const s = stats[step.id];
  if (!s) return [];
  const out = [];
  for (let pos = 0; pos < s.length; pos++) {
    // Skip bytes that already change at rest (counter / timestamp).
    if (restStats[pos] && restStats[pos].range > (opts.restRangeMax || 30)) continue;
    if (s[pos].range > 4) {
      out.push({ pos, range: s[pos].range, stddev: s[pos].stddev });
    }
  }
  return out;
}

console.log('── Button & trigger byte detection ' + '─'.repeat(29));
for (const id of ['face-buttons', 'system-buttons', 'triggers-shoulders', 'sticks', 'dpad', 'sticks-dpad']) {
  const s = getStep(id);
  if (!s) { console.log(`  ${id}: (skipped or empty)`); continue; }
  const active = activeBytes(s, restStats);
  // Exclude the IMU region from this list — IMU bytes also change because
  // the user holds and moves the pad during these steps.
  const buttonBytes = active.filter(a => a.pos < bestImu.gyroOffset || a.pos >= bestImu.accelOffset + 6);
  console.log(`  ${id}:`);
  for (const b of buttonBytes) {
    console.log(`    byte ${String(b.pos).padStart(2)} range=${String(b.range).padStart(3)} stddev=${fmt(b.stddev)}`);
  }
}
console.log();

// ── Warnings ───────────────────────────────────────────────────
console.log('── Warnings ' + '─'.repeat(52));
const warnings = [];
for (const s of report.steps) {
  if (s.skipped) {
    warnings.push(`Step "${s.id}" was skipped — features depending on it weren't captured.`);
  } else if (!s.reports?.length) {
    warnings.push(`Step "${s.id}" recorded 0 reports — device may have disconnected.`);
  }
}
if (bestImu.meanAccelMag < 4000 || bestImu.meanAccelMag > 12000) {
  warnings.push(`At-rest accel magnitude (${fmt(bestImu.meanAccelMag)}) is far from 8192 — the IMU offset guess may be wrong, OR the accel scale isn't 1/8192 (e.g. DualSense uses 1/4096 → expect ~4096 at rest).`);
}
const pickedProtocol = report.pickedEntry?.protocol || report.registryMatch?.protocol;
if (!pickedProtocol) {
  warnings.push('No matched protocol — the controller isn\'t in DEVICES yet. The candidate entry below assumes "dualsense" protocol; change if your controller speaks a different one.');
}
if (warnings.length === 0) {
  console.log('  (none)');
} else {
  for (const w of warnings) console.log('  • ' + w);
}
console.log();

// ── Candidate DEVICES entry ────────────────────────────────────
console.log('── Suggested DEVICES entry (paste into packages/core/src/devices.js) ──');
const name = report.alias || report.pickedEntry?.name || report.device.productName || 'Unknown Controller';
const protocol = pickedProtocol || 'dualsense';
const mode = report.pickedEntry?.mode || report.registryMatch?.mode || 'ds4';
const isStandardImu = bestImu.gyroOffset === 15 || bestImu.gyroOffset === 12;
const imuOverride = isStandardImu
  ? '  // IMU offsets match standard ' + (bestImu.gyroOffset === 15 ? 'DualSense (DS5)' : 'DualShock 4 (DS4)') + ' layout — no override needed.'
  : `  imu: { gyroOffset: ${bestImu.gyroOffset}, accelOffset: ${bestImu.accelOffset}, accelScale: 1/8192 },`;

console.log(`
  {
    name:             ${JSON.stringify(name)},
    vendorId:         0x${report.device.vendorIdHex},
    productId:        0x${report.device.productIdHex},
    protocol:         ${JSON.stringify(protocol)},
    mode:             ${JSON.stringify(mode)},
    capabilities:     { gyro: ${bestImu.meanGyroAbs < 1000 && bestImu.meanAccelMag > 4000}, accel: ${bestImu.meanAccelMag > 4000}, touchpad: ${!!getStep('touchpad')} },
    features:         { /* derived from capture; review and adjust */
                        faceButtons: ${!!getStep('face-buttons')},
                        systemButtons: ${!!getStep('system-buttons')},
                        triggers: ${getStep('triggers-shoulders') ? "'analog'" : 'false'},
                        shoulders: true,
                        sticks: 2,
                        dpad: true,
                        gyro: ${bestImu.meanGyroAbs < 1000 && bestImu.meanAccelMag > 4000},
                        accel: ${bestImu.meanAccelMag > 4000},
                        touchpad: ${!!getStep('touchpad')},
                        backPaddles: ${!!getStep('back-paddles')},
                        lightbar: false, rumble: true },
    gamepadIdPattern: /TODO_pattern/i,
${imuOverride}
    notes: ${JSON.stringify('Analyzer output from ' + path.basename(reportPath) + (report.userNote ? ' — user note: ' + report.userNote : ''))},
  },
`);

console.log('Done. Re-run the wizard after editing devices.js to verify.\n');
