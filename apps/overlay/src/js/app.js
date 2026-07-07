// ============================================================
// APP.JS — Main entry point for 3D Controller Overlay
// ============================================================
//
// Gyro connection mirrors the Tandemonium game's lobby.js pattern:
// - Gyro toggle button appears when a gyro-capable controller connects
// - In desktop (Electron): auto-connect after 1s delay
// - In browser: click the gyro button to connect (user gesture needed)
// - Click gyro button to toggle on/off
// - L3 to recalibrate
// ============================================================

import * as THREE from 'three';
import { ControllerOverlay, detectControllerType, PROFILES, GyroGimbal } from '@usersfirst/controller-visualizer';
import { ControllerRegistry, SensorFusion, analyzeImuStep, SteamControllerDriver, ControllerManager } from '@usersfirst/controller-core';
import { recordStep, buildReport, exportReport, stepsForEntry, parseImuSamples,
  areasForSteps, filterStepsByAreas, AREA_LABELS, STEP_AREAS } from './test-report.js';

// ── DOM refs ──
const canvas = document.getElementById('canvas');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const controllerTypeSelect = document.getElementById('controller-type');

// Populate the controller-type dropdown from PROFILES at runtime so adding a
// new visualizer profile (drop a GLB + add a PROFILES entry) automatically
// surfaces here without an HTML edit. The first <option value="auto"> is
// kept from the static markup; everything else gets replaced.
(function populateControllerTypeOptions() {
  // Remove all options except the first ('auto')
  while (controllerTypeSelect.options.length > 1) controllerTypeSelect.remove(1);
  const entries = Object.entries(PROFILES).sort((a, b) => a[1].name.localeCompare(b[1].name));
  for (const [key, profile] of entries) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = profile.name || key;
    controllerTypeSelect.appendChild(opt);
  }
  // Restore last manual choice if the user previously picked something.
  const saved = localStorage.getItem('overlay:controllerType');
  if (saved && (saved === 'auto' || controllerTypeSelect.querySelector(`option[value="${saved}"]`))) {
    controllerTypeSelect.value = saved;
  }
})();
const connectGyroBtn = document.getElementById('connect-gyro-btn');
const driftModeSelect = document.getElementById('drift-mode');
const yawReturnSelect = document.getElementById('yaw-return-mode');
const gamepadStatusEl = document.getElementById('gamepad-status');
// Gyro status shown via the gyro toggle button (no separate text badge)
const gyroToggleBtn = document.getElementById('gyro-toggle');
const clickThroughIndicator = document.getElementById('click-through-indicator');
const noControllerSplash = document.getElementById('no-controller');
// LIVE badge (#104): opt-in indicator showing the SELECTED controller's name
// while it drives the overlay. Default OFF — only shown when the user enables
// "Show Controller Badge" in settings.
const liveBadge = document.getElementById('live-badge');
const liveBadgeName = document.getElementById('live-badge-name');
let showBadge = localStorage.getItem('overlay:showBadge') === '1';
const puckHint = document.getElementById('puck-hint');
const puckStatusBanner = document.getElementById('puck-status-banner');
const puckStatusDismiss = document.getElementById('puck-status-dismiss');

// ── Steam Controller Puck state ──
// puckConnected: a Puck device (vid:pid 28de:1304) is the active HID device.
// puckHasState: at least one 53-byte STATE report has arrived (= controller
//   body is paired and emitting). Until true, we show the splash hint.
// puckBannerDismissed: user clicked × on the warning banner this session.
let puckConnected = false;
let puckHasState = false;
let puckBannerDismissed = false;
let puckHintTimer = null;
const PUCK_HINT_DELAY_MS = 2000;
const PUCK_VID = 0x28de;
const PUCK_PID = 0x1304;

function isPuckDevice(device) {
  return device && device.vendorId === PUCK_VID && device.productId === PUCK_PID;
}

function showPuckBanner() {
  if (!puckStatusBanner || puckBannerDismissed) return;
  puckStatusBanner.hidden = false;
}
function hidePuckBanner() {
  if (puckStatusBanner) puckStatusBanner.hidden = true;
}
function showPuckHint() { if (puckHint) puckHint.hidden = false; }
function hidePuckHint() {
  if (puckHint) puckHint.hidden = true;
  if (puckHintTimer) { clearTimeout(puckHintTimer); puckHintTimer = null; }
}

function onPuckConnected() {
  puckConnected = true;
  puckHasState = false;
  showPuckBanner();
  if (puckHintTimer) clearTimeout(puckHintTimer);
  puckHintTimer = setTimeout(() => {
    if (puckConnected && !puckHasState) showPuckHint();
  }, PUCK_HINT_DELAY_MS);
}
function onPuckDisconnected() {
  puckConnected = false;
  puckHasState = false;
  hidePuckBanner();
  hidePuckHint();
}
function onPuckStateReport() {
  if (!puckConnected || puckHasState) return;
  puckHasState = true;
  hidePuckHint();
}

if (puckStatusDismiss) {
  puckStatusDismiss.addEventListener('click', () => {
    puckBannerDismissed = true;
    hidePuckBanner();
  });
}

// ── State ──
let overlay = null;
let gamepadIndex = null;
let currentControllerType = 'dualsense';
let modelReady = false;
let switchingController = false;

// HID / gyro
let hidDevice = null;
// Additional HID handles whose inputreport feeds the same driver — used
// only for multi-interface devices like the Steam Controller Puck where
// requestDevice returns one of N interfaces and only one of them emits
// STATE reports. Stays empty for single-interface controllers.
let hidExtraDevices = [];
let controllerDriver = null;
let gyroActive = false;          // true when gyro is connected and feeding data
let gyroPermitted = false;       // true once gyro has been connected at least once

// Synthetic gamepad built from HID input reports. Needed because DualSense
// over Bluetooth, once switched into 0x31 full-report mode, disappears from
// Chromium's Gamepad API entirely. When that happens we parse sticks, buttons,
// and triggers directly from the HID report and expose them in a Gamepad-
// shaped object that the rest of the app consumes via readGamepad().
let syntheticGamepad = null;
// Shared sensor fusion (was inline state + ~250 lines of duplicate math).
// Keeps orientation, gravity tracking, stillness & sensor-fusion bias
// calibration, and all related scratch vectors internal. See #224.
// Phase 3b: the overlay drives its viz from the SELECTED pool entry's fusion —
// the SAME per-controller SensorFusion the game uses (self-calibrating via
// startCalibration). `gyroFusion` is an ALIAS repointed to that entry's fusion
// on selection; `_idleFusion` is a neutral placeholder when nothing is selected
// so the loop's `gyroFusion.displayOrientation` reads never hit null.
const _idleFusion = new SensorFusion();
let gyroFusion = _idleFusion;
let selectedEntry = null;   // the pool HidEntry currently shown in the overlay

// ── Controllers pool (Phase 3b: single owner) ──
// A ControllerManager that opens EVERY granted HID handle over WebHID and keeps
// each one live (driver + fusion + synthetic). The overlay's SELECTED controller
// is simply a designated entry from this pool — no separate connection, no
// eviction. The pool is the single owner of every HID device; the Gamepad API is
// only a fallback for XInput-only pads (Xbox).
const listManager = new ControllerManager({ slotIds: ['_ovl'] });
async function initControllerList() {
  if (!navigator.hid) return;
  try {
    const approved = await navigator.hid.getDevices();
    for (const d of approved) {
      if (ControllerRegistry.isKnownDevice(d)) await listManager.poolDevice(d);
    }
    listManager.wireHidHotplug();
  } catch (e) { console.warn('[overlay] controller-pool init failed', e); }
}
// Set once by an explicit list-selection; consumed by connectControllerGyro so
// it binds THIS exact handle (identical vid:pid pads share a vid:pid, not this).
let _preferredGyroDevice = null;
// Stable per-device id so the detached list can address an EXACT handle.
const _deviceIds = new WeakMap();
let _deviceIdSeq = 0;
function deviceIdFor(device) {
  if (!_deviceIds.has(device)) _deviceIds.set(device, ++_deviceIdSeq);
  return _deviceIds.get(device);
}
// The controllers a user has interacted with at least once (dot lit) — keyed by
// device id / gamepad index — so the list can show ACTIVE vs idle AVAILABLE.
const _everActive = new Set();

// Per-unit serial/MAC inventory from the Electron main process (the renderer's
// WebHID handle carries no serial). Populated as devices are paired/hotplugged;
// a boot scan (select-hid-device with the full deviceList) fills it for
// already-present devices. Matched to rows by vid:pid.
let _hidInventory = [];
function initSerialInventory() {
  if (!window.electronAPI) return;
  try {
    if (window.electronAPI.listHidControllers) window.electronAPI.listHidControllers().then((l) => { if (Array.isArray(l)) _hidInventory = l; }).catch(() => {});
    if (window.electronAPI.onHidControllersSnapshot) window.electronAPI.onHidControllersSnapshot((l) => { if (Array.isArray(l)) _hidInventory = l; });
    // Serial scan happens on the "Show list…" gesture — requestDevice needs user
    // activation, so a boot timer can't populate the inventory.
  } catch (e) { /* best-effort */ }
}
// Match a handle to its main-process serial. Electron's main HIDDevice exposes
// no `collections` (so a descriptor fingerprint is impossible there) — but the
// renderer DOES know each handle's connection type. Unique vid:pid → 1:1. Two
// identical-vid:pid units (a BT clone + a USB DS4) → disambiguate by transport:
// a Bluetooth unit carries a MAC serial, a USB DS4 carries none.
function serialForDevice(vp, connType) {
  const units = vp ? _hidInventory.filter((u) => u.vendorId === vp.vendorId && u.productId === vp.productId) : [];
  if (!units.length) return '';
  if (units.length === 1) return units[0].serialNumber || '(no serial)';
  const withSerial = units.filter((u) => u.serialNumber);
  if (connType === 'bluetooth' && withSerial.length === 1) return withSerial[0].serialNumber;
  if (connType === 'usb' && units.some((u) => !u.serialNumber)) return '(USB — no serial)';
  return units.map((u) => u.serialNumber || 'no serial').join(' / ');
}

// App-layer calibration still owns variance-check + retry UX — on success
// it pushes the captured bias into gyroFusion.bias.
let calibrating = false;
let calibSamples = [];
const CALIB_COUNT = 150;
let calibRetries = 0;
const MAX_CALIB_RETRIES = 5;
const CALIB_VARIANCE_THRESHOLD = 150;
let gyroConnectTimer = null;

// ── Button combo system ──
const BUTTON_NAMES = [
  'A/Cross', 'B/Circle', 'X/Square', 'Y/Triangle',
  'L1/LB', 'R1/RB', 'L2/LT', 'R2/RT',
  'Select', 'Start', 'L3', 'R3',
  'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home',
];

const DEFAULT_COMBOS = {
  settings:   [8, 9],    // Select + Start
  gyroToggle: [8, 11],   // Select + R3
  calibrate:  [10, 11],  // L3 + R3
  recenter:   [8, 10],   // Select + L3 — instant yaw recenter (no recalibration)
};

// Load saved combos from localStorage, fall back to defaults
function loadCombos() {
  try {
    const saved = localStorage.getItem('overlay-combos');
    if (saved) return { ...DEFAULT_COMBOS, ...JSON.parse(saved) };
  } catch (e) { /* ignore */ }
  return { ...DEFAULT_COMBOS };
}
function saveCombos() {
  try { localStorage.setItem('overlay-combos', JSON.stringify(combos)); } catch (e) { /* ignore */ }
}

const combos = loadCombos();
const comboPrevState = {};  // track previous pressed state per combo

function comboName(buttons) {
  return buttons.map(b => BUTTON_NAMES[b] || `Btn${b}`).join(' + ');
}

function isComboPressed(gamepad, buttons) {
  return buttons.every(b => gamepad.buttons[b]?.pressed);
}

function checkCombo(gamepad, key, action) {
  const pressed = isComboPressed(gamepad, combos[key]);
  if (pressed && !comboPrevState[key]) action();
  comboPrevState[key] = pressed;
}

// Remap capture state
let remapTarget = null;  // which combo key is being remapped

// Gravity correction mode (scales fusion.gravityMode 0..1)
const GRAVITY_MODES = { off: 0, gentle: 0.5, strong: 1.0 };
let gravityMode = 'gentle';
gyroFusion.gravityMode = GRAVITY_MODES[gravityMode];

// Yaw-drift return-to-neutral at rest (issue #88). Gravity correction can't fix
// yaw, so this slowly bleeds the displayed heading back to center while the
// controller rests. Values are the return half-life in seconds; 0 = off.
const YAW_RETURN_MODES = { off: 0, gentle: 2.0, strong: 0.6 };
let yawReturnMode = localStorage.getItem('overlay:yawReturn') || 'gentle';
if (!(yawReturnMode in YAW_RETURN_MODES)) yawReturnMode = 'gentle';
gyroFusion.yawReturnHalfLife = YAW_RETURN_MODES[yawReturnMode];

const isDesktop = typeof window !== 'undefined' &&
  (window.electronAPI || navigator.userAgent.includes('Electron'));

// ── Gyro HUD ──
const gyroHud = document.getElementById('gyro-hud');
const arcNeedle = document.getElementById('arc-needle');
const arcBand = document.getElementById('arc-band');
const arcTicks = document.getElementById('arc-ticks');
const leanArrowLeft = document.getElementById('lean-arrow-left');
const leanArrowRight = document.getElementById('lean-arrow-right');
const calibHint = document.getElementById('calib-hint');
const GYRO_HUD_MAX_DEG = 40; // ±40° matches game's gyro sensitivity
let calibHintTimer = null;
let driftCheckAccum = 0;
let driftCheckLastLean = 0;
const _hudEuler = new THREE.Euler();

// Build the static arc band and tick marks
function initGyroHud() {
  const R = 100; // arc radius in SVG units
  const bandW = 10;
  const maxRad = GYRO_HUD_MAX_DEG * Math.PI / 180;

  // Arc band path (circular arc from -maxDeg to +maxDeg, opening downward)
  const steps = 40;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const a = -maxRad + (2 * maxRad * i / steps);
    const x = Math.sin(a) * (R - bandW / 2);
    const y = -Math.cos(a) * (R - bandW / 2);
    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
  }
  for (let i = steps; i >= 0; i--) {
    const a = -maxRad + (2 * maxRad * i / steps);
    const x = Math.sin(a) * (R + bandW / 2);
    const y = -Math.cos(a) * (R + bandW / 2);
    d += 'L' + x.toFixed(2) + ',' + y.toFixed(2);
  }
  d += 'Z';
  arcBand.setAttribute('d', d);

  // Tick marks at 0%, ±25%, ±50%, ±75%, ±100%
  let ticksHtml = '';
  for (const pct of [0, 0.25, 0.5, 0.75, 1.0]) {
    for (const sign of (pct === 0 ? [1] : [-1, 1])) {
      const a = sign * pct * maxRad;
      const isMajor = pct === 0 || pct === 1.0;
      const inner = R - (isMajor ? 14 : 10);
      const outer = R + (isMajor ? 14 : 10);
      const x1 = Math.sin(a) * inner, y1 = -Math.cos(a) * inner;
      const x2 = Math.sin(a) * outer, y2 = -Math.cos(a) * outer;
      const sw = isMajor ? 1.2 : 0.6;
      const op = isMajor ? 0.5 : 0.25;
      ticksHtml += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke-width="${sw}" opacity="${op}"/>`;
    }
  }
  arcTicks.innerHTML = ticksHtml;

  // Degree labels at 0 / ±20 / ±40, just inside the arc band. Colored and
  // dimmed together with the band + ticks via the --roll-label-* CSS vars
  // (see applyRollLabelStyle / index.html #arc-labels styling).
  const arcLabels = document.getElementById('arc-labels');
  if (arcLabels) {
    const Rlabel = 80;
    let labelsHtml = '';
    for (const pct of [0, 0.5, 1.0]) {
      for (const sign of (pct === 0 ? [1] : [-1, 1])) {
        const a = sign * pct * maxRad;
        const lx = (Math.sin(a) * Rlabel).toFixed(2);
        const ly = (-Math.cos(a) * Rlabel).toFixed(2);
        const deg = Math.round(pct * GYRO_HUD_MAX_DEG);
        labelsHtml += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" font-size="11">${deg}</text>`;
      }
    }
    arcLabels.innerHTML = labelsHtml;
  }
}

// Color (= Roll "Normal" lean color) and brightness for the Roll HUD's static
// markings — arc band, tick marks, and degree labels — driven by CSS vars on
// #gyro-hud. The needle/arrows stay lean-banded; only the gauge furniture is
// styled here. rollLabelBright is a 0–1 opacity multiplier.
const _rlbSaved = localStorage.getItem('overlay:rollLabelBrightness');
let rollLabelBright = _rlbSaved !== null ? parseInt(_rlbSaved, 10) / 100 : 1;
function applyRollLabelStyle() {
  if (!gyroHud) return;
  gyroHud.style.setProperty('--roll-label-color', leanColors.normal);
  gyroHud.style.setProperty('--roll-label-bright', String(rollLabelBright));
}

// Lean-band colors (Normal / Mid / High) — by how far the value is from center.
// Drives the Roll HUD needle/labels. Defaults: white / orange / red.
const leanColors = {
  normal: localStorage.getItem('overlay:leanColorNormal') || '#ffffff',
  mid:    localStorage.getItem('overlay:leanColorMid')    || '#ffaa22',
  high:   localStorage.getItem('overlay:leanColorHigh')   || '#ff4444',
};
function leanColor(t) {
  const abs = Math.min(1, Math.abs(t));
  if (abs < 0.5) return leanColors.normal;
  if (abs < 0.75) return leanColors.mid;
  return leanColors.high;
}

// Per-axis (Pitch / Roll / Yaw) colors — drive the readout (via CSS vars) and
// the detached Axis window (forwarded). Defaults match the CSS fallbacks.
const axisColors = {
  pitch: localStorage.getItem('overlay:axisColorPitch') || '#44dd66',
  roll:  localStorage.getItem('overlay:axisColorRoll')  || '#ee4455',
  yaw:   localStorage.getItem('overlay:axisColorYaw')   || '#4488ff',
};

// ── Button HUD update ──
// Cached DOM refs so the per-frame update doesn't query the DOM repeatedly.
// Built lazily on first call so the script doesn't crash if the HUD markup
// is missing for any reason.
let _bhRefs = null;

/**
 * Apply the active profile's hudLabels to the in-overlay button HUD so the
 * labels match the physical controller (Sony shows ✕○□△, Nintendo's
 * standard-mapped order shows B/A/Y/X, Xbox-style shows A/B/X/Y, etc.).
 * Falls back to whatever was last in the markup if the profile has no
 * hudLabels — keeps the default ABXY readout for any profile that hasn't
 * declared per-vendor glyphs yet.
 */
function applyHudLabels(profileKey) {
  const profile = PROFILES[profileKey];
  // Forward profile to the detached HUD windows regardless of whether this
  // profile has hudLabels — they use the profile name + fall back to defaults
  // too. The IPC handler in main is a no-op when no window is open.
  if (window.electronAPI?.updateHudProfile) {
    window.electronAPI.updateHudProfile(profileKey);
  }
  if (!profile?.hudLabels) return;
  const labels = profile.hudLabels;
  // Buttons: data-btn elements get their textContent swapped to the
  // profile's label for that gamepad index.
  document.querySelectorAll('#button-hud [data-btn]').forEach(el => {
    const idx = Number(el.getAttribute('data-btn'));
    if (labels[idx] !== undefined) el.textContent = labels[idx];
  });
  // Show the back-paddle row in the HUD only for controllers that map them
  // (buttonMap slots 18-21, e.g. the Steam Controller).
  document.body.classList.toggle('has-paddles', profile.buttonMap?.[18] !== undefined);
  // Trigger labels live inside the trigger fill containers.
  const l2Label = document.querySelector('#button-hud [data-trigger="l2"] .bh-trigger-label');
  const r2Label = document.querySelector('#button-hud [data-trigger="r2"] .bh-trigger-label');
  if (l2Label && labels[6] !== undefined) l2Label.textContent = labels[6];
  if (r2Label && labels[7] !== undefined) r2Label.textContent = labels[7];
}
function _getButtonHudRefs() {
  if (_bhRefs) return _bhRefs;
  const buttons = {};
  document.querySelectorAll('#button-hud [data-btn]').forEach(el => {
    buttons[Number(el.getAttribute('data-btn'))] = el;
  });
  const triggers = {
    l2: { wrap: document.querySelector('#button-hud [data-trigger="l2"]'),
          fill: document.querySelector('#button-hud [data-trigger="l2"] .bh-trigger-fill') },
    r2: { wrap: document.querySelector('#button-hud [data-trigger="r2"]'),
          fill: document.querySelector('#button-hud [data-trigger="r2"] .bh-trigger-fill') },
  };
  const sticks = {
    l: { wrap: document.querySelector('#button-hud [data-stick="l"]'),
         dot:  document.querySelector('#button-hud [data-stick="l"] .bh-stick-dot'),
         line: document.querySelector('#button-hud [data-stick="l"] .bh-stick-line') },
    r: { wrap: document.querySelector('#button-hud [data-stick="r"]'),
         dot:  document.querySelector('#button-hud [data-stick="r"] .bh-stick-dot'),
         line: document.querySelector('#button-hud [data-stick="r"] .bh-stick-line') },
  };
  _bhRefs = { buttons, triggers, sticks };
  return _bhRefs;
}

/**
 * Update the 2D button HUD from a gamepad snapshot. Cheap: ~30 class
 * toggles + 4 style writes per frame. Skips entirely if the HUD is hidden
 * (animation loop guards on body.show-button-hud).
 *
 * Conventions are Gamepad-API-standard:
 *   buttons 0-3   → face buttons (A/B/X/Y)
 *   buttons 4-5   → L1/R1 (digital shoulders)
 *   buttons 6-7   → L2/R2 (digital backstop; analog comes from .value)
 *   buttons 8-9   → Share/Options (Select/Start equivalents)
 *   buttons 10-11 → L3/R3 (stick clicks)
 *   buttons 12-15 → dpad up/down/left/right
 *   buttons 16-17 → PS/Touchpad (or Home/Capture etc. depending on pad)
 *   axes 0/1, 2/3 → left/right stick X/Y, range [-1, 1]
 */
function updateButtonHud(gamepad) {
  const refs = _getButtonHudRefs();
  if (!refs) return;

  const buttons = gamepad?.buttons || [];
  for (const [idx, el] of Object.entries(refs.buttons)) {
    const pressed = !!buttons[idx]?.pressed;
    if (el.classList.contains('pressed') !== pressed) {
      el.classList.toggle('pressed', pressed);
    }
  }
  // Analog triggers: scale the fill height from the .value (already 0-1).
  const l2v = buttons[6]?.value || 0;
  const r2v = buttons[7]?.value || 0;
  if (refs.triggers.l2.fill) refs.triggers.l2.fill.style.height = (l2v * 100) + '%';
  if (refs.triggers.r2.fill) refs.triggers.r2.fill.style.height = (r2v * 100) + '%';
  // Sticks: position the dot at (axis * radius). Radius is half the stick
  // box minus the dot half-size, expressed as a percentage offset from
  // center (translate -50% + axis*PCT). axisY in Gamepad-API is "up = -1"
  // so we negate to make "up = dot up" visually intuitive.
  const axes = gamepad?.axes || [0, 0, 0, 0];
  const STICK_RADIUS_PCT = 40;
  const placeStick = (s, ax, ay) => {
    const x = (ax || 0) * STICK_RADIUS_PCT;
    const y = (ay || 0) * STICK_RADIUS_PCT;
    if (s.dot) s.dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    // Thin line from the stick center to the dot.
    if (s.line) {
      const len = Math.hypot(x, y);
      const ang = Math.atan2(y, x) * 180 / Math.PI;
      s.line.style.width = len + 'px';
      s.line.style.transform = `rotate(${ang}deg)`;
    }
  };
  placeStick(refs.sticks.l, axes[0], axes[1]);
  placeStick(refs.sticks.r, axes[2], axes[3]);
  // L3 / R3 clicks light up the stick border (separate from button 10/11
  // which already get mapped above — that's the bh-btn variant; the stick
  // wrapper just gets the same .pressed class for the border glow).
  if (refs.sticks.l.wrap) refs.sticks.l.wrap.classList.toggle('pressed', !!buttons[10]?.pressed);
  if (refs.sticks.r.wrap) refs.sticks.r.wrap.classList.toggle('pressed', !!buttons[11]?.pressed);
}

function updateGyroHud(leanDeg) {
  if (!gyroHud.classList.contains('visible')) return;

  const t = Math.max(-1, Math.min(1, leanDeg / GYRO_HUD_MAX_DEG)); // -1 to 1
  const absT = Math.abs(t);
  const R = 100;
  const maxRad = GYRO_HUD_MAX_DEG * Math.PI / 180;

  // Needle rotation
  const needleAngle = t * maxRad;
  const nx1 = Math.sin(needleAngle) * 4, ny1 = -Math.cos(needleAngle) * 4;
  const nx2 = Math.sin(needleAngle) * 22, ny2 = -Math.cos(needleAngle) * 22;
  // Use line from near-center to arc
  const nx2f = Math.sin(needleAngle) * (R - 2);
  const ny2f = -Math.cos(needleAngle) * (R - 2);
  arcNeedle.setAttribute('x1', nx1.toFixed(2));
  arcNeedle.setAttribute('y1', ny1.toFixed(2));
  arcNeedle.setAttribute('x2', nx2f.toFixed(2));
  arcNeedle.setAttribute('y2', ny2f.toFixed(2));
  const color = leanColor(t);
  arcNeedle.setAttribute('stroke', color);

  // Arrows + calibration text match needle color
  calibHint.style.color = color;
  leanArrowLeft.style.opacity = t < -0.05 ? Math.min(1, absT * 1.5) : 0.1;
  leanArrowLeft.style.color = t < -0.05 ? color : '#888';
  leanArrowRight.style.opacity = t > 0.05 ? Math.min(1, absT * 1.5) : 0.1;
  leanArrowRight.style.color = t > 0.05 ? color : '#888';
}

function showGyroHud() {
  gyroHud.classList.add('visible');
  applyHudPosition();
}
function hideGyroHud() { gyroHud.classList.remove('visible'); }

function applyHudPosition() {
  const pos = document.getElementById('hud-position')?.value || 'above';
  gyroHud.classList.remove('pos-above', 'pos-below');
  gyroHud.classList.add('pos-' + pos);
}

function showCalibHint(text, duration) {
  calibHint.textContent = text;
  calibHint.classList.remove('hidden');
  if (calibHintTimer) clearTimeout(calibHintTimer);
  if (duration) {
    calibHintTimer = setTimeout(() => {
      calibHint.classList.add('hidden');
      calibHintTimer = null;
    }, duration);
  }
}

function hideCalibHint() {
  calibHint.classList.add('hidden');
  if (calibHintTimer) { clearTimeout(calibHintTimer); calibHintTimer = null; }
}

initGyroHud();
applyRollLabelStyle();
applyHudPosition();

// In browser (not Electron), set a light background since transparency isn't available
if (!isDesktop) {
  document.body.style.background = '#1a1a2e';
}

// ── Initialize ──
async function init() {
  // Detect what's connected — if nothing, don't load a model yet
  const initialType = detectInitialController();
  const hasGamepad = initialType !== null;

  overlay = new ControllerOverlay({
    canvas,
    transparent: true,
    controllerType: hasGamepad ? initialType : 'dualsense',
  });
  await overlay.init();

  // Re-apply a saved highlight color to the freshly-created 3D overlay. The
  // one picker drives BOTH the press/tilt glow (#45) and the grip-sense glow
  // (#49) so they stay in sync. (The 2D HUD picks the color up from the CSS
  // var set during settings wiring.)
  const savedHighlight = localStorage.getItem('overlay:highlightColor');
  if (savedHighlight) {
    if (overlay.setPressColor) overlay.setPressColor(savedHighlight);
    if (overlay.setGripColor) overlay.setGripColor(savedHighlight);
  }

  // Apply the model opacity (slider default 98%) to the freshly-loaded model.
  if (overlay.setOpacity) {
    const op = document.getElementById('opacity-slider');
    overlay.setOpacity((op ? parseInt(op.value, 10) : 98) / 100);
  }

  // Apply the "Float Controls" preference (default ON) to the new model.
  if (overlay.setFloatParts) {
    overlay.setFloatParts(localStorage.getItem('overlay:floatControls') !== '0');
  }

  // Apply saved grip-sense display preferences.
  if (overlay.setGripVisible) overlay.setGripVisible(gripVizEnabled);
  if (overlay.setGripBarsVisible) overlay.setGripBarsVisible(gripBarsVisible);
  if (overlay.setGripGlowWidth) overlay.setGripGlowWidth(gripGlowWidth);
  if (overlay.setGripGlowLength) overlay.setGripGlowLength(gripGlowLength);
  const _gripColor = localStorage.getItem('overlay:gripColor');
  if (_gripColor && overlay.setGripColor) overlay.setGripColor(_gripColor); // override after highlight
  const _gripB = localStorage.getItem('overlay:gripBrightness');
  if (_gripB !== null && overlay.setGripBrightness) overlay.setGripBrightness(parseInt(_gripB, 10) / 100);

  // ── Layout editor (#51) ──
  // Provider auto-applies each controller's saved layout whenever its model
  // (re)loads; change handler persists edits; select handler updates the UI.
  if (overlay.setLayoutProvider) {
    overlay.setLayoutProvider((type) => {
      try { return JSON.parse(localStorage.getItem('overlay:partLayout:' + type) || 'null'); }
      catch { return null; }
    });
    overlay.setLayoutChangeHandler((layout) => {
      localStorage.setItem('overlay:partLayout:' + currentControllerType, JSON.stringify(layout));
      // Keep the numeric editor in sync while the user drags or nudges with keys.
      refreshLayoutNumeric();
    });
    overlay.setSelectHandler(onEditSelectionChange);
    overlay.setLayoutMode(localStorage.getItem('overlay:layoutMode') || 'relative');
    // Re-apply now in case the model loaded before the provider was registered.
    const _savedLayout = overlay._layoutProvider?.(currentControllerType);
    if (_savedLayout) overlay.applyLayout(_savedLayout);
  }

  if (hasGamepad) {
    currentControllerType = initialType;
    modelReady = true;
    noControllerSplash.classList.add('hidden');
  } else {
    // No gamepad — hide the 3D model, show splash
    overlay.setVisible(false);
    modelReady = false;
  }
  // Re-apply the saved camera preset (issue #70) now that the 3D overlay
  // exists — the module-level selectCameraPreset() ran before `overlay` was
  // created, so it only updated the button highlight, not the actual view.
  overlay.setCameraPreset(selectedCameraPreset);

  // Apply HUD labels for whatever the current profile resolved to, even
  // when no gamepad was detected at startup — the user might enable the
  // HUD before plugging in, and the labels should match the model's
  // controllerType default so they look consistent.
  applyHudLabels(currentControllerType);

  new ResizeObserver(() => {
    overlay.resize(canvas.clientWidth, canvas.clientHeight);
  }).observe(canvas);

  // Listen for HID device disconnects
  if (navigator.hid) {
    navigator.hid.addEventListener('disconnect', (e) => {
      if (hidDevice && e.device === hidDevice) {
        console.log('HID device disconnected');
        disconnectGyro();
      }
    });
  }

  // Pool EVERY granted HID device FIRST (single owner), so auto-adopt below just
  // DESIGNATES a live pool entry rather than opening its own — otherwise the
  // device gets opened twice (once at auto-connect, once by the pool) and the
  // list row points at a dead duplicate. (Was the USB DS4 "SELECTED but dead".)
  await initControllerList();
  initSerialInventory();

  // Start the last-used grace window (#104) now that the pool is populating.
  // Full wait only when we're actually waiting for a REMEMBERED pad to enumerate;
  // with nothing remembered there's nothing to wait for, so open the list sooner.
  _lastUsedDeadline = performance.now() + (_lastUsed ? LAST_USED_GRACE_MS : NO_PAD_GRACE_MS);

  requestAnimationFrame(loop);

  // Adopt an already-connected XInput pad at startup (Xbox has no HID interface,
  // so it can't be pool-adopted). HID controllers are NOT auto-selected at
  // startup — nothing is SELECTED until the user ENGAGES one (autoAdoptFromPool)
  // or clicks its row, so the "No Controller" splash stays until then.
  checkForExistingGamepad();
}

/**
 * Detect what controller is already connected at startup.
 */
// Cache of (vid:pid → profile key) populated by the IMU probe when it
// successfully identifies a wire-level family that disambiguates a
// spoofer from the entry that `identifyFromGamepadId` would pick by
// default. Without this cache, switchController re-fires (gamepad
// hot-plug, jitter, USB sleep/wake, etc.) would compute the gamepad-
// id-based default again and overwrite the IMU-determined choice —
// producing the GLB-flapping bug where the model bounces between
// 'dualsense' and 'gamesir-super-nova' indefinitely.
//
// Keyed by `"vendorIdHex:productIdHex"`. Cleared on disconnect so a
// fresh plug-in re-probes (lets the user swap to a real Sony DS4 on
// the same machine after testing a clone, etc.).
const imuLockedProfileByVidPid = new Map();

function vidPidKey(vendorId, productId) {
  return `${vendorId.toString(16).padStart(4, '0')}:${productId.toString(16).padStart(4, '0')}`;
}

// Resolve the visualizer profile key for a given gamepad. Order:
//   1. IMU-locked profile for this gamepad's vid:pid (set by
//      maybeSwapProfileAfterImuProbe after a successful wire-level
//      identification)
//   2. dictionary's `controllerProfile` field (first-match-wins via
//      identifyFromGamepadId)
//   3. visualizer's own gamepad.id pattern sniff
function pickControllerProfile(gamepadId) {
  const vp = ControllerRegistry.parseGamepadVendorProduct(gamepadId);
  if (vp) {
    const locked = imuLockedProfileByVidPid.get(vidPidKey(vp.vendorId, vp.productId));
    if (locked) return locked;
  }
  const info = ControllerRegistry.identifyFromGamepadId(gamepadId);
  return info?.controllerProfile || detectControllerType(gamepadId);
}

function detectInitialController() {
  const gamepads = navigator.getGamepads();
  for (let i = 0; i < gamepads.length; i++) {
    if (gamepads[i]) {
      const type = pickControllerProfile(gamepads[i].id);
      console.log('Initial controller detected:', type, '(' + gamepads[i].id + ')');
      return type;
    }
  }
  return null; // nothing connected
}

/**
 * Check for a gamepad that was connected before event listeners were set up.
 * Triggers the full switchController flow including gyro auto-connect.
 * @returns {boolean} true if a gamepad was found and claimed
 */
function checkForExistingGamepad() {
  const gamepads = navigator.getGamepads();
  for (let i = 0; i < gamepads.length; i++) {
    const gp = gamepads[i];
    if (!gp) continue;
    // Skip HID controllers — they're adopted from the pool only when engaged, so
    // an untouched pad never auto-selects. Only XInput pads (not in the pool)
    // are adopted at startup here.
    const vp = ControllerRegistry.parseGamepadVendorProduct(gp.id);
    if (vp && listManager._findPoolEntryByVidPid(vp.vendorId, vp.productId)) continue;
    console.log('Found existing XInput gamepad at startup:', gp.id);
    switchController(gp);
    return true;
  }
  return false;
}

/**
 * Cold-start fallback when the Gamepad API shows nothing: probe WebHID for
 * any previously-granted gyro-capable device and drive the overlay from its
 * HID reports. Synthesizes a Gamepad-shaped stub so switchController() can
 * run unchanged.
 */
async function bootstrapFromHID() {
  if (!navigator.hid) return;
  let devices;
  try {
    devices = await navigator.hid.getDevices();
  } catch (err) {
    console.log('bootstrapFromHID: getDevices failed:', err.message);
    return;
  }
  for (const d of devices) {
    const entry = ControllerRegistry.getEntry(d.vendorId, d.productId);
    if (!entry || !entry.capabilities.gyro) continue;
    console.log('bootstrapFromHID: found', d.productName,
      'vid:' + d.vendorId.toString(16), 'pid:' + d.productId.toString(16));
    const stub = {
      id: d.productName || entry.name,
      index: -1,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 22 }, () => ({ pressed: false, value: 0 })), // 0-17 standard + 18-21 back paddles (L4/L5/R4/R5)
    };
    await switchController(stub);
    // switchController() calls disconnectGyro() which nulls syntheticGamepad,
    // so seed it *after* — this gives readGamepad() neutral state to return
    // during the 2s window before HID reports start flowing.
    if (!syntheticGamepad) {
      syntheticGamepad = createSyntheticGamepad(d.productName);
    }
    return;
  }
  console.log('bootstrapFromHID: no granted gyro-capable device found');
}

// =====================================================================
// CONTROLLER LIFECYCLE
// =====================================================================

async function switchController(gamepad, preferredDevice = null) {
  if (switchingController) return;
  switchingController = true;
  _preferredGyroDevice = preferredDevice;   // bind THIS exact handle if given (list-selection)

  try {
    const newType = controllerTypeSelect.value === 'auto'
      ? pickControllerProfile(gamepad.id)
      : controllerTypeSelect.value;

    // Tear down gyro — physical device changed
    cancelGyroConnect();
    await disconnectGyro();

    // Load new model if type changed or first connection
    if (newType !== currentControllerType || !overlay.model) {
      modelReady = false;
      currentControllerType = newType;
      await overlay.setControllerType(newType);
      console.log('Controller model loaded:', newType);
    }
    // Always re-apply HUD labels on a switch — even when newType matches
    // currentControllerType (because the model was already loaded at init
    // with the same default), we still need to push labels through, since
    // startup may have called applyHudLabels with a null/default profile
    // before the real gamepad arrived. Cheap; idempotent.
    applyHudLabels(newType);

    // Always ensure model is ready and visible after switch
    modelReady = true;
    overlay.setVisible(true);
    noControllerSplash.classList.add('hidden');

    // Update UI
    // HID-selection stub uses -1 → buttons from the synthetic. AND: if two pads
    // share this vid:pid (a GameSir + a real DS4, both 054c:05c4) we can't trust
    // the pad index to be OUR device, so drop to null and drive from the
    // connected HID handle's synthetic — otherwise pressing one lights both rows.
    const _vpG = ControllerRegistry.parseGamepadVendorProduct(gamepad.id);
    const _dupPads = _vpG ? (navigator.getGamepads() || []).filter((g) => {
      if (!g) return false; const v = ControllerRegistry.parseGamepadVendorProduct(g.id);
      return v && v.vendorId === _vpG.vendorId && v.productId === _vpG.productId;
    }).length : 1;
    gamepadIndex = (gamepad.index >= 0 && _dupPads <= 1) ? gamepad.index : null;
    gamepadStatusEl.textContent = gamepad.id.slice(0, 30);
    gamepadStatusEl.classList.add('connected');

    // Show gyro toggle and auto-connect if controller supports gyro
    const info = ControllerRegistry.identifyFromGamepadId(gamepad.id);
    // An explicit list-selection ALWAYS connects the chosen handle (so it
    // becomes SELECTED); otherwise auto-connect only for gyro-capable pads.
    if (navigator.hid && (preferredDevice || info?.hasGyro)) {
      showGyroToggle();
      // Always auto-connect gyro — in Electron requestDevice() auto-approves,
      // in browsers it will fail silently and the user can click the button.
      scheduleGyroConnect();
    } else {
      hideGyroToggle();
    }
  } catch (err) {
    console.error('Controller switch failed:', err);
    modelReady = true;
  } finally {
    switchingController = false;
  }
}

function onGamepadDisconnected(index) {
  if (index !== gamepadIndex) return;
  gamepadIndex = null;
  gamepadStatusEl.textContent = 'No gamepad';
  gamepadStatusEl.classList.remove('connected');
  // Clear the IMU-lock cache for whatever was attached so the next pad
  // re-probes from scratch (lets a real Sony DS4 replace a GameSir test
  // on the same vid:pid without inheriting the clone's profile).
  if (hidDevice) {
    imuLockedProfileByVidPid.delete(vidPidKey(hidDevice.vendorId, hidDevice.productId));
  }
  cancelGyroConnect();
  disconnectGyro();
  hideGyroToggle();

  // Show the no-controller splash and hide the 3D model
  noControllerSplash.classList.remove('hidden');
  overlay.setVisible(false);
}

// ── Last-used controller default (issue #104) ─────────────────────────────
// Persist the last SELECTED pad's identity so the next launch can auto-select
// it. Baseline identity is vid:pid (the browser can't see a per-unit serial —
// an Electron serial refinement is a follow-up). On launch the remembered pad
// gets a grace window to enumerate (BT/wireless are slow) before we fall back
// to opening the AVAILABLE list.
const LAST_USED_GRACE_MS = 6000;  // wait for a REMEMBERED pad to enumerate (BT/wireless is slow)
const NO_PAD_GRACE_MS = 2000;     // nothing remembered: a brief beat to press a pad, else open the list
function readLastUsed() {
  try { return JSON.parse(localStorage.getItem('overlay:lastController') || 'null'); }
  catch { return null; }
}
let _lastUsed = readLastUsed();
let _lastUsedDeadline = 0;           // set in init: performance.now() + grace
let _lastUsedFallbackDone = false;
function rememberLastUsed(device) {
  if (!device) return;
  _lastUsed = { v: device.vendorId, p: device.productId, name: device.productName || '' };
  try { localStorage.setItem('overlay:lastController', JSON.stringify(_lastUsed)); } catch { /* ignore */ }
}
function matchesLastUsed(device) {
  return !!(_lastUsed && device && device.vendorId === _lastUsed.v && device.productId === _lastUsed.p);
}

// Input-driven auto-adopt from the WebHID pool: when NOTHING is SELECTED,
// designate the controller the user has actually ENGAGED (a pool entry that has
// been pressed), else the first receiving gyro-capable entry. This is the ONLY
// auto-SELECT path for HID controllers — so a controller's Gamepad-API pad merely
// CONNECTING (e.g. a Switch Pro BT pad appearing a second after boot) never
// auto-selects an untouched controller. Pressing a controller makes it ACTIVE,
// not SELECTED; SELECTED only changes at startup, on disconnect re-adopt, or by
// explicit list-click. Runs each frame from the loop while nothing is selected.
function autoAdoptFromPool() {
  if (hidDevice || _preferredGyroDevice || switchingController) return;
  const pool = [...listManager._hidPool.values()];
  const gyroable = (e) => { const en = ControllerRegistry.getEntry(e.device.vendorId, e.device.productId); return !!(en && en.capabilities.gyro); };
  // ONLY adopt a controller the user has actually ENGAGED (pressed a button on).
  // An untouched controller — however it connects — must never auto-SELECT; the
  // user picks it by pressing it or clicking its row. This is what stopped the
  // idle Switch Pro from grabbing SELECTED after a DS4 press.
  const entry = pool.find((e) => e._everPressed && gyroable(e) && e.hidActiveSince > 0);
  if (!entry) return;
  const d = entry.device, hx = (n) => n.toString(16).padStart(4, '0');
  const stub = { id: `${d.productName || 'Controller'} (STANDARD GAMEPAD Vendor: ${hx(d.vendorId)} Product: ${hx(d.productId)})`,
    index: -1, axes: [0, 0, 0, 0], buttons: Array.from({ length: 22 }, () => ({ pressed: false, value: 0 })) };
  switchController(stub, d);
}

// Launch default (issue #104): within a grace window after boot, auto-SELECT the
// last-used controller as soon as it's RECEIVING — no button press required
// (this relaxes the input-driven policy ONLY for the remembered pad). A real
// press on any pad still wins, because press-based autoAdoptFromPool runs first
// in the loop and sets hidDevice before this. After the window, if the pad never
// showed, open the AVAILABLE list so the user can pick.
function tryAdoptLastUsed(now) {
  if (hidDevice || _preferredGyroDevice || switchingController) return;
  if (now <= _lastUsedDeadline) {
    // Within the grace window: adopt the remembered pad the moment it's receiving.
    // No remembered pad yet (first run) → nothing to match; keep waiting out the
    // window (which also lets the user press a controller to select it first).
    if (!_lastUsed) return;
    const entry = [...listManager._hidPool.values()].find(
      (e) => e.hidActiveSince > 0 && matchesLastUsed(e.device));
    if (!entry) return;                       // remembered pad not up yet — keep waiting
    const d = entry.device, hx = (n) => n.toString(16).padStart(4, '0');
    const stub = { id: `${d.productName || 'Controller'} (STANDARD GAMEPAD Vendor: ${hx(d.vendorId)} Product: ${hx(d.productId)})`,
      index: -1, axes: [0, 0, 0, 0], buttons: Array.from({ length: 22 }, () => ({ pressed: false, value: 0 })) };
    console.log('[last-used] auto-selecting remembered controller', d.productName || `${hx(d.vendorId)}:${hx(d.productId)}`);
    switchController(stub, d);
  } else if (!_lastUsedFallbackDone) {
    // Grace expired with nothing SELECTED → open the AVAILABLE list so the user can
    // pick, whether or not a pad was remembered. The No-Controller splash stays.
    _lastUsedFallbackDone = true;
    console.log('[last-used] nothing selected after grace — opening the controllers list');
    try { window.electronAPI?.openHudWindow?.('controllers', currentControllerType, { on: false }); } catch { /* no-op */ }
  }
}

// ── Gamepad events ──

window.addEventListener('gamepadconnected', (e) => {
  if (hidDevice || gyroActive || switchingController || _preferredGyroDevice) return;
  // A HID controller is adopted via the POOL (autoAdoptFromPool), NOT its
  // Gamepad-API pad connecting — otherwise a Switch Pro BT pad appearing a second
  // after boot would auto-select an untouched controller. Only XInput pads (Xbox,
  // no HID interface, so not in the pool) are adopted through the Gamepad API.
  const vp = ControllerRegistry.parseGamepadVendorProduct(e.gamepad.id);
  if (vp && listManager._findPoolEntryByVidPid(vp.vendorId, vp.productId)) return;
  switchController(e.gamepad);
});

window.addEventListener('gamepaddisconnected', (e) => {
  onGamepadDisconnected(e.gamepad.index);
});

// =====================================================================
// GYRO TOGGLE UI
// =====================================================================

function showGyroToggle() {
  gyroToggleBtn.classList.add('visible');
  // Shift status bar left to make room
  const statusBar = document.getElementById('status-bar');
  if (statusBar) statusBar.style.right = '78px';
}

function hideGyroToggle() {
  gyroToggleBtn.classList.remove('visible', 'active', 'inactive');
  const statusBar = document.getElementById('status-bar');
  if (statusBar) statusBar.style.right = '42px';
}

function updateGyroToggle() {
  const indicator = gyroToggleBtn.querySelector('.gyro-indicator');
  if (gyroActive) {
    gyroToggleBtn.title = 'Gyro: ON (click to disable)';
    if (indicator) indicator.textContent = '\u2705'; // green checkmark
  } else {
    gyroToggleBtn.title = 'Gyro: OFF (click to enable)';
    if (indicator) indicator.textContent = '\u274C'; // red X
  }
}

gyroToggleBtn.addEventListener('click', () => toggleGyro());

// =====================================================================
// GYRO CONNECTION
// =====================================================================

/**
 * Schedule gyro auto-connect after delay (desktop only).
 */
function scheduleGyroConnect() {
  cancelGyroConnect();
  // 2s for auto-connect (Switch Pro needs USB-enumeration + HID readiness time).
  // An explicit list-selection targets an ALREADY-open pooled handle, so connect
  // it promptly — the 2s wait made selection feel broken.
  const delay = _preferredGyroDevice ? 150 : 2000;
  gyroConnectTimer = setTimeout(async () => {
    gyroConnectTimer = null;
    // Bail only when there's nothing to connect. An explicit list-selection of a
    // HID-only pad (Steam, DualSense-BT) or an identical-vid:pid pad has
    // gamepadIndex===null but DOES set _preferredGyroDevice — that must still
    // connect (else it goes ACTIVE-not-SELECTED and needs a manual Connect click).
    if (gamepadIndex === null && !_preferredGyroDevice) return;
    if (gyroActive) return;
    console.log('Auto-connecting gyro for', currentControllerType, '...');
    try {
      await connectControllerGyro();
      if (gyroActive) {
        console.log('Gyro auto-connected successfully');
      } else {
        console.log('Gyro auto-connect: no device found — click gyro button to retry');
      }
    } catch (err) {
      console.warn('Gyro auto-connect failed:', err.message);
    }
  }, delay);
}

function cancelGyroConnect() {
  if (gyroConnectTimer) {
    clearTimeout(gyroConnectTimer);
    gyroConnectTimer = null;
  }
}

/**
 * Connect to controller gyro via WebHID.
 *
 * Step 1: getDevices() — returns devices from prior requestDevice() sessions.
 *         Works without user gesture. Fast.
 * Step 2: requestDevice() — triggers Electron's select-hid-device handler
 *         which auto-approves. Also works in browsers with user gesture.
 */
async function connectControllerGyro() {
  if (hidDevice && gyroActive) return;
  if (!navigator.hid) return;

  const filters = ControllerRegistry.getHIDFilters();
  // An explicit list-selection targets THIS exact HID handle (so two identical
  // vid:pid pads don't collide). Consumed once.
  let device = _preferredGyroDevice;
  _preferredGyroDevice = null;
  if (device) { await finishGyroConnect(device); return; }

  // Match the gyro HID device to the ACTIVE gamepad's vid:pid. Without this,
  // with two controllers connected we'd grab the first gyro-capable granted
  // device (e.g. a Steam Controller) and show ITS gyro under THIS controller's
  // buttons — the exact cross-wire seen with a GameSir + Steam Controller.
  let wantVp = null;
  if (gamepadIndex !== null) {
    const gp = navigator.getGamepads()[gamepadIndex];
    if (gp) wantVp = ControllerRegistry.parseGamepadVendorProduct(gp.id);
  }

  // Step 1: check previously-granted devices
  console.log('connectControllerGyro: trying getDevices()...', wantVp ? `(prefer ${wantVp.vendorId.toString(16)}:${wantVp.productId.toString(16)})` : '');
  try {
    const granted = await navigator.hid.getDevices();
    console.log('connectControllerGyro: getDevices returned', granted.length, 'device(s)');
    const gyroable = (d) => { const e = ControllerRegistry.getEntry(d.vendorId, d.productId); return !!(e && e.capabilities.gyro); };
    // Prefer the handle matching the active gamepad; fall back to the first
    // gyro-capable device (single-controller case, unchanged).
    if (wantVp) device = granted.find((d) => d.vendorId === wantVp.vendorId && d.productId === wantVp.productId && gyroable(d));
    if (!device) device = granted.find(gyroable);
    if (device) console.log('connectControllerGyro: found granted device:', device.productName);
  } catch (err) {
    console.log('connectControllerGyro: getDevices failed:', err.message);
  }

  // Step 2: requestDevice() if no granted device
  if (!device) {
    console.log('connectControllerGyro: trying requestDevice()...');
    try {
      const devices = await navigator.hid.requestDevice({ filters });
      console.log('connectControllerGyro: requestDevice returned', devices?.length || 0, 'device(s)');
      device = devices && devices[0];
    } catch (err) {
      console.log('connectControllerGyro: requestDevice failed:', err.message);
    }
  }

  if (!device) {
    console.log('connectControllerGyro: no device found');
    return;
  }
  await finishGyroConnect(device);
}

// Connect a SPECIFIC HID device as the overlay's active gyro/button source.
// Shared by the auto-connect path and explicit list-selection (which sets
// _preferredGyroDevice so two identical vid:pid pads don't collide).
// Phase 3b: the device is ALREADY pooled and driven by the manager (driver,
// fusion, synthetic all live). "Connecting" now just DESIGNATES that pool entry
// as the one the overlay shows — no second connection, no eviction, no separate
// inputreport listener, no app-layer calibration (the entry's fusion self-
// calibrates). Kept the name/signature so callers (auto-connect, selection) are
// unchanged.
async function finishGyroConnect(device) {
  const forVp = (e) => e.device.vendorId === device.vendorId && e.device.productId === device.productId;
  const pool = () => [...listManager._hidPool.values()];
  // Prefer the EXACT pooled handle. A getDevices() handle can be a DIFFERENT JS
  // object than the pooled one for the SAME physical device — do NOT re-pool it,
  // that double-opens the device and yields a dead duplicate entry (the "USB DS4
  // SELECTED but dead" bug). Fall back to a same-vid:pid entry that's actually
  // RECEIVING parsed reports (hidActiveSince > 0 — a wire-level fact, NOT the
  // user-facing ACTIVE state, which means the user has interacted with it).
  let entry = pool().find((e) => e.device === device)
           || pool().filter(forVp).find((e) => e.hidActiveSince > 0)
           || pool().find(forVp);
  if (!entry) {
    // Genuinely not pooled (e.g. a freshly-granted device) — pool once, then take it.
    try { await listManager.poolDevice(device); } catch (e) { /* ok */ }
    entry = pool().find((e) => e.device === device) || pool().find(forVp);
  }
  if (!entry) { console.warn('finishGyroConnect: no pool entry for', device.productName); return; }

  // Steam Controller Puck: the picked handle may be a sibling that never emits
  // STATE reports — designate the same-vid:pid interface that IS receiving them.
  if (entry.driver?.constructor?.needsSiblingFanout) {
    const rx = pool().filter((e) => forVp(e) && e.hidActiveSince > 0);
    if (rx.length) entry = rx[0];
  }

  designateEntry(entry);
  console.log('[designate]', entry.device.productName || (entry.device.vendorId.toString(16) + ':' + entry.device.productId.toString(16)),
    (entry.driver && entry.driver.connectionType), 'receiving=' + (entry.hidActiveSince > 0));
}

// Point the overlay's viz at a pool entry: alias hidDevice/controllerDriver/
// syntheticGamepad/gyroFusion to it, apply the overlay's gravity/yaw prefs to
// its fusion, and run the post-connect hooks. The manager keeps feeding it.
// Show/hide the opt-in LIVE badge (#104): visible only when a controller is
// SELECTED (hidDevice set) AND the user has enabled the badge setting.
function updateLiveBadge() {
  if (!liveBadge) return;
  if (showBadge && hidDevice) {
    const vp = { vendorId: hidDevice.vendorId, productId: hidDevice.productId };
    liveBadgeName.textContent = _ctrlName(vp, hidDevice.productName || 'Controller');
    liveBadge.classList.remove('hidden');
  } else {
    liveBadge.classList.add('hidden');
  }
}

function designateEntry(entry) {
  selectedEntry = entry;
  hidDevice = entry.device;
  controllerDriver = entry.driver;
  syntheticGamepad = entry.synthetic;
  gyroFusion = entry.fusion;
  gyroFusion.gravityMode = GRAVITY_MODES[gravityMode] || 0;
  gyroFusion.yawReturnHalfLife = YAW_RETURN_MODES[yawReturnMode] ?? 0;
  gyroActive = true;
  gyroPermitted = true;
  connectGyroBtn.textContent = 'Connected';
  updateGyroToggle();
  showGyroHud();
  // The entry's fusion has been integrating since it was POOLED (boot), so its
  // orientation carries accumulated drift and its bias was calibrated whenever
  // the pad happened to be still (or not) during pooling. Reset the orientation
  // for a clean start and re-run the one-shot bias calibration NOW (on selection,
  // when the pad is usually at rest) for a tight window — matching the old
  // connect-time behavior. Continuous stillness + manual L3+R4 refine from there.
  gyroFusion.reset();
  startCalibration();
  if (isPuckDevice(hidDevice)) onPuckConnected();
  else onPuckDisconnected();
  maybeSwapProfileAfterImuProbe();
  rememberLastUsed(entry.device); // #104: this pad becomes the launch default
  updateLiveBadge();
}

// Stop showing the current controller (device stays pooled + live). Used on
// disconnect / before switching. Falls back to the neutral idle fusion.
function undesignateEntry() {
  selectedEntry = null;
  hidDevice = null;
  controllerDriver = null;
  syntheticGamepad = null;
  gyroFusion = _idleFusion;
  hidExtraDevices = [];
  gyroActive = false;
  gyroPermitted = false;
  onPuckDisconnected();
  updateLiveBadge();
}

/**
 * Consult the driver's runtime-detected IMU family and swap the overlay
 * profile to the family-matched entry's controllerProfile when the auto-
 * detection disagrees with whatever profile we loaded from gamepad.id.
 * Skips the swap if the user has set the controller-type dropdown to a
 * specific (non-'auto') profile — manual override wins.
 */
function maybeSwapProfileAfterImuProbe() {
  const family = controllerDriver?._detectedImuFamily;
  if (!family || !hidDevice) return;
  if (controllerTypeSelect.value && controllerTypeSelect.value !== 'auto') return;

  const candidates = ControllerRegistry.getEntriesByImuFamily(
    hidDevice.vendorId, hidDevice.productId, family
  );
  if (candidates.length === 0) return;
  // Pick the first entry for the matched family. When two share a family
  // (e.g. Super Nova and Cyclone 2 both at offset 12), the user can still
  // override via the dropdown — a future spoof picker would disambiguate
  // here without a manual trip into settings.
  const picked = candidates[0];
  const desiredProfile = picked.controllerProfile || picked.protocol;
  // Lock this vid:pid → profile so any future switchController re-fire
  // for the same physical device uses the IMU-determined choice instead
  // of falling back to the gamepad.id first-match.
  imuLockedProfileByVidPid.set(
    vidPidKey(hidDevice.vendorId, hidDevice.productId),
    desiredProfile
  );
  if (desiredProfile !== currentControllerType && overlay) {
    console.log(`IMU probe wants profile '${desiredProfile}' (entry: ${picked.name}); currently '${currentControllerType}' — swapping + locking ${vidPidKey(hidDevice.vendorId, hidDevice.productId)}.`);
    currentControllerType = desiredProfile;
    applyHudLabels(desiredProfile);
    overlay.setControllerType(desiredProfile);
  } else {
    console.log(`IMU probe profile '${desiredProfile}' already active; locking ${vidPidKey(hidDevice.vendorId, hidDevice.productId)} for future switchController re-fires.`);
  }
}

/**
 * Disconnect gyro and reset state.
 */
async function disconnectGyro() {
  // Phase 3b: the device stays pooled + live (manager owns it) — we just stop
  // showing it. NEVER reset the entry's fusion here (the manager keeps using it);
  // undesignateEntry points gyroFusion back at the neutral _idleFusion first.
  undesignateEntry();
  _firstReportLogged = false;
  _idleFusion.reset();
  _idleFusion.resetBias();
  calibrating = false;
  calibSamples = [];
  calibRetries = 0;
  connectGyroBtn.textContent = 'Connect';
  updateGyroToggle();
  hideGyroHud();
  hideCalibHint();
}

// ── Main loop ──

// ── Controllers list render (Phase 1: read-only list + live dots) ──
function _padActive(gp) {
  if (!gp) return false;
  for (const b of (gp.buttons || [])) if (b && (b.pressed || (b.value || 0) > 0.5)) return true;
  for (const a of (gp.axes || [])) if (Math.abs(a) > 0.5) return true;
  return false;
}
function _vpStr(vp) { return vp ? ((vp.vendorId || 0).toString(16).padStart(4, '0') + ':' + (vp.productId || 0).toString(16).padStart(4, '0')) : '—'; }
function _ctrlName(vp, fallback) {
  if (vp) { const e = ControllerRegistry.getEntry(vp.vendorId, vp.productId); if (e && e.name) return e.name; }
  return fallback || 'Controller';
}
// Three states: SELECTED (the one and only controller driving the overlay) >
// ACTIVE (interacted at least once) > AVAILABLE (connected, idle).
function overlayControllerRows() {
  const rows = [];
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const stateFor = (key, isActive) => { if (isActive) _everActive.add(key); return _everActive.has(key) ? 'ACTIVE' : 'AVAILABLE'; };
  if (hidDevice) {                                   // SELECTED — shown in the overlay
    const vp = { vendorId: hidDevice.vendorId, productId: hidDevice.productId };
    const conn = (controllerDriver && controllerDriver.connectionType) || 'hid';
    rows.push({ key: 'active', sortId: deviceIdFor(hidDevice), name: _ctrlName(vp, hidDevice.productName), state: 'SELECTED',
      conn, vp, serial: serialForDevice(vp, conn), active: _padActive(readGamepad()), selected: true });
  }
  // Pool entries → rows. A fan-out device (Steam Controller Puck: 5 same-vid:pid
  // HID interfaces on ONE physical unit) rolls up to a SINGLE row; other handles
  // are one row each. Siblings of the SELECTED controller are hidden.
  // TODO: multiple Steam Controllers on one Puck will need per-unit rollup (issue).
  const groups = new Map();
  for (const entry of listManager._hidPool.values()) {
    const d = entry.device;
    if (d === hidDevice) continue;   // the SELECTED device is now pooled too — shown as its own row above
    const isFanout = !!(entry.driver && entry.driver.constructor && entry.driver.constructor.needsSiblingFanout);
    if (isFanout && hidDevice && d.vendorId === hidDevice.vendorId && d.productId === hidDevice.productId) continue;
    const gk = isFanout ? ('fan:' + d.vendorId + ':' + d.productId) : ('dev:' + deviceIdFor(d));
    const a = _padActive(entry.synthetic);
    const g = groups.get(gk);
    if (g) { g.active = g.active || a; } else groups.set(gk, { device: d, entry, active: a });
  }
  for (const g of groups.values()) {
    const d = g.device, vp = { vendorId: d.vendorId, productId: d.productId };
    const key = 'h:' + deviceIdFor(d), a = g.active;
    const conn = (g.entry.driver && g.entry.driver.connectionType) || 'hid';
    rows.push({ key, sortId: deviceIdFor(d), name: _ctrlName(vp, d.productName), state: stateFor(key, a),
      conn, vp, serial: serialForDevice(vp, conn), active: a });
  }
  for (const gp of pads) {                            // gamepad-only pads not already shown
    if (!gp) continue;
    const vp = ControllerRegistry.parseGamepadVendorProduct(gp.id);
    if (hidDevice && vp && hidDevice.vendorId === vp.vendorId && hidDevice.productId === vp.productId) continue;
    if (vp && listManager._findPoolEntryByVidPid(vp.vendorId, vp.productId)) continue;
    const key = 'g:' + gp.index, a = _padActive(gp);
    rows.push({ key, sortId: 100000 + gp.index, name: _ctrlName(vp, 'Controller'), state: stateFor(key, a), conn: 'gamepad', vp, serial: serialForDevice(vp, 'gamepad'), active: a });
  }
  // Stable order by first-sighting (deviceId) so SELECTING a controller does NOT
  // reorder the list — the row you clicked stays put instead of jumping to top.
  rows.sort((x, y) => x.sortId - y.sortId);
  return rows;
}

// Select a controller from the detached list to drive the overlay (Phase 2).
async function selectController(key) {
  if (!key || key === 'active') return;              // already the SELECTED one
  if (key.startsWith('g:')) {
    const gp = (navigator.getGamepads() || [])[parseInt(key.slice(2), 10)];
    if (gp) await switchController(gp);              // model + gyro auto-matched to this pad
    return;
  }
  if (key.startsWith('h:')) {
    const id = key.slice(2);
    let device = null;
    for (const entry of listManager._hidPool.values()) { if (String(deviceIdFor(entry.device)) === id) { device = entry.device; break; } }
    if (!device) return;
    // Stub carries a proper gamepad-id (vid:pid) so the MODEL + labels resolve;
    // preferredDevice binds THIS exact HID handle for gyro/buttons.
    const hx = (n) => n.toString(16).padStart(4, '0');
    const stub = {
      id: `${device.productName || 'Controller'} (STANDARD GAMEPAD Vendor: ${hx(device.vendorId)} Product: ${hx(device.productId)})`,
      index: -1, axes: [0, 0, 0, 0], buttons: Array.from({ length: 22 }, () => ({ pressed: false, value: 0 })),
    };
    await switchController(stub, device);
    if (!syntheticGamepad) syntheticGamepad = createSyntheticGamepad(device.productName);
    // Adopt a matching Gamepad pad ONLY when it's unambiguous (exactly one pad
    // for this vid:pid). With two identical pads (a GameSir + a real DS4, both
    // 054c:05c4) we can't tell which is ours, so drive buttons from THIS exact
    // HID handle's synthetic instead — otherwise pressing one lights both rows.
    const matchPads = (navigator.getGamepads() || []).filter((gp) => {
      if (!gp) return false;
      const vp = ControllerRegistry.parseGamepadVendorProduct(gp.id);
      return vp && vp.vendorId === device.vendorId && vp.productId === device.productId;
    });
    gamepadIndex = matchPads.length === 1 ? matchPads[0].index : null;
  }
}
// Forward the controller rows to the detached "Controllers" window (no-op if it
// isn't open — main.js drops the frame). Serializable rows only (no DOM/refs).
function forwardControllerList() {
  if (!(window.electronAPI && window.electronAPI.sendHudState)) return;
  try { window.electronAPI.sendHudState('controllers', overlayControllerRows()); } catch (e) { /* window closed */ }
}
// Drop phantom handles: a granted device that has NEVER delivered a raw report
// (lastRawReportAt===0) after a grace window is a stale/half-open grant, not a
// live controller (the "USB DS4 SELECTED but rawReportAt=0" case). The manager
// does this in ingestFrame, which the overlay doesn't call — so do it here. A
// physically-present controller streams within ms, so 3s is safe.
const _PHANTOM_MS = 3000;
function evictPhantoms(now) {
  for (const entry of [...listManager._hidPool.values()]) {
    if (entry.lastRawReportAt === 0 && typeof entry.pooledAt === 'number' && (now - entry.pooledAt) > _PHANTOM_MS) {
      const dev = entry.device;
      console.log('[overlay] evicting phantom (no reports in ' + Math.round((now - entry.pooledAt)) + 'ms):',
        dev.productName || (dev.vendorId.toString(16) + ':' + dev.productId.toString(16)));
      if (dev === hidDevice) undesignateEntry();   // was SELECTED — drop it, let auto-adopt find a live one
      try { listManager._evictFromPool(dev); } catch (e) { /* ok */ }
    }
  }
}
// Stalled-stream recovery: a SELECTED handle can stop delivering reports mid-
// session (seen on a USB DS4 — lastRawReportAt FREEZES at a non-zero value while
// other controllers keep advancing) yet stay "connected" for a long time. The
// overlay would show frozen gyro/buttons until Chromium finally fires disconnect.
// Detect the freeze (no new raw report for a window) and re-init the driver to
// kick the stream; back off between attempts so we don't churn a live-but-idle-
// looking device. (A device that never streamed at all is handled by evictPhantoms.)
let _streamWatchRaw = -1, _streamWatchAt = 0, _streamReinitAt = 0;
function checkStalledStream(now) {
  if (!selectedEntry || !gyroActive) { _streamWatchRaw = -1; return; }
  const raw = selectedEntry.lastRawReportAt | 0;
  if (raw !== _streamWatchRaw) { _streamWatchRaw = raw; _streamWatchAt = now; return; }  // still advancing
  if (raw > 0 && (now - _streamWatchAt) > 1500 && (now - _streamReinitAt) > 4000) {
    _streamReinitAt = now;
    console.warn('[overlay] SELECTED stream stalled', Math.round(now - _streamWatchAt) + 'ms — re-initing driver:',
      selectedEntry.device.productName || (selectedEntry.device.vendorId.toString(16) + ':' + selectedEntry.device.productId.toString(16)));
    if (selectedEntry._reinitDriver) { try { selectedEntry._reinitDriver(); } catch (e) { /* ok */ } }
  }
}
let _ovlListThrottle = 0, _phantomThrottle = 0, _streamThrottle = 0, _adoptThrottle = 0;

function loop() {
  requestAnimationFrame(loop);
  const _now = performance.now();
  if (_now - _ovlListThrottle > 120) { _ovlListThrottle = _now; forwardControllerList(); }
  if (_now - _phantomThrottle > 1000) { _phantomThrottle = _now; evictPhantoms(_now); }
  if (_now - _streamThrottle > 500) { _streamThrottle = _now; checkStalledStream(_now); }
  // Auto-adopt a HID controller from the pool when nothing is SELECTED (startup /
  // after a disconnect). Cheap: bails immediately once something is selected.
  if (!hidDevice && _now - _adoptThrottle > 200) {
    _adoptThrottle = _now;
    autoAdoptFromPool();                    // press-based (a real press wins)
    if (!hidDevice) tryAdoptLastUsed(_now);  // else restore the last-used pad within grace (#104)
  }
  if (!modelReady) return;

  const gamepad = readGamepad();

  if (gamepad) {
    // Exit confirmation dialog takes priority
    if (exitConfirm.classList.contains('visible')) {
      navigateExitDialog(gamepad);
    } else if (remapTarget) {
      captureRemap(gamepad);
    } else if (settingsPanel.classList.contains('visible')) {
      navigateSettings(gamepad);
      checkCombo(gamepad, 'settings', () => toggleSettings('gamepad-combo'));
    } else {
      checkCombo(gamepad, 'settings', () => toggleSettings('gamepad-combo'));
    }

    // Gyro shortcuts work regardless of settings panel state
    if (!remapTarget && !exitConfirm.classList.contains('visible')) {
      checkCombo(gamepad, 'gyroToggle', toggleGyro);
      checkCombo(gamepad, 'calibrate', () => {
        if (gyroActive) {
          startCalibration();
          console.log('Gyro recalibrating');
        }
      });
      checkCombo(gamepad, 'recenter', recenterHeading);
    }
  }

  // Report-level extras (touchpad/grips) from the SELECTED pool entry — the
  // manager stores the last parsed values on the entry (Phase 3b; handleInputReport
  // no longer runs). Forward them the same way it used to.
  if (selectedEntry) {
    if (selectedEntry._lastTouchpad) overlay.updateTouchpad(selectedEntry._lastTouchpad, selectedEntry._lastTouchpadButton);
    const grips = selectedEntry._lastGrips;
    if (grips) {
      _lastGrips = grips;
      if (overlay.setGripState) overlay.setGripState(grips);
      updateGripHud(grips);
    }
  }

  // displayOrientation is the recentered/yaw-returned orientation (issue #88);
  // pitch/roll are identical to the raw orientation, only the heading offset
  // differs, so every visual consumer reads it for a consistent picture.
  overlay.update(gamepad, gyroActive ? gyroFusion.displayOrientation : null);

  // Drive the 2D button HUD (cheap; ~30 DOM class flips per frame).
  if (document.body.classList.contains('show-button-hud')) {
    updateButtonHud(gamepad);
  }

  // Forward gamepad state to the detached Button HUD window (no-op when it
  // isn't open — main process drops the message). Sending unconditionally
  // is simpler than tracking window-open state in this renderer; the IPC
  // overhead is trivial for the ~16-byte serialized snapshot.
  if (gamepad && window.electronAPI?.sendHudState) {
    window.electronAPI.sendHudState('button', {
      buttons: gamepad.buttons.map(b => ({ pressed: !!b.pressed, value: b.value || 0 })),
      axes: Array.from(gamepad.axes || []),
      grips: _lastGrips || undefined,
    });
  }

  // Forward gyro orientation to the detached Gyro HUD window (no-op if closed).
  // displayOrientation is a THREE.Quaternion → serialize to {x,y,z,w}.
  if (window.electronAPI?.sendHudState) {
    const o = gyroFusion.displayOrientation;
    window.electronAPI.sendHudState('gyro', {
      q: { x: o.x, y: o.y, z: o.z, w: o.w },
      active: gyroActive,
      fullMode: gyroHudFullCheck?.checked || false,
      colors: axisColors, // ring colors track the Axis (Pitch/Roll/Yaw) colors
    });
  }

  // Drive the Gyro HUD (3D gimbal widget) when visible
  if (gimbal && document.body.classList.contains('show-gyro-hud')) {
    gimbal.update(gyroActive ? gyroFusion.displayOrientation : null);
  }

  // Axis values (pitch/roll/yaw degrees, swing-twist per axis) \u2014 drive the
  // in-overlay readout and forward to the detached Axis window.
  {
    const q = gyroActive ? gyroFusion.displayOrientation : null;
    const toDeg = 180 / Math.PI;
    const twist = (ax, ay, az) => {
      if (!q) return 0;
      const d = q.x * ax + q.y * ay + q.z * az;
      return 2 * Math.atan2(d, q.w) * toDeg;
    };
    const pitch = Math.round(twist(1, 0, 0));
    const roll = Math.round(twist(0, 0, 1));
    const yaw = Math.round(twist(0, 1, 0));
    if (document.body.classList.contains('show-axis-readout')) {
      axPitchVal.textContent = pitch + '\u00B0';
      axRollVal.textContent = roll + '\u00B0';
      axYawVal.textContent = yaw + '\u00B0';
    }
    if (window.electronAPI?.sendHudState) {
      window.electronAPI.sendHudState('axis', { pitch, roll, yaw, active: gyroActive, colors: axisColors });
    }
  }

  // Update gyro HUD
  if (gyroActive) {
    _hudEuler.setFromQuaternion(gyroFusion.displayOrientation, 'XYZ');
    const leanDeg = -_hudEuler.z * (180 / Math.PI);
    updateGyroHud(leanDeg);

    // Drift detection: lean angle changing while controller is stationary
    if (!calibrating) {
      const leanDelta = Math.abs(leanDeg - driftCheckLastLean);
      driftCheckLastLean = leanDeg;
      if (leanDelta > 0.02 && leanDelta < 0.5) {
        driftCheckAccum += leanDelta;
      } else {
        driftCheckAccum = Math.max(0, driftCheckAccum - 0.1);
      }
      if (driftCheckAccum > 15) {
        showCalibHint(comboName(combos.calibrate) + ' to recalibrate', 5000);
        driftCheckAccum = 0;
      }
    }
  }

  // Forward roll state to the detached Roll HUD window (no-op if closed).
  if (window.electronAPI?.sendHudState) {
    let leanDeg = 0;
    if (gyroActive) {
      _hudEuler.setFromQuaternion(gyroFusion.displayOrientation, 'XYZ');
      leanDeg = -_hudEuler.z * (180 / Math.PI);
    }
    window.electronAPI.sendHudState('roll', { leanDeg, active: gyroActive, colors: leanColors, labelBright: rollLabelBright });
  }
}

// ── Settings panel visibility — single canonical entry point ──
//
// The settings panel can be opened/closed from many UI paths: the gear
// icon, the X close button, right-click anywhere, gamepad button combos,
// gamepad dpad/B inside the panel, click-outside, IPC from the tray menu.
// When the Steam Controller Puck is connected, its lizard-mode firmware
// fires phantom mouse + keyboard + gamepad-button events at unpredictable
// intervals — and rate-limiting alone can't suppress the flicker because
// phantom events keep landing right at the cooldown boundary.
//
// So we tag every caller with a `source` and whitelist which sources are
// allowed when Puck is connected. The whitelist is the two MOST DELIBERATE
// gestures: clicking the visible gear icon, and clicking the X inside the
// panel. Everything else is silently dropped while Puck is connected.
// Non-Puck users keep the full set of interactions unchanged.
//
// All settings-visibility mutations MUST go through setSettingsVisible
// (or toggleSettings, which delegates). Direct settingsPanel.classList
// changes are forbidden — they bypass this guard.

// Ctrl+Right-Click is whitelisted too: it's a deliberate modified gesture the
// lizard-mode phantom right-clicks never produce, so it's the reliable way to
// open settings when the gear is hidden AND a Puck is connected.
// gear-click / close-button / ctrl-contextmenu are deliberate UI gestures, and
// 'ipc' is the tray "Show Settings" / global shortcut — all deliberate, so they
// bypass the Puck guard (which only exists to swallow lizard-mode phantom
// right-clicks). This guarantees a way into settings even with a Puck connected.
const PUCK_ALLOWED_SETTINGS_SOURCES = new Set(['gear-click', 'close-button', 'ctrl-contextmenu', 'ipc']);

function setSettingsVisible(visible, source) {
  if (puckConnected && !PUCK_ALLOWED_SETTINGS_SOURCES.has(source)) return;
  if (settingsPanel.classList.contains('visible') === visible) return;
  settingsPanel.classList.toggle('visible', visible);
  if (visible) {
    settingsFocusIndex = 0;
    updateSettingsFocus();
  }
}

function toggleSettings(source) {
  const visible = !settingsPanel.classList.contains('visible');
  setSettingsVisible(visible, source);
}

async function toggleGyro() {
  if (gyroActive) {
    // Just stop DISPLAYING the gyro — never reset the entry's fusion (the manager
    // owns it and keeps feeding it; resetting would fight the shared state).
    gyroActive = false;
    updateGyroToggle();
    hideGyroHud();
  } else if (gyroPermitted && hidDevice) {
    gyroActive = true;
    startCalibration();
    updateGyroToggle();
    showGyroHud();
  } else {
    try { await connectControllerGyro(); } catch (e) { /* */ }
  }
}

// ── Gamepad settings navigation ──
let settingsFocusIndex = 0;
const navPrevState = { up: false, down: false, left: false, right: false, a: false, b: false };

// Auto-repeat for held directions: fire on press, then wait INITIAL_DELAY,
// then repeat every REPEAT_INTERVAL while held.
const NAV_INITIAL_DELAY = 400;
const NAV_REPEAT_INTERVAL = 90;
const navRepeatNext = { up: 0, down: 0, left: 0, right: 0 };
function navTrigger(dir, pressed) {
  const now = performance.now();
  if (pressed && !navPrevState[dir]) {
    navRepeatNext[dir] = now + NAV_INITIAL_DELAY;
    return true;
  }
  if (pressed && now >= navRepeatNext[dir]) {
    navRepeatNext[dir] = now + NAV_REPEAT_INTERVAL;
    return true;
  }
  return false;
}

function getSettingRows() {
  return Array.from(settingsPanel.querySelectorAll('.setting-row, .camera-presets'));
}

function navigateSettings(gamepad) {
  // Gamepad-driven settings navigation is unsafe while the Puck is
  // connected: the lizard-mode firmware (or wireless link transients)
  // intermittently flips dpad / B-button bits in the STATE report, and
  // our parser dutifully forwards them — which here would auto-navigate
  // down 1-2 rows and close the panel (line ~1191 below). Skip the
  // entire path while a Puck is the active controller. Users on the
  // Puck must use mouse / touch for settings; users on USB-C direct
  // keep full gamepad nav as before.
  if (puckConnected) return;
  const rows = getSettingRows();
  if (!rows.length) return;

  const up = gamepad.buttons[12]?.pressed || (gamepad.axes[1] < -0.5);
  const down = gamepad.buttons[13]?.pressed || (gamepad.axes[1] > 0.5);
  const left = gamepad.buttons[14]?.pressed || (gamepad.axes[0] < -0.5);
  const right = gamepad.buttons[15]?.pressed || (gamepad.axes[0] > 0.5);
  const a = gamepad.buttons[0]?.pressed;
  const b = gamepad.buttons[1]?.pressed;

  const upFire = navTrigger('up', up);
  const downFire = navTrigger('down', down);
  const leftFire = navTrigger('left', left);
  const rightFire = navTrigger('right', right);

  if (upFire) {
    settingsFocusIndex = Math.max(0, settingsFocusIndex - 1);
    updateSettingsFocus();
  }
  if (downFire) {
    settingsFocusIndex = Math.min(rows.length - 1, settingsFocusIndex + 1);
    updateSettingsFocus();
  }

  const row = rows[settingsFocusIndex];
  if (row) {
    // Camera presets row — left/right highlights, A confirms selection
    if (row.classList.contains('camera-presets')) {
      const btns = Array.from(row.querySelectorAll('button'));
      // Track a hover/focus index within this row
      let hoverIdx = btns.findIndex(b => b.classList.contains('nav-hover'));
      if (hoverIdx === -1) hoverIdx = btns.findIndex(b => b.classList.contains('selected'));

      if (leftFire) {
        hoverIdx = Math.max(0, (hoverIdx === -1 ? btns.length : hoverIdx) - 1);
        highlightPresetBtn(btns, hoverIdx);
      }
      if (rightFire) {
        hoverIdx = Math.min(btns.length - 1, (hoverIdx === -1 ? -1 : hoverIdx) + 1);
        highlightPresetBtn(btns, hoverIdx);
      }
      if (a && !navPrevState.a && hoverIdx >= 0 && hoverIdx < btns.length) {
        selectCameraPreset(btns[hoverIdx].dataset.preset);
        clearPresetHover();
      }
    } else {
      const select = row.querySelector('select');
      const checkbox = row.querySelector('input[type="checkbox"]');
      const slider = row.querySelector('input[type="range"]');
      const button = row.querySelector('button');

      if (leftFire) {
        if (select) { select.selectedIndex = Math.max(0, select.selectedIndex - 1); select.dispatchEvent(new Event('change')); }
        if (slider) { slider.value = Math.max(+slider.min, +slider.value - 5); slider.dispatchEvent(new Event('input')); }
      }
      if (rightFire) {
        if (select) { select.selectedIndex = Math.min(select.options.length - 1, select.selectedIndex + 1); select.dispatchEvent(new Event('change')); }
        if (slider) { slider.value = Math.min(+slider.max, +slider.value + 5); slider.dispatchEvent(new Event('input')); }
      }
      if (a && !navPrevState.a) {
        if (checkbox) { checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event('change')); }
        if (button) button.click();
      }
    }
  }

  if (b && !navPrevState.b) {
    setSettingsVisible(false, 'gamepad-b');
  }

  navPrevState.up = up; navPrevState.down = down;
  navPrevState.left = left; navPrevState.right = right;
  navPrevState.a = a; navPrevState.b = b;
}

function highlightPresetBtn(btns, idx) {
  btns.forEach((b, i) => b.classList.toggle('nav-hover', i === idx));
}

function clearPresetHover() {
  document.querySelectorAll('.camera-presets button.nav-hover').forEach(b => b.classList.remove('nav-hover'));
}

function updateSettingsFocus() {
  clearPresetHover();
  const rows = getSettingRows();
  rows.forEach((r, i) => {
    r.style.background = i === settingsFocusIndex ? 'rgba(51,136,255,0.15)' : '';
    r.style.borderRadius = i === settingsFocusIndex ? '6px' : '';
  });
  if (rows[settingsFocusIndex]) {
    rows[settingsFocusIndex].scrollIntoView({ block: 'nearest' });
  }
}

// ── Exit dialog navigation ──
let exitFocusIdx = 0;
const exitDialogPrev = { left: false, right: false, a: false, b: false };

function navigateExitDialog(gamepad) {
  const btns = [document.getElementById('exit-cancel'), document.getElementById('exit-yes')];

  const left = gamepad.buttons[14]?.pressed || (gamepad.axes[0] < -0.5);
  const right = gamepad.buttons[15]?.pressed || (gamepad.axes[0] > 0.5);
  const a = gamepad.buttons[0]?.pressed;
  const b = gamepad.buttons[1]?.pressed;

  if (left && !exitDialogPrev.left) exitFocusIdx = 0;
  if (right && !exitDialogPrev.right) exitFocusIdx = 1;

  btns.forEach((btn, i) => {
    btn.style.outline = i === exitFocusIdx ? '2px solid #fff' : '';
    btn.style.outlineOffset = i === exitFocusIdx ? '2px' : '';
  });

  if (a && !exitDialogPrev.a) btns[exitFocusIdx].click();
  if (b && !exitDialogPrev.b) document.getElementById('exit-cancel').click();

  exitDialogPrev.left = left; exitDialogPrev.right = right;
  exitDialogPrev.a = a; exitDialogPrev.b = b;
}

// ── Remap capture ──
function startRemap(key) {
  remapTarget = key;
  updateRemapUI();
}

function captureRemap(gamepad) {
  const pressed = [];
  for (let i = 0; i < gamepad.buttons.length; i++) {
    if (gamepad.buttons[i].pressed) pressed.push(i);
  }
  if (pressed.length >= 2) {
    combos[remapTarget] = pressed;
    saveCombos();
    remapTarget = null;
    updateRemapUI();
  }
}

function updateRemapUI() {
  for (const key of Object.keys(DEFAULT_COMBOS)) {
    const label = document.getElementById(`combo-label-${key}`);
    const btn = document.getElementById(`combo-remap-${key}`);
    if (label) label.textContent = comboName(combos[key]);
    if (btn) btn.textContent = (remapTarget === key) ? 'Press combo...' : 'Remap';
  }
}

// Initialize remap buttons after DOM is ready
document.querySelectorAll('[data-remap]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.remap;
    if (remapTarget === key) {
      remapTarget = null; // cancel
    } else {
      remapTarget = key;
    }
    updateRemapUI();
  });
});

function readGamepad() {
  // ── WebHID-authoritative (Phase 3) ──
  // Whenever we have a live HID driver + synthetic, that synthetic IS the source
  // of truth — for every HID controller, not just Bluetooth. It carries the
  // COMPLETE button map (Switch Capture / DualSense mic / back paddles), reads
  // the exact physical handle (so two identical vid:pid pads never cross-wire),
  // and is immune to the Gamepad API's stale-slot freezes and unmapped buttons
  // (e.g. Chromium never surfacing the Switch Pro Capture button). The Gamepad
  // API below is now only a FALLBACK for XInput-only pads (Xbox wired/dongle)
  // that expose no HID input interface — those have no controllerDriver.
  if (controllerDriver && syntheticGamepad) {
    return syntheticGamepad;
  }

  // XInput-only fallback: no HID driver → read the Gamepad API slot.
  if (gamepadIndex !== null) {
    const gp = navigator.getGamepads()[gamepadIndex];
    if (gp) return gp;
  }

  // Fallback: HID-derived synthetic gamepad. Required for DualSense BT in
  // 0x31 full-report mode, which is invisible to Chromium's Gamepad API.
  // Presence of syntheticGamepad implies an active HID-synthetic session —
  // disconnectGyro() clears it so stale state can't leak.
  if (syntheticGamepad) {
    return syntheticGamepad;
  }

  // Nothing SELECTED → no input this frame. Adoption is NOT done here anymore:
  // HID controllers are auto-adopted from the pool ONLY when engaged
  // (autoAdoptFromPool), and XInput pads via gamepadconnected. So a mere pad
  // being present never auto-selects — the "No Controller" splash stays until the
  // user presses a controller or clicks its row.
  if (gamepadIndex === null) return null;

  // Had an XInput slot, the Gamepad API dropped it.
  onGamepadDisconnected(gamepadIndex);
  return null;
}

// =====================================================================
// GYRO INPUT
// =====================================================================

/** Reset all gyro + sensor fusion state to identity. */
function resetGyroState() {
  gyroFusion.reset();
}

function createSyntheticGamepad(id) {
  return {
    id: id || 'HID Controller',
    index: -1,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 22 }, () => ({ pressed: false, value: 0 })), // 0-17 standard + 18-21 back paddles (L4/L5/R4/R5)
    _synthetic: true,
  };
}

// Map parsed HID fields into the Standard Gamepad layout used by controller-profiles.js.
function updateSyntheticFromParsed(parsed) {
  if (!syntheticGamepad) {
    syntheticGamepad = createSyntheticGamepad(hidDevice?.productName);
  }
  const g = syntheticGamepad;

  if (parsed.sticks) {
    g.axes[0] = parsed.sticks.lx;
    g.axes[1] = parsed.sticks.ly;
    g.axes[2] = parsed.sticks.rx;
    g.axes[3] = parsed.sticks.ry;
  }

  if (parsed.buttons) {
    const b = parsed.buttons;
    const set = (i, pressed, value) => {
      const slot = g.buttons[i];
      slot.pressed = !!pressed;
      slot.value = value === undefined ? (pressed ? 1 : 0) : value;
    };
    set(0, b.cross);
    set(1, b.circle);
    set(2, b.square);
    set(3, b.triangle);
    set(4, b.l1);
    set(5, b.r1);
    const l2v = parsed.triggers?.l2 ?? 0;
    const r2v = parsed.triggers?.r2 ?? 0;
    set(6, b.l2 || l2v > 0.05, l2v);
    set(7, b.r2 || r2v > 0.05, r2v);
    set(8, b.create);
    set(9, b.options);
    set(10, b.l3);
    set(11, b.r3);
    set(12, b.dpadUp);
    set(13, b.dpadDown);
    set(14, b.dpadLeft);
    set(15, b.dpadRight);
    set(16, b.ps);
    set(17, b.mic || b.quickAccess || b.capture); // DualSense mic / Steam "…" / Switch Pro Capture share slot 17
  }

  // Back paddles (L4/L5/R4/R5) — no Standard-Gamepad index, so park them in
  // synthetic slots 18-21. The profile buttonMap points those at the paddle
  // meshes, so the normal press/glow path lights them up.
  if (parsed.paddles) {
    const p = parsed.paddles;
    const pset = (i, pressed) => {
      const slot = g.buttons[i];
      if (slot) { slot.pressed = !!pressed; slot.value = pressed ? 1 : 0; }
    };
    pset(18, p.l4);
    pset(19, p.l5);
    pset(20, p.r4);
    pset(21, p.r5);
  }
}

// 2D grip-sense indicator — readable at any 3D camera angle (the grip meshes
// are on the back of the controller and usually occluded). Lazily revealed the
// first time grip data arrives, then tracks left/right state.
let gripVizEnabled = localStorage.getItem('overlay:gripViz') === '1'; // on-top glow markers on/off (default OFF, #92)
let gripBarsVisible = localStorage.getItem('overlay:gripBars') !== '0'; // grip-sense side bars (default ON, #92)
let gripGlowWidth = parseInt(localStorage.getItem('overlay:gripGlowWidth') || '2', 10); // across-handle, 1-5
let gripGlowLength = parseInt(localStorage.getItem('overlay:gripGlowLength') || '4', 10); // front-to-back, 1-5
// Grip-sense HUD row — toggles the LG/RG cells in the Button HUD from
// parsed.grips (dedicated path; grips aren't in the gamepad). Revealed via
// body.has-grips the first time a controller reports grips.
let _gripHudRefs = null;
let _lastGrips = null; // latest grip state, forwarded to the Button HUD window
function updateGripHud(grips) {
  if (!_gripHudRefs) {
    const l = document.querySelector('#button-hud [data-grip="l"]');
    const r = document.querySelector('#button-hud [data-grip="r"]');
    if (!l || !r) return;
    _gripHudRefs = { l, r };
  }
  document.body.classList.add('has-grips');
  _gripHudRefs.l.classList.toggle('active', !!grips.left);
  _gripHudRefs.r.classList.toggle('active', !!grips.right);
}

// Grip-sense glow toggle — gates the 3D markers/glow (overlay.setGripVisible).
const gripToggle = document.getElementById('grip-viz-toggle');
if (gripToggle) {
  gripToggle.checked = gripVizEnabled;
  gripToggle.addEventListener('change', (e) => {
    gripVizEnabled = e.target.checked;
    localStorage.setItem('overlay:gripViz', gripVizEnabled ? '1' : '0');
    if (overlay?.setGripVisible) overlay.setGripVisible(gripVizEnabled); // 3D handle glow only
  });
}

// Grip-sense bars toggle — shows/hides the grip-sense bar meshes themselves.
const gripBarsToggle = document.getElementById('grip-bars-toggle');
if (gripBarsToggle) {
  gripBarsToggle.checked = gripBarsVisible;
  gripBarsToggle.addEventListener('change', (e) => {
    gripBarsVisible = e.target.checked;
    localStorage.setItem('overlay:gripBars', gripBarsVisible ? '1' : '0');
    if (overlay?.setGripBarsVisible) overlay.setGripBarsVisible(gripBarsVisible);
  });
}

// Grip glow marker size — across-handle width and front-to-back length, 1-5
// each (width 1 + length 1 = a small circle).
const gripGlowWidthSlider = document.getElementById('grip-glow-width');
if (gripGlowWidthSlider) {
  gripGlowWidthSlider.value = gripGlowWidth;
  gripGlowWidthSlider.addEventListener('input', (e) => {
    gripGlowWidth = parseInt(e.target.value, 10);
    localStorage.setItem('overlay:gripGlowWidth', String(gripGlowWidth));
    if (overlay?.setGripGlowWidth) overlay.setGripGlowWidth(gripGlowWidth);
  });
}
const gripGlowLengthSlider = document.getElementById('grip-glow-length');
if (gripGlowLengthSlider) {
  gripGlowLengthSlider.value = gripGlowLength;
  gripGlowLengthSlider.addEventListener('input', (e) => {
    gripGlowLength = parseInt(e.target.value, 10);
    localStorage.setItem('overlay:gripGlowLength', String(gripGlowLength));
    if (overlay?.setGripGlowLength) overlay.setGripGlowLength(gripGlowLength);
  });
}

// Grip-sense color — defaults to the Highlight Color; an explicit pick here
// overrides it (stored separately as overlay:gripColor).
const gripColorInput = document.getElementById('grip-color');
if (gripColorInput) {
  const savedGrip = localStorage.getItem('overlay:gripColor');
  const savedHl = localStorage.getItem('overlay:highlightColor');
  gripColorInput.value = savedGrip || savedHl || '#ff0000';
  if (savedGrip && overlay?.setGripColor) overlay.setGripColor(savedGrip);
  gripColorInput.addEventListener('input', (e) => {
    localStorage.setItem('overlay:gripColor', e.target.value);
    if (overlay?.setGripColor) overlay.setGripColor(e.target.value);
  });
}

// Grip marker brightness (on-top 3D indicator).
const gripBrightnessSlider = document.getElementById('grip-brightness');
if (gripBrightnessSlider) {
  const saved = localStorage.getItem('overlay:gripBrightness');
  if (saved !== null) gripBrightnessSlider.value = saved;
  gripBrightnessSlider.addEventListener('input', (e) => {
    localStorage.setItem('overlay:gripBrightness', e.target.value);
    if (overlay?.setGripBrightness) overlay.setGripBrightness(parseInt(e.target.value, 10) / 100);
  });
}

// ── Highlight color (single shared picker) ─────────────────────────────────
// One `highlight-color` picker drives everything tinted by the highlight:
//   • the 2D Button HUD .pressed states, via the `--hl-color` CSS var
//   • the 3D model's button/trigger press glow, via overlay.setPressColor (#45)
//   • the 3D grip-sense markers + glow, via overlay.setGripColor (#49)
// Persisted (key `overlay:highlightColor`) only once the user changes it, so the
// defaults (blue HUD / yellow press / blue grip) are preserved until they opt in.
const highlightColorInput = document.getElementById('highlight-color');
function applyHighlightColor(hex) {
  document.documentElement.style.setProperty('--hl-color', hex);
  if (overlay?.setPressColor) overlay.setPressColor(hex); // 3D overlay may not exist yet on load
  // Grip color follows the highlight ONLY until the user sets an explicit grip
  // override (overlay:gripColor); then the override wins.
  if (!localStorage.getItem('overlay:gripColor')) {
    if (overlay?.setGripColor) overlay.setGripColor(hex);
    const gc = document.getElementById('grip-color');
    if (gc) gc.value = hex; // keep the grip picker in sync while it follows the highlight
  }
}
if (highlightColorInput) {
  const savedHl = localStorage.getItem('overlay:highlightColor');
  if (savedHl) highlightColorInput.value = savedHl;
  // Apply on load (saved value, or the red default) so the HUD, press glow and
  // grip all pick up the default highlight without needing a manual change.
  applyHighlightColor(highlightColorInput.value);
  highlightColorInput.addEventListener('input', (e) => {
    localStorage.setItem('overlay:highlightColor', e.target.value);
    applyHighlightColor(e.target.value);
  });
}

let _firstReportLogged = false;
function handleInputReport(event) {
  if (!controllerDriver) return;
  if (!_firstReportLogged) {
    _firstReportLogged = true;
    console.log('First HID inputreport: reportId=0x' + event.reportId.toString(16),
      'byteLength=' + event.data.byteLength);
  }
  const parsed = controllerDriver.parseReport(event.reportId, event.data);
  if (!parsed) return;

  // Hide the "Puck waiting for paired controller" hint as soon as any
  // valid STATE report arrives — that's the signal a controller is paired.
  if (puckConnected) onPuckStateReport();

  // Keep sticks/buttons flowing even when gyro is toggled off — otherwise
  // turning gyro off on a BT DualSense (stuck in 0x31) would silently lose
  // all stick/button input since the Gamepad API can't see it either.
  if (parsed.sticks || parsed.buttons || parsed.triggers) {
    updateSyntheticFromParsed(parsed);
  }

  if (parsed.touchpad) {
    overlay.updateTouchpad(parsed.touchpad, parsed.touchpadButton);
  }

  if (parsed.grips) {
    _lastGrips = parsed.grips;                                    // forwarded to the Button HUD window
    if (overlay.setGripState) overlay.setGripState(parsed.grips); // 3D handle glow (toggleable)
    updateGripHud(parsed.grips);                                  // grip cells in the Button HUD
  }

  if (!gyroActive || !parsed.gyro) return;

  const now = performance.now();
  const rawGx = parsed.gyro.x;
  const rawGy = parsed.gyro.y;
  const rawGz = parsed.gyro.z;

  // Initial calibration sampling — owned at the app layer because we have
  // a variance-threshold / retry UX that SensorFusion doesn't implement.
  // While calibrating we collect samples but skip fusion integration so the
  // orientation stays at identity until the bias is applied.
  if (calibrating) {
    calibSamples.push({ x: rawGx, y: rawGy, z: rawGz });
    if (calibSamples.length >= CALIB_COUNT) finishCalibration();
    return;
  }

  gyroFusion.ingest(
    rawGx, rawGy, rawGz,
    parsed.accel ? parsed.accel.x : null,
    parsed.accel ? parsed.accel.y : null,
    parsed.accel ? parsed.accel.z : null,
    parsed.gyroScale || (2000 / 32768),
    parsed.accelScale || (1 / 8192),
    now,
  );
}
// ── Calibration ──

// Instant yaw recenter: zero the *displayed* heading with no full recalibration
// — no bias re-sample, no orientation reset, no "Calibrating…" interruption.
// Pitch/roll stay gravity-true (only the heading offset moves). Complements the
// at-rest auto-return for when the user wants to snap forward mid-use.
function recenterHeading() {
  if (!gyroActive) return;
  gyroFusion.recenter();
  console.log('Gyro heading recentered');
}

function startCalibration() {
  // Phase 3b: the SELECTED pool entry's fusion self-calibrates — SensorFusion
  // .startCalibration has the same variance/retry logic this used to duplicate
  // (and it's what the game uses). Trigger it; the manager drives the samples.
  // Reset orientation (zero the displayed pose) + bias so a recalibrate returns
  // to the zero positions (the old resetGyroState behavior — #94: no camera).
  if (gyroFusion) {
    if (gyroFusion.reset) gyroFusion.reset();
    if (gyroFusion.resetBias) gyroFusion.resetBias();
    if (gyroFusion.startCalibration) gyroFusion.startCalibration(controllerDriver?.connectionType);
  }
  showCalibHint('Calibrating...', 2500);
}

function finishCalibration() {
  if (calibSamples.length === 0) return;

  let sx = 0, sy = 0, sz = 0;
  for (const s of calibSamples) { sx += s.x; sy += s.y; sz += s.z; }
  const meanX = sx / calibSamples.length;
  const meanY = sy / calibSamples.length;
  const meanZ = sz / calibSamples.length;

  let varX = 0, varY = 0, varZ = 0;
  for (const s of calibSamples) {
    varX += (s.x - meanX) ** 2;
    varY += (s.y - meanY) ** 2;
    varZ += (s.z - meanZ) ** 2;
  }
  const maxStd = Math.max(
    Math.sqrt(varX / calibSamples.length),
    Math.sqrt(varY / calibSamples.length),
    Math.sqrt(varZ / calibSamples.length),
  );

  if (maxStd > CALIB_VARIANCE_THRESHOLD && calibRetries < MAX_CALIB_RETRIES) {
    calibRetries++;
    calibSamples = [];
    console.log(`Calibration retry ${calibRetries}/${MAX_CALIB_RETRIES} (stddev: ${maxStd.toFixed(1)})`);
    return;
  }

  gyroFusion.bias.x = meanX;
  gyroFusion.bias.y = meanY;
  gyroFusion.bias.z = meanZ;
  calibrating = false;
  calibSamples = [];
  resetGyroState();
  driftCheckAccum = 0;
  driftCheckLastLean = 0;
  showCalibHint(comboName(combos.calibrate) + ' to recalibrate', 3000);
  console.log('Gyro calibrated, bias:', gyroFusion.bias, 'stddev:', maxStd.toFixed(1));
}

// ── UI Events ──

settingsToggle.addEventListener('click', () => toggleSettings('gear-click'));

document.getElementById('settings-close').addEventListener('click', () => {
  setSettingsVisible(false, 'close-button');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
  setSettingsVisible(false, 'close-button');
});

// Reset every saved overlay setting (all `overlay:*` keys) and reload so the
// app re-initializes from defaults.
document.getElementById('btn-reset-defaults').addEventListener('click', async () => {
  if (!confirm('Reset ALL overlay settings to their defaults? This clears your saved customizations.')) return;
  // Clear every overlay key — both the `overlay:` settings and the
  // `overlay-display-prefs` blob (note: no colon, so a `overlay:` filter misses it).
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('overlay')) localStorage.removeItem(k);
  }
  // Force the settings gear visible so a reset can never strand the user with a
  // hidden gear (the in-handle Ctrl+Right-Click is the other way back in).
  try { localStorage.removeItem('overlay-display-prefs'); } catch (e) { /* ignore */ }
  // Window size lives in the main process (window-state.json), not localStorage,
  // so it has to be reset over IPC. Await it so the resize lands before reload.
  try { await window.electronAPI?.resetWindowSize?.(); } catch (e) { /* ignore */ }
  location.reload();
});

// Exit application with confirmation
const exitConfirm = document.getElementById('exit-confirm');

document.getElementById('btn-exit-app').addEventListener('click', () => {
  exitFocusIdx = 0; // default to Cancel
  exitConfirm.classList.add('visible');
});

document.getElementById('exit-cancel').addEventListener('click', () => {
  exitConfirm.classList.remove('visible');
});

document.getElementById('exit-yes').addEventListener('click', () => {
  if (window.electronAPI?.quit) {
    window.electronAPI.quit();
  } else if (window.close) {
    window.close();
  }
});

// Click outside settings panel to close it. Disabled entirely when the
// Steam Controller Puck is connected — phantom mouse clicks from the
// lizard-mode firmware fire too unpredictably for any rate-limit to
// hold; the panel oscillates open/close in a tight loop. With this
// path suppressed, the only ways to close the panel during a Puck
// session are the X button inside the panel, the gear icon, or
// unplugging the Puck. Tracked in #8.
window.addEventListener('mousedown', (e) => {
  if (!settingsPanel.classList.contains('visible')) return;
  if (settingsPanel.contains(e.target)) return;
  if (e.target === settingsToggle || settingsToggle.contains(e.target)) return;
  setSettingsVisible(false, 'click-outside');
});

// LIVE badge toggle (#104) — default OFF; persists in localStorage.
const badgeToggle = document.getElementById('badge-toggle');
if (badgeToggle) {
  badgeToggle.checked = showBadge;
  badgeToggle.addEventListener('change', (e) => {
    showBadge = e.target.checked;
    localStorage.setItem('overlay:showBadge', showBadge ? '1' : '0');
    updateLiveBadge();
  });
}

controllerTypeSelect.addEventListener('change', async (e) => {
  // Persist the user's manual choice so it survives a relaunch — without
  // this, every restart would revert to 'auto' and undo their preference.
  localStorage.setItem('overlay:controllerType', e.target.value);

  const gp = gamepadIndex !== null ? navigator.getGamepads()[gamepadIndex] : null;
  if (e.target.value === 'auto' && gp) {
    const type = pickControllerProfile(gp.id);
    if (type !== currentControllerType) {
      modelReady = false;
      currentControllerType = type;
      applyHudLabels(type);
      await overlay.setControllerType(type);
      modelReady = true;
    }
  } else if (e.target.value !== 'auto') {
    if (e.target.value !== currentControllerType) {
      modelReady = false;
      currentControllerType = e.target.value;
      applyHudLabels(e.target.value);
      await overlay.setControllerType(e.target.value);
      modelReady = true;
    }
    // Even when the type didn't change (e.g. user picks the profile the
    // overlay already loaded by default), force the model visible and
    // hide the no-controller splash. Manually picking a profile is an
    // explicit "I want to see this model" — useful for previewing a
    // controller's GLB without one actually connected (e.g. Steam
    // Controller, which Chromium's Gamepad API can't enumerate at all).
    overlay.setVisible(true);
    noControllerSplash.classList.add('hidden');
  }
});

// Settings panel gyro button also connects
connectGyroBtn.addEventListener('click', async () => {
  if (hidDevice && gyroActive) return;
  try {
    await connectControllerGyro();
  } catch (err) {
    console.error('WebHID connect failed:', err);
    connectGyroBtn.textContent = 'Connect';
  }
});

document.getElementById('hud-position').addEventListener('change', () => applyHudPosition());

// Float Controls — float triggers/bumpers/paddles clear of the body. The
// overlay eases them in/out; we just persist + forward the toggle.
// Migrate the pre-rename persistence key (overlay:floatParts → :floatControls).
if (localStorage.getItem('overlay:floatControls') === null) {
  const legacy = localStorage.getItem('overlay:floatParts');
  if (legacy !== null) localStorage.setItem('overlay:floatControls', legacy);
}
const floatControlsCheck = document.getElementById('float-controls');
if (floatControlsCheck) {
  floatControlsCheck.checked = localStorage.getItem('overlay:floatControls') !== '0';
  floatControlsCheck.addEventListener('change', (e) => {
    localStorage.setItem('overlay:floatControls', e.target.checked ? '1' : '0');
    if (overlay?.setFloatParts) overlay.setFloatParts(e.target.checked);
  });
}

// Steam Controller: suppress lizard-mode keyboard/mouse emulation (default ON).
// Set on the driver class before connect; a change takes effect on the next
// (re)connect. Off = leave keyboard/mouse active (e.g. let Steam Input own it).
SteamControllerDriver.suppressLizardMode = localStorage.getItem('overlay:suppressLizard') !== '0';
const suppressLizardCheck = document.getElementById('suppress-lizard');
if (suppressLizardCheck) {
  suppressLizardCheck.checked = SteamControllerDriver.suppressLizardMode;
  suppressLizardCheck.addEventListener('change', (e) => {
    SteamControllerDriver.suppressLizardMode = e.target.checked;
    localStorage.setItem('overlay:suppressLizard', e.target.checked ? '1' : '0');
  });
}

// ── Layout editor (#51) controls ──
// While editing, the window-drag handler must stand down so click-drag moves
// the part, not the OS window (see wireWindowDrag below).
let layoutEditing = false;
const editLayoutToggle = document.getElementById('edit-layout-toggle');
const layoutModeSelect = document.getElementById('layout-mode');
const resetLayoutBtn = document.getElementById('reset-layout');
const editLayoutHelp = document.getElementById('edit-layout-help');
const editLayoutSelected = document.getElementById('edit-layout-selected');

// Precise numeric editor for the selected part (in addition to drag + Q/E/arrows).
// It's a floating popup (outside the settings panel) so it's visible while the
// panel is closed and the user is dragging parts in the 3D view.
const layoutPopup = document.getElementById('layout-editor-popup');
const layoutNumInputs = {
  px: document.getElementById('layout-pos-x'), py: document.getElementById('layout-pos-y'), pz: document.getElementById('layout-pos-z'),
  rx: document.getElementById('layout-rot-x'), ry: document.getElementById('layout-rot-y'), rz: document.getElementById('layout-rot-z'),
};

// Push the selected part's live values into the numeric fields. Skips a field
// the user is mid-edit in (so typing isn't clobbered by drag/key updates), and
// rounds for readability. Pass the overlay's getSelectedLayout() result.
function refreshLayoutNumeric() {
  const data = overlay?.getSelectedLayout?.();
  if (!data) return;
  const round = (v, d) => Number.isFinite(v) ? Number(v.toFixed(d)) : 0;
  const set = (el, v) => { if (el && document.activeElement !== el) el.value = v; };
  set(layoutNumInputs.px, round(data.offset.x, 3));
  set(layoutNumInputs.py, round(data.offset.y, 3));
  set(layoutNumInputs.pz, round(data.offset.z, 3));
  set(layoutNumInputs.rx, round(data.euler.x, 1));
  set(layoutNumInputs.ry, round(data.euler.y, 1));
  set(layoutNumInputs.rz, round(data.euler.z, 1));
}

// Read all six fields and apply them to the selected part.
function applyLayoutNumeric() {
  if (!overlay?.setSelectedLayout) return;
  const num = (el) => { const v = parseFloat(el?.value); return Number.isFinite(v) ? v : undefined; };
  overlay.setSelectedLayout({
    offset: { x: num(layoutNumInputs.px), y: num(layoutNumInputs.py), z: num(layoutNumInputs.pz) },
    euler:  { x: num(layoutNumInputs.rx), y: num(layoutNumInputs.ry), z: num(layoutNumInputs.rz) },
  });
}
for (const [key, el] of Object.entries(layoutNumInputs)) {
  if (!el) continue;
  el.addEventListener('input', applyLayoutNumeric);
  // Shift + ↑/↓ does a fine nudge (Position 0.001, Rotation 0.1°). Native number
  // inputs have no "fine step" modifier, so handle it ourselves; plain ↑/↓ keep
  // the coarse `step` from the markup (0.01 / 1).
  const isPos = key.startsWith('p');
  const fineStep = isPos ? 0.001 : 0.1;
  const decimals = isPos ? 3 : 1;
  el.addEventListener('keydown', (e) => {
    if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const cur = parseFloat(el.value) || 0;
    const next = cur + (e.key === 'ArrowUp' ? fineStep : -fineStep);
    el.value = next.toFixed(decimals);
    applyLayoutNumeric();
  });
}

// Reflect the overlay's current selection: pop up the numeric editor for the
// selected part, hide it when nothing is selected.
function onEditSelectionChange(partName) {
  if (editLayoutSelected) editLayoutSelected.textContent = partName || 'none';
  if (layoutPopup) layoutPopup.style.display = partName ? 'block' : 'none';
  if (partName) refreshLayoutNumeric();
}

if (editLayoutToggle) {
  editLayoutToggle.addEventListener('change', (e) => {
    const on = e.target.checked;
    layoutEditing = on; // suppress window-drag while editing
    if (overlay?.setEditMode) overlay.setEditMode(on);
    if (editLayoutHelp) editLayoutHelp.style.display = on ? '' : 'none';
    if (!on) onEditSelectionChange(null); // editing off → close the popup
  });
}

// Floating editor controls: close (×) deselects the part; "Reset this part"
// clears just its override. Both flow back through the overlay's select/layout
// handlers, which refresh the fields.
document.getElementById('lep-close')?.addEventListener('click', () => {
  overlay?.clearLayoutSelection?.();
});
document.getElementById('lep-reset-part')?.addEventListener('click', () => {
  overlay?.resetSelected?.();
  refreshLayoutNumeric();
});

// Let the user drag the popup by its header so it never blocks the part being
// edited. Window-drag is already suppressed while editing (layoutEditing), so
// this can't fight the OS window move.
(function makeLayoutPopupDraggable() {
  const handle = document.getElementById('lep-drag');
  if (!layoutPopup || !handle) return;
  let dragging = false, offX = 0, offY = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // the close button isn't a drag grip
    dragging = true;
    const r = layoutPopup.getBoundingClientRect();
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    layoutPopup.style.left = Math.max(0, e.clientX - offX) + 'px';
    layoutPopup.style.top = Math.max(0, e.clientY - offY) + 'px';
  });
  const stop = (e) => {
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
})();

if (layoutModeSelect) {
  layoutModeSelect.value = localStorage.getItem('overlay:layoutMode') || 'relative';
  layoutModeSelect.addEventListener('change', (e) => {
    localStorage.setItem('overlay:layoutMode', e.target.value);
    if (overlay?.setLayoutMode) overlay.setLayoutMode(e.target.value);
  });
}

if (resetLayoutBtn) {
  resetLayoutBtn.addEventListener('click', () => {
    if (overlay?.resetLayout) overlay.resetLayout();
    refreshLayoutNumeric(); // keep the popup in sync if a part is still selected
  });
}

driftModeSelect.addEventListener('change', (e) => {
  gravityMode = e.target.value;
  gyroFusion.gravityMode = GRAVITY_MODES[gravityMode] || 0;
});

if (yawReturnSelect) {
  yawReturnSelect.value = yawReturnMode;
  yawReturnSelect.addEventListener('change', (e) => {
    yawReturnMode = e.target.value;
    gyroFusion.yawReturnHalfLife = YAW_RETURN_MODES[yawReturnMode] ?? 0;
    localStorage.setItem('overlay:yawReturn', yawReturnMode);
  });
}

const recenterBtn = document.getElementById('recenter-btn');
if (recenterBtn) recenterBtn.addEventListener('click', recenterHeading);

// Pop out the movable Controllers list window (opaque panel — no green screen).
const ovlCtrlPopoutBtn = document.getElementById('ovl-ctrl-popout');
if (ovlCtrlPopoutBtn && window.electronAPI?.openHudWindow) {
  ovlCtrlPopoutBtn.addEventListener('click', () => {
    window.electronAPI.openHudWindow('controllers', currentControllerType, { on: false });
    // Gesture-backed serial scan: requestDevice needs user activation, so a boot
    // timer can't do it. This click IS a gesture — its select-hid-device handler
    // upserts EVERY present device's serial into the inventory the window shows.
    if (navigator.hid && navigator.userAgent.includes('Electron')) {
      navigator.hid.requestDevice({ filters: ControllerRegistry.getHIDFilters() }).catch(() => {});
    }
  });
}
// A row was clicked in the detached Controllers window → switch which controller
// drives this overlay (auto-model; the Model dropdown still overrides).
if (window.electronAPI?.onControllerSelect) {
  window.electronAPI.onControllerSelect((p) => { if (p && p.key) selectController(p.key); });
}

const opacitySlider = document.getElementById('opacity-slider');
const opacityValue = document.getElementById('opacity-value');
opacitySlider.addEventListener('input', (e) => {
  const pct = parseInt(e.target.value);
  opacityValue.textContent = pct + '%';
  overlay.setOpacity(pct / 100);
});

const bodyColorInput = document.getElementById('body-color');
const accentColorInput = document.getElementById('accent-color');
bodyColorInput.addEventListener('input', (e) => overlay.setBodyColor(e.target.value));
accentColorInput.addEventListener('input', (e) => overlay.setAccentColor(e.target.value));

// Surface shine (0 = matte). Persisted; applied on each model load too.
const shineSlider = document.getElementById('shine-slider');
if (shineSlider) {
  const savedShine = localStorage.getItem('overlay:shine');
  if (savedShine !== null) shineSlider.value = savedShine;
  if (overlay?.setShine) overlay.setShine(parseInt(shineSlider.value, 10) / 100);
  shineSlider.addEventListener('input', (e) => {
    localStorage.setItem('overlay:shine', e.target.value);
    if (overlay?.setShine) overlay.setShine(parseInt(e.target.value, 10) / 100);
  });
}

// ── Lean-band colors (Roll HUD): Normal / Mid / High ──
// leanColors drives leanColor() live, so the next frame re-renders the HUD.
[['lean-color-normal', 'normal', 'overlay:leanColorNormal'],
 ['lean-color-mid', 'mid', 'overlay:leanColorMid'],
 ['lean-color-high', 'high', 'overlay:leanColorHigh']].forEach(([id, key, ls]) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = leanColors[key];
  el.addEventListener('input', (e) => {
    leanColors[key] = e.target.value;
    localStorage.setItem(ls, e.target.value);
    // Normal is also the Roll HUD label/tick/band color — refresh the gauge.
    if (key === 'normal') applyRollLabelStyle();
  });
});

// ── Roll HUD label/tick brightness ──
// One slider dims the Roll HUD's static markings (band + ticks + degree
// labels) together; forwarded to the detached Roll window via its IPC state.
const rollLabelBrightSlider = document.getElementById('roll-label-brightness');
if (rollLabelBrightSlider) {
  rollLabelBrightSlider.value = String(Math.round(rollLabelBright * 100));
  rollLabelBrightSlider.addEventListener('input', (e) => {
    rollLabelBright = parseInt(e.target.value, 10) / 100;
    localStorage.setItem('overlay:rollLabelBrightness', e.target.value);
    applyRollLabelStyle();
  });
}

// ── Axis colors: Pitch / Roll / Yaw (CSS vars drive the readout; axisColors is
// forwarded to the detached Axis window) ──
function applyAxisColor(varName, value) { document.documentElement.style.setProperty(varName, value); }
[['axis-color-pitch', 'pitch', '--ax-pitch', 'overlay:axisColorPitch'],
 ['axis-color-roll', 'roll', '--ax-roll', 'overlay:axisColorRoll'],
 ['axis-color-yaw', 'yaw', '--ax-yaw', 'overlay:axisColorYaw']].forEach(([id, key, varName, ls]) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = axisColors[key];
  applyAxisColor(varName, axisColors[key]);
  el.addEventListener('input', (e) => {
    axisColors[key] = e.target.value;
    applyAxisColor(varName, e.target.value);
    localStorage.setItem(ls, e.target.value);
    // Keep the 3D gimbal rings in sync (the detached gyro window picks the
    // new colors up via the per-frame `colors` field in its IPC state).
    if (gimbal) gimbal.setRingColors(axisColors);
  });
});

// ── Green-screen background ────────────────────────────────────────────────
// Paints a solid keyable color behind the (otherwise transparent) overlay so
// it can be chroma-keyed in editing/OBS. Off by default. BASE_BG restores the
// normal look when toggled off: '' clears the inline style so the Electron
// window stays transparent; in the browser we fall back to the dim app bg.
const greenScreenToggle = document.getElementById('green-screen-toggle');
const greenScreenColorInput = document.getElementById('green-screen-color');
const BASE_BG = isDesktop ? '' : '#1a1a2e';
// Current green-screen state, shared with detached HUD windows.
function currentGreenScreen() {
  return { on: greenScreenToggle.checked, color: greenScreenColorInput.value };
}
function applyGreenScreen() {
  const on = greenScreenToggle.checked;
  document.body.style.background = on ? greenScreenColorInput.value : BASE_BG;
  localStorage.setItem('overlay:greenScreen', on ? '1' : '0');
  localStorage.setItem('overlay:greenScreenColor', greenScreenColorInput.value);
  // Mirror to any open detached HUD windows so they key the same.
  if (window.electronAPI?.sendHudGreenScreen) window.electronAPI.sendHudGreenScreen(currentGreenScreen());
}
{
  const savedColor = localStorage.getItem('overlay:greenScreenColor');
  if (savedColor) greenScreenColorInput.value = savedColor;
  greenScreenToggle.checked = localStorage.getItem('overlay:greenScreen') === '1';
  if (greenScreenToggle.checked) applyGreenScreen();
}
greenScreenToggle.addEventListener('change', applyGreenScreen);
greenScreenColorInput.addEventListener('input', applyGreenScreen);

// ── Type-a-color (#91) ────────────────────────────────────────────────────
// Every color setting is a native <input type="color"> (swatch-only). Let the
// user also type a value: accept hex (#RGB / #RRGGBB) or rgb(r,g,b) / rgba(...),
// normalize to #rrggbb, and on a valid parse write it back to the swatch and
// dispatch the swatch's 'input' event — so every existing per-picker apply +
// persist handler runs unchanged. Picker→text sync keeps the field current when
// the native swatch is used. Runs last so each swatch's value is already
// initialized from localStorage before we mirror it into the text field.
function normalizeColor(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  let m = v.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h;
  }
  m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/);
  if (m) {
    const c = [m[1], m[2], m[3]].map(Number);
    if (c.every((n) => n <= 255)) return '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

function attachColorText(colorInput) {
  const combo = document.createElement('span');
  combo.className = 'color-combo';
  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'color-text';
  text.spellcheck = false;
  text.autocomplete = 'off';
  text.setAttribute('aria-label', (colorInput.id || 'color') + ' hex or rgb value');
  text.value = colorInput.value;
  // Wrap the swatch: text field first, swatch second (CSS stacks them for the
  // grouped rows). Moving the swatch in the DOM keeps its event listeners.
  colorInput.parentNode.insertBefore(combo, colorInput);
  combo.appendChild(text);
  combo.appendChild(colorInput);

  const commit = () => {
    const hex = normalizeColor(text.value);
    if (!hex) { text.classList.add('invalid'); return; }
    text.classList.remove('invalid');
    text.value = hex;
    if (colorInput.value.toLowerCase() !== hex) {
      colorInput.value = hex;
      colorInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  text.addEventListener('change', commit);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); text.blur(); } });
  // Native swatch moved → reflect it in the text field.
  colorInput.addEventListener('input', () => {
    text.value = colorInput.value;
    text.classList.remove('invalid');
  });
}

document.querySelectorAll('#settings-panel input[type="color"]').forEach(attachColorText);

// Camera presets — one selected at a time, used as calibration view.
// Defaults to Top for every controller; the last-selected preset is persisted
// (issue #70) so reopening the overlay restores the user's preferred view
// instead of resetting to the default.
const CAMERA_PRESETS = ['front', 'back', 'left', 'right', 'player', 'top'];
const CAMERA_PRESET_KEY = 'overlay:cameraPreset';
function loadSavedCameraPreset() {
  const saved = localStorage.getItem(CAMERA_PRESET_KEY);
  return CAMERA_PRESETS.includes(saved) ? saved : 'top';
}
let selectedCameraPreset = loadSavedCameraPreset();
const cameraPresetBtns = document.querySelectorAll('.camera-presets button');

function selectCameraPreset(preset) {
  selectedCameraPreset = preset;
  try { localStorage.setItem(CAMERA_PRESET_KEY, preset); } catch (e) { /* ignore */ }
  if (overlay) overlay.setCameraPreset(preset);
  cameraPresetBtns.forEach(b => {
    b.classList.toggle('selected', b.dataset.preset === preset);
  });
}

cameraPresetBtns.forEach((btn) => {
  btn.addEventListener('click', () => selectCameraPreset(btn.dataset.preset));
});

// Apply the saved (or default) selection — overlay may not be ready yet, in
// which case this just highlights the button; init() re-applies it to the 3D
// view once the overlay exists.
selectCameraPreset(selectedCameraPreset);

// ── Window size fields (issue #69 follow-up) ──
// Two numeric inputs in the settings panel mirror the live overlay window
// size: they update as the user drag-resizes the window, and typing a value
// resizes the window to match. Electron-only (the web build has no window to
// resize), so the whole block no-ops when electronAPI is absent.
const windowWidthInput = document.getElementById('window-width');
const windowHeightInput = document.getElementById('window-height');
if (windowWidthInput && windowHeightInput && window.electronAPI?.getWindowSize) {
  let suppressSizeApply = false; // guard against echo while we set field values

  const setSizeFields = ({ width, height }) => {
    suppressSizeApply = true;
    // Don't stomp on a field the user is mid-edit in.
    if (document.activeElement !== windowWidthInput) windowWidthInput.value = width;
    if (document.activeElement !== windowHeightInput) windowHeightInput.value = height;
    suppressSizeApply = false;
  };

  // Seed the fields with the current size.
  window.electronAPI.getWindowSize().then((size) => { if (size) setSizeFields(size); });

  // Track live drag-resizes from the main process.
  window.electronAPI.onWindowSizeChanged?.((size) => { if (size) setSizeFields(size); });

  // Push edits to the window. 'change' (commit on blur/Enter) keeps us from
  // resizing on every intermediate keystroke; the main process clamps to
  // 200–8000 px so an out-of-range value can't break the window.
  const applySize = () => {
    if (suppressSizeApply) return;
    const w = parseInt(windowWidthInput.value, 10);
    const h = parseInt(windowHeightInput.value, 10);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      window.electronAPI.setWindowSize?.(w, h);
    }
  };
  windowWidthInput.addEventListener('change', applySize);
  windowHeightInput.addEventListener('change', applySize);
} else if (windowWidthInput) {
  // No window to resize (web build) — hide the row so it isn't a dead control.
  const row = windowWidthInput.closest('.setting-row');
  if (row) row.style.display = 'none';
}

// ── Window display toggles (cosmetic only — never affects functionality) ──
const showTitleCheck = document.getElementById('show-title');
const showGyroCheck = document.getElementById('show-gyro');
const showGearCheck = document.getElementById('show-gear');
const showGyroHudCheck = document.getElementById('show-gyro-hud');
const gyroHudFullCheck = document.getElementById('gyro-hud-full-mode');
const showRollHudCheck = document.getElementById('show-roll-hud');
const showAxisReadoutCheck = document.getElementById('show-axis-readout');
const showButtonHudCheck = document.getElementById('show-button-hud');
const buttonHudPositionSelect = document.getElementById('button-hud-position');
const detachButtonHudBtn = document.getElementById('detach-button-hud');
const axPitchVal = document.getElementById('ax-pitch-val');
const axRollVal = document.getElementById('ax-roll-val');
const axYawVal = document.getElementById('ax-yaw-val');

const DISPLAY_PREFS_KEY = 'overlay-display-prefs';
try {
  const saved = JSON.parse(localStorage.getItem(DISPLAY_PREFS_KEY) || '{}');
  // Back-compat: the Gyro HUD prefs were `gimbal`/`gimbalFull` before the rename.
  const gyroHudPref = typeof saved.gyroHud === 'boolean' ? saved.gyroHud : saved.gimbal;
  if (typeof gyroHudPref === 'boolean') showGyroHudCheck.checked = gyroHudPref;
  const gyroHudFullPref = typeof saved.gyroHudFull === 'boolean' ? saved.gyroHudFull : saved.gimbalFull;
  if (typeof gyroHudFullPref === 'boolean') gyroHudFullCheck.checked = gyroHudFullPref;
  if (typeof saved.rollHud === 'boolean') showRollHudCheck.checked = saved.rollHud;
  if (typeof saved.axisReadout === 'boolean') showAxisReadoutCheck.checked = saved.axisReadout;
  if (typeof saved.buttonHud === 'boolean') showButtonHudCheck.checked = saved.buttonHud;
  if (typeof saved.buttonHudPos === 'string') buttonHudPositionSelect.value = saved.buttonHudPos;
} catch (e) { /* ignore */ }

function applyDisplayToggles() {
  document.body.classList.toggle('show-title', showTitleCheck.checked);
  document.body.classList.toggle('show-gyro', showGyroCheck.checked);
  document.body.classList.toggle('show-gear', showGearCheck.checked);
  document.body.classList.toggle('show-gyro-hud', showGyroHudCheck.checked);
  document.body.classList.toggle('hide-roll-hud', !showRollHudCheck.checked);
  document.body.classList.toggle('show-axis-readout', showAxisReadoutCheck.checked);
  document.body.classList.toggle('show-button-hud', showButtonHudCheck.checked);
  // Position class: prefix `pos-` and the selected value (bottom-left etc.)
  const buttonHud = document.getElementById('button-hud');
  if (buttonHud) {
    buttonHud.classList.remove('pos-bottom-left', 'pos-bottom-right', 'pos-top-left', 'pos-top-right');
    buttonHud.classList.add('pos-' + (buttonHudPositionSelect.value || 'bottom-left'));
  }
  if (showGyroHudCheck.checked) ensureGimbal();
  if (gimbal) gimbal.fullMode = gyroHudFullCheck.checked;
  try {
    localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify({
      gyroHud: showGyroHudCheck.checked,
      gyroHudFull: gyroHudFullCheck.checked,
      rollHud: showRollHudCheck.checked,
      axisReadout: showAxisReadoutCheck.checked,
      buttonHud: showButtonHudCheck.checked,
      buttonHudPos: buttonHudPositionSelect.value,
    }));
  } catch (e) { /* ignore */ }
}

let gimbal = null;
function ensureGimbal() {
  if (gimbal) return;
  const gimbalCanvas = document.getElementById('gyro-hud-canvas');
  if (!gimbalCanvas) return;
  gimbal = new GyroGimbal(gimbalCanvas);
  gimbal.setRingColors(axisColors); // rings track the Axis (Pitch/Roll/Yaw) colors
  new ResizeObserver(() => gimbal.resize()).observe(gimbalCanvas);
}

showTitleCheck.addEventListener('change', applyDisplayToggles);
showGyroCheck.addEventListener('change', applyDisplayToggles);
showGearCheck.addEventListener('change', applyDisplayToggles);
showGyroHudCheck.addEventListener('change', applyDisplayToggles);
gyroHudFullCheck.addEventListener('change', applyDisplayToggles);
showRollHudCheck.addEventListener('change', applyDisplayToggles);
showAxisReadoutCheck.addEventListener('change', applyDisplayToggles);
showButtonHudCheck.addEventListener('change', applyDisplayToggles);
buttonHudPositionSelect.addEventListener('change', applyDisplayToggles);
// Detach a HUD into its own draggable window. When already open the IPC
// handler focuses the existing window and re-sends the current profile, so
// clicking again is harmless.
function wireDetachButton(btnId, kind) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!window.electronAPI?.openHudWindow) return;
    await window.electronAPI.openHudWindow(kind, currentControllerType, currentGreenScreen());
  });
}
wireDetachButton('detach-button-hud', 'button');
wireDetachButton('detach-gyro-hud', 'gyro');
wireDetachButton('detach-axis-hud', 'axis');
wireDetachButton('detach-roll-hud', 'roll');
applyDisplayToggles(); // apply defaults (all unchecked = all hidden)

// Right-click opens settings (needed when gear icon is hidden). Plain
// right-click is silently ignored while a Puck is connected — the lizard-mode
// firmware fires phantom right-clicks at unpredictable intervals that no
// rate-limit can hold off. CTRL+Right-Click is whitelisted past that guard, so
// it always opens settings even with a Puck connected and the gear hidden.
window.addEventListener('contextmenu', (e) => {
  if (settingsPanel.contains(e.target)) return;
  e.preventDefault();
  toggleSettings(e.ctrlKey ? 'ctrl-contextmenu' : 'contextmenu');
});

if (window.electronAPI) {
  window.electronAPI.onClickThroughChanged((isClickThrough) => {
    clickThroughIndicator.classList.toggle('active', !isClickThrough);
    // Click-through enabled is a deliberate window-mode change; always
    // close the panel so it doesn't get stuck visible under a hover-
    // transparent window. Bypasses the Puck whitelist intentionally.
    if (isClickThrough) settingsPanel.classList.remove('visible');
  });
  window.electronAPI.onToggleSettings(() => {
    toggleSettings('ipc');
  });
}

// ── Window dragging (frameless overlay) ──────────────────────────────────
// Grabbing any non-interactive part of the window — the 3D view, the
// background, the no-controller splash, or the title bar — repositions the
// whole window. The move itself runs in the main process (preload exposes
// windowDrag*), which reads the live cursor for DPI-correct, smooth tracking.
//
// We deliberately avoid CSS -webkit-app-region: drag: on a transparent
// frameless window it's inconsistent across platforms, swallows clicks on
// child elements, and double-click maximizes the overlay. Doing it manually
// also lets us exclude interactive controls so dragging never competes with
// using them — in particular the gear button and settings panel always
// respond to clicks normally.
(function wireWindowDrag() {
  const api = window.electronAPI;
  if (!api?.windowDragStart) return; // web build: there's no window to move

  // A pointerdown on any of these (or their descendants) is a real click,
  // not a drag — let it through untouched.
  const INTERACTIVE_SELECTOR = [
    '#settings-toggle', '#settings-panel', '#gyro-toggle',
    '#puck-status-banner', '#exit-confirm', '#test-report-modal',
    'button', 'input', 'select', 'textarea', 'a', 'label',
  ].join(',');

  // Track click-through so we never try to drag while the window is set to
  // ignore mouse events. (pointerdown wouldn't fire then anyway, but be safe.)
  let clickThrough = false;
  api.onClickThroughChanged?.((val) => { clickThrough = val; });

  let dragging = false;
  let movePending = false;

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.documentElement.classList.remove('is-dragging');
    api.windowDragEnd();
  }

  window.addEventListener('pointerdown', (e) => {
    // Left button only — right-click still opens settings (contextmenu).
    if (e.button !== 0 || clickThrough) return;
    // CTRL+Left is an escape hatch: grab and move the window from ANYWHERE,
    // even over interactive controls or while editing layout — a reliable way
    // to reposition the overlay when the normal grab areas are covered.
    if (!e.ctrlKey) {
      // While editing the float layout, click-drag positions parts — never
      // move the window (otherwise the OS window-move eats the drag).
      if (layoutEditing) return;
      if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) return;
    }

    dragging = true;
    document.documentElement.classList.add('is-dragging');
    api.windowDragStart();
    // Keep receiving pointermove even if the cursor briefly outruns the window.
    if (e.target instanceof Element) {
      try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
    }
  });

  // Coalesce moves to one IPC per frame; main reads the cursor each time.
  window.addEventListener('pointermove', () => {
    if (!dragging || movePending) return;
    movePending = true;
    requestAnimationFrame(() => {
      movePending = false;
      if (dragging) api.windowDragMove();
    });
  });

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
})();

// ────────────────────────────────────────────────────────────
// TEST REPORT — guided HID capture wizard
// ────────────────────────────────────────────────────────────
//
// The button opens a modal that walks the user through eight scripted
// capture steps (defined in test-report.js). For each step we tap the
// inputreport stream of `hidDevice` for the step's duration, then
// assemble a JSON document at the end and hand it to Electron's save
// dialog. Lives in app.js (not a separate module) only because the
// wizard needs access to the connected hidDevice + controllerDriver,
// which are renderer-scoped state.

(function wireTestReport() {
  const btn = document.getElementById('btn-capture-report');
  const modal = document.getElementById('test-report-modal');
  const titleEl = document.getElementById('tr-step-title');
  const promptTitleEl = document.getElementById('tr-step-prompt-title');
  const promptEl = document.getElementById('tr-step-prompt');
  const progressEl = document.getElementById('tr-progress');
  const deviceLineEl = document.getElementById('tr-device-line');
  const statusEl = document.getElementById('tr-status');
  const cancelBtn = document.getElementById('tr-cancel');
  const skipBtn = document.getElementById('tr-skip');
  const primaryBtn = document.getElementById('tr-primary');
  const aliasRow = document.getElementById('tr-alias-row');
  const aliasInput = document.getElementById('tr-alias');
  const noteInput = document.getElementById('tr-note');

  if (!btn) return; // markup missing — fail quietly so we don't break the rest of the overlay

  let state = null; // { stepIndex, results, cancelled }

  function setStatus(msg, level = '') {
    statusEl.className = 'status' + (level ? ' ' + level : '');
    statusEl.textContent = msg;
  }
  function showDeviceLine() {
    if (!hidDevice) { deviceLineEl.textContent = ''; return; }
    const vid = hidDevice.vendorId.toString(16).padStart(4, '0');
    const pid = hidDevice.productId.toString(16).padStart(4, '0');
    deviceLineEl.innerHTML = `<strong>device</strong> ${hidDevice.productName || '(unnamed)'} &nbsp; <strong>vid:pid</strong> ${vid}:${pid}`;
  }
  // ── Spoof-picker phase ──
  // When the connected vid:pid matches multiple dictionary entries
  // (typically a real Sony/Nintendo and one or more clones spoofing the
  // same USB identity), show the user a chooser so we record which
  // physical pad is plugged in. Also lets the user opt into "Unknown
  // controller" for pads that aren't in the dictionary yet.
  function showPicker(entries) {
    titleEl.textContent = 'Which controller is this?';
    promptTitleEl.textContent = `Multiple known controllers report vid:pid ${hidDevice.vendorId.toString(16).padStart(4,'0')}:${hidDevice.productId.toString(16).padStart(4,'0')}`;
    let html = '<p style="color:#ccc; margin-bottom:10px;">We can\'t auto-distinguish these at the USB level. Pick the one you actually have plugged in:</p>';
    for (const e of entries) {
      const spoofNote = e.spoofs ? ` <span style="color:#fa6;">(clone of ${e.spoofs.of})</span>` : '';
      const noteLine = e.notes ? `<div style="color:#888;font-size:11px;margin-top:2px;">${e.notes}</div>` : '';
      html += `<button class="tr-picker-btn" data-entry-name="${e.name.replace(/"/g, '&quot;')}" style="display:block;width:100%;text-align:left;margin-bottom:6px;padding:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#eee;cursor:pointer;font-size:12px;">
        <strong>${e.name}</strong>${spoofNote}
        ${noteLine}
      </button>`;
    }
    html += `<button class="tr-picker-btn" data-entry-name="__unknown__" style="display:block;width:100%;text-align:left;margin-bottom:6px;padding:10px;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.18);border-radius:6px;color:#bbb;cursor:pointer;font-size:12px;font-style:italic;">
      <strong>Unknown / something else</strong>
      <div style="color:#888;font-size:11px;margin-top:2px;font-style:normal;">Use this if you don't recognize any of the above — runs the full step list and labels the report as unknown.</div>
    </button>`;
    promptEl.innerHTML = html;
    progressEl.style.width = '0%';
    aliasRow.style.display = 'none';
    skipBtn.style.display = 'none';
    primaryBtn.style.display = 'none';      // picker uses inline buttons
    setStatus('');
    state.phase = 'pick-device';
    // Wire each option to selectEntry()
    promptEl.querySelectorAll('.tr-picker-btn').forEach(b => {
      b.addEventListener('click', () => {
        const pickedName = b.getAttribute('data-entry-name');
        const picked = pickedName === '__unknown__'
          ? null
          : entries.find(x => x.name === pickedName);
        selectEntry(picked);
      });
    });
  }

  function selectEntry(entry) {
    state.entry = entry;
    state.allSteps = entry ? stepsForEntry(entry) : stepsForEntry(null);
    primaryBtn.style.display = '';
    showFeatureSelect();
  }

  // Feature-area checklist shown before capture so the user can test only
  // specific features (e.g. just gyro, or just buttons) in a single run.
  function showFeatureSelect() {
    state.phase = 'select-features';
    titleEl.textContent = 'Capture HID Report — choose what to test';
    promptTitleEl.textContent = 'Select features to capture';
    const areas = areasForSteps(state.allSteps);
    let html = '<p style="color:#ccc;margin-bottom:10px;">Uncheck anything you don\'t want to capture this run.</p>';
    for (const a of areas) {
      const n = state.allSteps.filter((s) => (STEP_AREAS[s.id] || 'other') === a).length;
      html += `<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;cursor:pointer;color:#eee;font-size:13px;">
        <input type="checkbox" class="tr-area-cb" value="${a}" checked style="width:16px;height:16px;flex:none;">
        <span>${AREA_LABELS[a] || a} <span style="color:#888;">(${n} step${n > 1 ? 's' : ''})</span></span>
      </label>`;
    }
    html += '<div style="margin-top:8px;font-size:11px;"><button id="tr-area-all" style="background:none;border:none;color:#9ad;cursor:pointer;text-decoration:underline;">select all</button> · <button id="tr-area-none" style="background:none;border:none;color:#9ad;cursor:pointer;text-decoration:underline;">select none</button></div>';
    promptEl.innerHTML = html;
    progressEl.style.width = '0%';
    aliasRow.style.display = 'none';
    skipBtn.style.display = 'none';
    primaryBtn.style.display = '';
    primaryBtn.textContent = 'Start testing';
    primaryBtn.disabled = false;
    const setAll = (v) => promptEl.querySelectorAll('.tr-area-cb').forEach((cb) => { cb.checked = v; });
    promptEl.querySelector('#tr-area-all')?.addEventListener('click', () => setAll(true));
    promptEl.querySelector('#tr-area-none')?.addEventListener('click', () => setAll(false));
    setStatus('All areas selected by default.');
  }

  function applySelectionAndStart() {
    const checked = Array.from(promptEl.querySelectorAll('.tr-area-cb:checked')).map((cb) => cb.value);
    if (checked.length === 0) { setStatus('Select at least one area to test.', 'error'); return; }
    state.activeSteps = filterStepsByAreas(state.allSteps, new Set(checked));
    state.stepIndex = 0;
    state.results = [];
    showStep(0);
  }

  function showStep(idx) {
    const step = state.activeSteps[idx];
    const total = state.activeSteps.length;
    titleEl.textContent = `Capture HID Report — Step ${idx + 1} of ${total}`;
    promptTitleEl.textContent = step.title;
    promptEl.textContent = step.prompt;
    progressEl.style.width = `${(idx / total) * 100}%`;
    aliasRow.style.display = 'none';
    skipBtn.style.display = step.optional ? '' : 'none';
    skipBtn.textContent = 'Skip';
    primaryBtn.textContent = 'Start';
    primaryBtn.disabled = false;
    setStatus('');
    state.phase = 'step';
  }
  function showSummary(savedPath) {
    titleEl.textContent = 'Capture complete';
    promptTitleEl.textContent = 'Done';
    const totalReports = state.results.reduce((n, r) => n + (r.reports?.length || 0), 0);
    promptEl.innerHTML = `Captured <strong>${totalReports}</strong> reports across ${state.results.length} steps.${savedPath ? `<br>Saved to:<br><code style="font-size:11px;color:#9ad;word-break:break-all;">${savedPath}</code>` : ''}`;
    progressEl.style.width = '100%';
    skipBtn.style.display = 'none';
    primaryBtn.textContent = 'Close';
    primaryBtn.disabled = false;
  }
  function close() {
    modal.classList.remove('visible');
    aliasRow.style.display = 'none';
    primaryBtn.style.display = '';   // restore in case picker hid it
    state = null;
  }

  // ── Countdown helper: 3-2-1-GO before each step starts recording ──
  // Gives the user a beat to get into position so the prompt isn't already
  // ticking while they're still reading it. Returns when "GO" finishes.
  async function countdown(stepNumber, stepTotal) {
    for (const n of [3, 2, 1]) {
      setStatus(`Step ${stepNumber}/${stepTotal} starts in ${n}…`);
      await new Promise(r => setTimeout(r, 700));
      if (state.cancelled) return false;
    }
    setStatus('GO — recording now.', 'success');
    return true;
  }

  function advanceAfterStep() {
    state.stepIndex++;
    if (state.cancelled) return; // user clicked Cancel during recording
    if (state.stepIndex >= state.activeSteps.length) showNamingPrompt();
    else showStep(state.stepIndex);
  }

  // An IMU step failed the quality gate — let the user redo it (recommended)
  // or keep the sub-par data anyway.
  function showRedo(verdict) {
    state.phase = 'redo';
    primaryBtn.textContent = 'Redo step';
    primaryBtn.disabled = false;
    skipBtn.style.display = '';
    skipBtn.textContent = 'Keep anyway';
    setStatus(`✗ ${verdict.message}`, 'error');
  }

  async function runCurrentStep() {
    const step = state.activeSteps[state.stepIndex];
    primaryBtn.disabled = true;
    skipBtn.style.display = 'none';

    const ok = await countdown(state.stepIndex + 1, state.activeSteps.length);
    if (!ok) return;

    // Animate the progress bar across this step's duration + show live count
    const stepStart = performance.now();
    const baseProgress = (state.stepIndex / state.activeSteps.length) * 100;
    const stepShare = (1 / state.activeSteps.length) * 100;
    let liveCount = 0;
    const onLive = () => { liveCount++; };
    hidDevice.addEventListener('inputreport', onLive);
    const ticker = setInterval(() => {
      const elapsed = performance.now() - stepStart;
      const frac = Math.min(1, elapsed / step.durationMs);
      const secsLeft = Math.max(0, Math.ceil((step.durationMs - elapsed) / 1000));
      progressEl.style.width = `${baseProgress + stepShare * frac}%`;
      setStatus(`Recording… ${secsLeft}s left · ${liveCount} reports captured`, 'success');
    }, 100);

    let reports = null;
    try {
      reports = await recordStep(hidDevice, step.durationMs);
    } catch (err) {
      state.results[state.stepIndex] = { step, reports: [], error: err.message };
      setStatus('Capture failed: ' + err.message, 'error');
    } finally {
      clearInterval(ticker);
      hidDevice.removeEventListener('inputreport', onLive);
    }
    if (state.cancelled) return;
    if (reports === null) { advanceAfterStep(); return; } // capture errored

    // Quality gate: IMU steps (those requiring 'gyro') are validated at
    // capture time so a weak/multi-axis/not-still capture is caught and
    // re-done before saving. Non-IMU steps pass straight through.
    const isImuStep = step.requires?.includes('gyro');
    let quality = null;
    if (isImuStep && controllerDriver) {
      const { samples, accelScale } = parseImuSamples(reports, controllerDriver);
      quality = analyzeImuStep(step.id, samples, accelScale);
    }
    state.results[state.stepIndex] = { step, reports, quality };

    if (quality && !quality.ok) {
      showRedo(quality); // stay on this step
      return;
    }
    setStatus(quality
      ? `✓ ${quality.message}`
      : `Captured ${reports.length} reports for "${step.id}". Click Start for the next step.`, 'success');
    advanceAfterStep();
  }

  // After all steps captured, show a naming prompt so the user can label
  // the controller (filename + JSON field) and add a free-text note (e.g.
  // "skipped touchpad — back paddles instead"). Defaults the alias to the
  // device's productName so a 'just hit Save' flow still produces a
  // reasonable filename.
  function showNamingPrompt() {
    titleEl.textContent = 'Capture complete — name and save';
    promptTitleEl.textContent = 'Name this controller';
    promptEl.textContent = `All ${state.results.length} steps captured. Give the controller a short name (used in the filename and embedded in the JSON), optionally add a note, then click Save to choose where to drop the file.`;
    progressEl.style.width = '100%';
    deviceLineEl.innerHTML = deviceLineEl.innerHTML; // keep device line visible
    aliasRow.style.display = '';
    aliasInput.value = hidDevice.productName || '';
    noteInput.value = '';
    skipBtn.style.display = 'none';
    primaryBtn.textContent = 'Save';
    primaryBtn.disabled = false;
    setStatus(`Ready to save. ${state.results.reduce((n, r) => n + (r.reports?.length || 0), 0)} reports across ${state.results.length} steps.`, 'success');
    state.phase = 'naming';
    setTimeout(() => aliasInput.focus(), 50);
  }

  async function finalizeAndExport() {
    primaryBtn.disabled = true;
    setStatus('Building report…');
    const gpId = (() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp) continue;
        const m = ControllerRegistry.parseGamepadVendorProduct(gp.id);
        if (m && m.vendorId === hidDevice.vendorId && m.productId === hidDevice.productId) return gp.id;
      }
      return null;
    })();
    const alias = (aliasInput.value || '').trim() || null;
    const userNote = (noteInput.value || '').trim() || null;
    const report = buildReport({
      device: hidDevice,
      gamepadId: gpId,
      connectionType: controllerDriver?.connectionType || null,
      results: state.results,
      alias,
      userNote,
      pickedEntry: state.entry,   // user's spoof-picker choice (or null)
    });

    setStatus('Saving report…');
    let result;
    try {
      result = await exportReport(report);
    } catch (err) {
      setStatus('Export failed: ' + err.message, 'error');
      primaryBtn.textContent = 'Close';
      primaryBtn.disabled = false;
      state.phase = 'done';
      return;
    }
    if (result.saved) {
      aliasRow.style.display = 'none';
      showSummary(result.path);
      state.phase = 'done';
    } else if (result.reason === 'cancelled') {
      // Save dialog cancelled — keep the naming prompt up so they can retry.
      setStatus('Save cancelled. Edit the name if you like, then click Save again — or Cancel to discard.', 'error');
      primaryBtn.textContent = 'Save';
      primaryBtn.disabled = false;
    } else {
      setStatus(result.reason || 'Save failed.', 'error');
      primaryBtn.textContent = 'Save';
      primaryBtn.disabled = false;
    }
  }

  btn.addEventListener('click', () => {
    if (!hidDevice) {
      setStatus('No HID device connected. Plug in the controller, click "Gyro: Connect" first, then retry.', 'error');
      modal.classList.add('visible');
      titleEl.textContent = 'Capture HID Report';
      promptTitleEl.textContent = 'No device';
      promptEl.textContent = 'The wizard needs a connected HID device to tap input reports. Open the gyro flow first to grant WebHID permission, then re-open this dialog.';
      progressEl.style.width = '0%';
      deviceLineEl.textContent = '';
      skipBtn.style.display = 'none';
      primaryBtn.textContent = 'Close';
      return;
    }
    state = {
      stepIndex: 0,
      results: [],
      cancelled: false,
      phase: 'step',
      entry: null,
      activeSteps: [],
    };
    modal.classList.add('visible');
    showDeviceLine();
    // If multiple dictionary entries claim this vid:pid (clone spoofing),
    // ask the user which one is plugged in before running the wizard.
    const allEntries = ControllerRegistry.getAllEntries(hidDevice.vendorId, hidDevice.productId);
    if (allEntries.length > 1) {
      showPicker(allEntries);
    } else {
      selectEntry(allEntries[0] || null);  // null = unknown controller, all steps
    }
  });

  primaryBtn.addEventListener('click', () => {
    if (!state) { close(); return; }
    if (state.phase === 'pick-device') return;  // picker uses inline buttons
    if (state.phase === 'select-features') { applySelectionAndStart(); return; }
    if (state.phase === 'naming') { finalizeAndExport(); return; }
    if (state.phase === 'done')   { close(); return; }
    if (state.stepIndex >= state.activeSteps.length) { close(); return; } // safety
    runCurrentStep();   // handles both 'step' and 'redo' (re-runs same index)
  });

  skipBtn.addEventListener('click', () => {
    if (!state) return;
    if (state.phase === 'redo') {
      // Keep the just-captured (sub-par) data and advance.
      skipBtn.textContent = 'Skip';
      advanceAfterStep();
      return;
    }
    const step = state.activeSteps[state.stepIndex];
    state.results[state.stepIndex] = { step, reports: [], skipped: true };
    advanceAfterStep();
  });

  cancelBtn.addEventListener('click', () => {
    if (state) state.cancelled = true;
    close();
  });
})();

// ── Start ──
updateRemapUI(); // populate combo labels from saved/default settings
init();
