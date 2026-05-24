// ============================================================
// TEST REPORT — guided HID capture for adding new controllers
// ============================================================
//
// Walks the user through eight scripted steps (at-rest, per-axis rotation,
// triggers, face buttons, dpad, sticks, touchpad), recording every HID
// inputreport during each step. Output is a JSON file you can share back
// for byte-level analysis — the loop wins twice: each step's bytes diff
// against the at-rest baseline to localize a field (which bytes move
// when you press R2? when you tilt forward?), and the whole report is
// the ground-truth document for building a new DEVICES entry / driver.
//
// MVP today. Future wizard pass: an `analysis` block that runs the diffs
// here and emits a candidate DEVICES entry + IMU offsets automatically.
//
// Schema version is bumped on any breaking change to the JSON shape so
// downstream tools can refuse incompatible files instead of mis-parsing.

import { ControllerRegistry } from '@usersfirst/controller-core';

export const TEST_REPORT_SCHEMA = 'controller-test-report/v1';

/**
 * Step list. Each step has:
 *   id        — short stable key (used in JSON output and analysis)
 *   title     — short label shown in the modal header
 *   prompt    — instruction shown to the user
 *   durationMs — how long to record after the user clicks Start
 *
 * Order matters: at-rest first so analysis can use it as the diff baseline.
 */
// Each step declares `requires` — an array of feature flags the controller
// must report `true` (or, for `triggers`, a non-false value) to be eligible
// for this step. The wizard filters STEPS using `stepsForEntry(entry)`;
// unknown controllers default to "include everything" since we don't have
// a feature inventory to consult.
export const STEPS = [
  {
    id: 'at-rest',
    title: 'At rest',
    prompt: 'Put the controller flat on a hard surface, face up, and take your hands off completely. Click Start, then don\'t touch it for 5 seconds.',
    durationMs: 5000,
    requires: ['gyro'],   // skipped for IMU-less pads (e.g. Xbox)
  },
  {
    id: 'pitch',
    title: 'Pitch (nose up / nose down)',
    prompt: 'Pick the controller up. Hold it level. After clicking Start, slowly tilt the FRONT EDGE up about 45°, then back down past level, then nose-down about 45°, and back to level. Repeat smoothly.',
    durationMs: 5000,
    requires: ['gyro'],
  },
  {
    id: 'roll',
    title: 'Roll (tilt left / tilt right)',
    prompt: 'Hold the controller level. After clicking Start, slowly tilt the LEFT side down about 45°, back to level, right side down 45°, back to level. Repeat smoothly.',
    durationMs: 5000,
    requires: ['gyro'],
  },
  {
    id: 'yaw',
    title: 'Yaw (turn left / right)',
    prompt: 'Hold the controller level, face up. After clicking Start, slowly rotate it counter-clockwise 90° (as if turning a steering wheel), then back to center, then clockwise 90°, back to center. Repeat smoothly.',
    durationMs: 5000,
    requires: ['gyro'],
  },
  {
    id: 'face-buttons',
    title: 'Face buttons',
    prompt: 'Press and release each face button in this order: ✕/A → ◯/B → ▢/X → △/Y. Hold each for about 1 second before releasing. You have plenty of time.',
    durationMs: 9000,
    requires: ['faceButtons'],
  },
  {
    id: 'system-buttons',
    title: 'System / navigation buttons',
    prompt: 'In this order, with a clear pause between each: PS / Home button → Share / Create / View button → Options / Menu / Start → click the Touchpad (press it down, don\'t just touch) → Mute button if present. Skip any your controller doesn\'t have.',
    durationMs: 10000,
    requires: ['systemButtons'],
  },
  {
    id: 'triggers-shoulders',
    title: 'Triggers and shoulders',
    prompt: 'In this order: hold L2 (left trigger) all the way for 1s and release; hold R2 (right trigger) for 1s and release; tap L1 (left shoulder); tap R1 (right shoulder). Don\'t rush — pause between each.',
    durationMs: 10000,
    requires: ['triggers'],
  },
  {
    id: 'sticks-dpad',
    title: 'Sticks and D-pad',
    prompt: 'Roll the LEFT stick in a slow full circle (one revolution), then the RIGHT stick in a circle. Then click each D-pad direction: up, right, down, left. Take a full beat between each.',
    durationMs: 12000,
    requires: ['sticks'],
  },
  {
    id: 'touchpad',
    title: 'Touchpad swipe',
    prompt: 'Drag a finger across the touchpad in several directions. Lift and re-touch to register multiple strokes. Try a two-finger touch if your touchpad supports it.',
    durationMs: 6000,
    requires: ['touchpad'],
    optional: true,
  },
  {
    id: 'back-paddles',
    title: 'Back paddles / extras',
    prompt: 'Click each back paddle / extra programmable button in turn. Note in the chat message which is which (e.g. "M1, M2, M3, M4 from left to right"). Skip if your controller doesn\'t have these.',
    durationMs: 6000,
    requires: ['backPaddles'],
    optional: true,
  },
];

/**
 * Build the wizard's step list for a given dictionary entry. Each STEP's
 * `requires` array names hardware features the controller must report;
 * if any of them is missing/false on the entry's `features` block, the
 * step is dropped. Unknown controllers (no entry, or entry has no
 * `features` block) get the full list — better to over-prompt than skip
 * a step that would have captured data.
 */
export function stepsForEntry(entry) {
  if (!entry?.features) return STEPS.slice();
  const features = entry.features;
  return STEPS.filter(step => {
    if (!step.requires) return true;
    return step.requires.every(f => {
      const v = features[f];
      return v !== undefined && v !== false && v !== 0;
    });
  });
}

// ── byte → hex helper ──
function bytesToHex(dataView) {
  const out = [];
  for (let i = 0; i < dataView.byteLength; i++) {
    out.push(dataView.getUint8(i).toString(16).padStart(2, '0'));
  }
  return out.join(' ');
}

/**
 * Snapshot of the current Gamepad-API state for the device, if available.
 * Useful as a sanity-check alongside the raw HID bytes: e.g. if R2 reads 1.0
 * in the snapshot but no HID byte changes, the IMU/trigger fields are
 * elsewhere in the report.
 */
function snapshotGamepad(vendorId, productId) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const m = ControllerRegistry.parseGamepadVendorProduct(gp.id);
    if (m && m.vendorId === vendorId && m.productId === productId) {
      return {
        axes: Array.from(gp.axes).map(n => Number(n.toFixed(4))),
        buttons: gp.buttons.map(b => ({ pressed: b.pressed, value: Number(b.value.toFixed(4)) })),
      };
    }
  }
  return null;
}

/**
 * Record `inputreport` events from `device` for `durationMs`. Returns the
 * list of captured reports. Caller is responsible for re-throwing if the
 * device dies mid-capture.
 *
 * @param {HIDDevice} device
 * @param {number} durationMs
 * @returns {Promise<Array<{ts:number, reportId:number, bytes:string, gamepad?:object}>>}
 */
export async function recordStep(device, durationMs) {
  return new Promise((resolve, reject) => {
    if (!device) return reject(new Error('No HID device to capture from.'));
    const reports = [];
    const t0 = performance.now();
    let lastGamepadSnapAt = 0;

    const onReport = (event) => {
      const ts = Math.round(performance.now() - t0);
      const rec = {
        ts,
        reportId: event.reportId,
        bytes: bytesToHex(event.data),
      };
      // Snapshot Gamepad-API state at most every 50ms — enough to correlate
      // bytes against parsed values without bloating the JSON output.
      if (ts - lastGamepadSnapAt >= 50) {
        const gp = snapshotGamepad(device.vendorId, device.productId);
        if (gp) rec.gamepad = gp;
        lastGamepadSnapAt = ts;
      }
      reports.push(rec);
    };

    device.addEventListener('inputreport', onReport);

    const timer = setTimeout(() => {
      device.removeEventListener('inputreport', onReport);
      resolve(reports);
    }, durationMs);

    // If the device disconnects mid-capture, surface that explicitly so the
    // UI can stop the wizard instead of waiting for a timeout that yields
    // empty data.
    const onDisconnect = (e) => {
      if (e.device !== device) return;
      clearTimeout(timer);
      navigator.hid.removeEventListener('disconnect', onDisconnect);
      device.removeEventListener('inputreport', onReport);
      reject(new Error('Device disconnected during capture.'));
    };
    navigator.hid.addEventListener('disconnect', onDisconnect);

    setTimeout(() => navigator.hid.removeEventListener('disconnect', onDisconnect), durationMs + 100);
  });
}

/**
 * Assemble the final JSON document from collected per-step results.
 *
 * @param {object} args
 * @param {HIDDevice} args.device          — the captured device (vid/pid/productName)
 * @param {string}    args.gamepadId        — gamepad.id of the matching pad, if any
 * @param {string}    args.connectionType   — 'usb' | 'bluetooth' as detected by the driver
 * @param {Array}     args.results          — [{ step, reports }, ...]
 */
export function buildReport({ device, gamepadId, connectionType, results, alias = null, userNote = null, pickedEntry = null }) {
  const defaultEntry = ControllerRegistry.getEntry(device.vendorId, device.productId);
  const entry = pickedEntry || defaultEntry;
  const idInfo = gamepadId ? ControllerRegistry.identifyFromGamepadId(gamepadId) : null;

  return {
    schema: TEST_REPORT_SCHEMA,
    capturedAt: new Date().toISOString(),
    alias: alias || null,
    userNote: userNote || null,
    // When the user picks a clone from the spoof picker, record both the
    // picked entry and the default one so analysis tools can see the
    // disambiguation in full context.
    pickedEntry: pickedEntry
      ? { name: pickedEntry.name, protocol: pickedEntry.protocol, mode: pickedEntry.mode || null,
          spoofs: pickedEntry.spoofs || null, features: pickedEntry.features || null }
      : null,
    device: {
      vendorId: device.vendorId,
      productId: device.productId,
      vendorIdHex: device.vendorId.toString(16).padStart(4, '0'),
      productIdHex: device.productId.toString(16).padStart(4, '0'),
      productName: device.productName || null,
      gamepadId: gamepadId || null,
      connectionType: connectionType || null,
    },
    registryMatch: entry
      ? { name: entry.name, protocol: entry.protocol, mode: entry.mode || null,
          capabilities: entry.capabilities }
      : null,
    gamepadIdMatch: idInfo,
    steps: results.map(({ step, reports, skipped }) => ({
      id: step.id,
      title: step.title,
      prompt: step.prompt,
      durationMs: step.durationMs,
      skipped: !!skipped,
      reportCount: reports.length,
      reports,
    })),
  };
}

/**
 * Hand the JSON to Electron's save dialog. Falls back to a browser
 * download blob if running outside Electron (for future browser builds).
 */
export async function exportReport(report) {
  const json = JSON.stringify(report, null, 2);
  const stamp = report.capturedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  // Sanitize the alias for filename use — keep letters/digits/dash/underscore.
  const aliasPart = report.alias
    ? '_' + report.alias.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    : '';
  const suggested = `controller-test-report_${report.device.vendorIdHex}-${report.device.productIdHex}${aliasPart}_${stamp}.json`;

  if (window.electronAPI?.saveTestReport) {
    return window.electronAPI.saveTestReport(json, suggested);
  }
  // Browser fallback
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggested;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { saved: true, path: suggested };
}
