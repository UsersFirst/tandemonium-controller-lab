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
import { ControllerRegistry, SensorFusion, analyzeImuStep } from '@usersfirst/controller-core';
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
const gamepadStatusEl = document.getElementById('gamepad-status');
// Gyro status shown via the gyro toggle button (no separate text badge)
const gyroToggleBtn = document.getElementById('gyro-toggle');
const clickThroughIndicator = document.getElementById('click-through-indicator');
const noControllerSplash = document.getElementById('no-controller');
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
const gyroFusion = new SensorFusion();
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
}

function leanColor(t) {
  // t: 0 (center) to 1 (max lean)
  const abs = Math.min(1, Math.abs(t));
  if (abs < 0.5) return '#ffffff';
  if (abs < 0.75) return '#ffaa22';
  return '#ff4444';
}

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
  // Forward profile to the popout regardless of whether this profile has
  // hudLabels — popout uses the profile name + falls back to defaults too.
  // IPC handler in main is a no-op when no popout is open.
  if (window.electronAPI?.updateButtonHudProfile) {
    window.electronAPI.updateButtonHudProfile(profileKey);
  }
  if (!profile?.hudLabels) return;
  const labels = profile.hudLabels;
  // Buttons: data-btn elements get their textContent swapped to the
  // profile's label for that gamepad index.
  document.querySelectorAll('#button-hud [data-btn]').forEach(el => {
    const idx = Number(el.getAttribute('data-btn'));
    if (labels[idx] !== undefined) el.textContent = labels[idx];
  });
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
         dot:  document.querySelector('#button-hud [data-stick="l"] .bh-stick-dot') },
    r: { wrap: document.querySelector('#button-hud [data-stick="r"]'),
         dot:  document.querySelector('#button-hud [data-stick="r"] .bh-stick-dot') },
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
  if (refs.sticks.l.dot) {
    const x = (axes[0] || 0) * STICK_RADIUS_PCT;
    const y = (axes[1] || 0) * STICK_RADIUS_PCT;
    refs.sticks.l.dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }
  if (refs.sticks.r.dot) {
    const x = (axes[2] || 0) * STICK_RADIUS_PCT;
    const y = (axes[3] || 0) * STICK_RADIUS_PCT;
    refs.sticks.r.dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }
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

  if (overlay.setGripVisible) overlay.setGripVisible(gripVizEnabled); // apply saved grip-display pref
  const _gripB = localStorage.getItem('overlay:gripBrightness');
  if (_gripB !== null && overlay.setGripBrightness) overlay.setGripBrightness(parseInt(_gripB, 10) / 100);
  const _hl = localStorage.getItem('overlay:highlightColor');
  if (_hl && overlay.setGripColor) overlay.setGripColor(_hl); // shared highlight color (#45)

  if (hasGamepad) {
    currentControllerType = initialType;
    modelReady = true;
    noControllerSplash.classList.add('hidden');
  } else {
    // No gamepad — hide the 3D model, show splash
    overlay.setVisible(false);
    modelReady = false;
  }
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

  requestAnimationFrame(loop);

  // Check for already-connected gamepad (may have connected before
  // our event listeners were attached). Same approach as the game's
  // pollGamepad() fallback in input-manager.js.
  const foundViaGamepadAPI = checkForExistingGamepad();

  // If the Gamepad API has nothing, fall back to probing WebHID directly.
  // This recovers the cold-start case where a DualSense is still in 0x31
  // full-report mode from a previous session — Gamepad API is blind to it,
  // but navigator.hid.getDevices() still lists the granted device.
  if (!foundViaGamepadAPI) {
    bootstrapFromHID();
  }
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
    if (gamepads[i]) {
      console.log('Found existing gamepad at startup:', gamepads[i].id);
      switchController(gamepads[i]);
      return true;
    }
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
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
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

async function switchController(gamepad) {
  if (switchingController) return;
  switchingController = true;

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
    gamepadIndex = gamepad.index;
    gamepadStatusEl.textContent = gamepad.id.slice(0, 30);
    gamepadStatusEl.classList.add('connected');

    // Show gyro toggle and auto-connect if controller supports gyro
    const info = ControllerRegistry.identifyFromGamepadId(gamepad.id);
    if (navigator.hid && info?.hasGyro) {
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

// ── Gamepad events ──

window.addEventListener('gamepadconnected', (e) => {
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
  // 2-second delay: Switch Pro needs time for USB enumeration + HID readiness.
  // The driver's init() has its own internal retries and delays for sub-commands.
  gyroConnectTimer = setTimeout(async () => {
    gyroConnectTimer = null;
    if (gamepadIndex === null) return;
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
  }, 2000);
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
  let device;

  // Step 1: check previously-granted devices
  console.log('connectControllerGyro: trying getDevices()...');
  try {
    const granted = await navigator.hid.getDevices();
    console.log('connectControllerGyro: getDevices returned', granted.length, 'device(s)');
    for (const d of granted) {
      const entry = ControllerRegistry.getEntry(d.vendorId, d.productId);
      if (entry && entry.capabilities.gyro) {
        device = d;
        console.log('connectControllerGyro: found granted device:', d.productName);
        break;
      }
    }
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

  console.log('connectControllerGyro: connecting to', device.productName,
    'vid:' + device.vendorId.toString(16), 'pid:' + device.productId.toString(16));

  // Clean up old device if any
  if (hidDevice) {
    hidDevice.removeEventListener('inputreport', handleInputReport);
    try { await hidDevice.close(); } catch (e) { /* ok */ }
    hidDevice = null;
    for (const sib of hidExtraDevices) {
      sib.removeEventListener('inputreport', handleInputReport);
      try { await sib.close(); } catch (e) { /* ok */ }
    }
    hidExtraDevices = [];
    if (controllerDriver?.destroy) controllerDriver.destroy();
    controllerDriver = null;
  }

  controllerDriver = await ControllerRegistry.connect(device);
  hidDevice = controllerDriver.device;
  hidDevice.addEventListener('inputreport', handleInputReport);

  // Multi-interface fan-out: requestDevice returns ONE HIDDevice, but
  // some controllers (Steam Controller Puck) expose multiple interfaces
  // sharing a vid:pid where only one emits the STATE reports we care
  // about. Attach handleInputReport to every already-approved sibling
  // with the same vid:pid so the active one drives the synthetic gamepad
  // regardless of which the picker handed us. Generic logic — for
  // DualSense / Switch Pro the usagePage filter in getHIDFilters keeps
  // siblings out of the approval list, so this is a no-op there.
  hidExtraDevices = [];
  try {
    const approved = await navigator.hid.getDevices();
    const siblings = approved.filter((d) =>
      d !== hidDevice && d.vendorId === hidDevice.vendorId && d.productId === hidDevice.productId
    );
    for (const sib of siblings) {
      try {
        if (!sib.opened) await sib.open();
        sib.addEventListener('inputreport', handleInputReport);
        hidExtraDevices.push(sib);
      } catch (err) {
        console.log('inputreport fan-out: skipping', sib.productName, '—', err.message);
      }
    }
    if (hidExtraDevices.length > 0) {
      console.log(`inputreport fan-out: listening on ${hidExtraDevices.length} extra HID handle(s) for ${hidDevice.productName}`);
    }
  } catch (err) {
    console.log('inputreport fan-out: getDevices failed —', err.message);
  }

  gyroActive = true;
  gyroPermitted = true;
  connectGyroBtn.textContent = 'Connected';
  updateGyroToggle();
  showGyroHud();
  console.log('Gyro connected:', device.productName);

  if (isPuckDevice(device)) onPuckConnected();
  else onPuckDisconnected();

  startCalibration();

  // The driver's init() has run an IMU-layout probe (PlayStation family
  // only, for now) and set _detectedImuFamily if a wire-level signature
  // matched a known family. When this disagrees with the profile we
  // loaded a moment ago against gamepad.id alone — e.g. we loaded
  // 'dualsense' because that's the first 054c:09cc match, but the
  // pad is actually a GameSir clone — swap the visualizer to the
  // family-matched entry's profile. Honors the dropdown override so
  // an explicit user choice isn't undone.
  maybeSwapProfileAfterImuProbe();
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
  if (hidDevice) {
    hidDevice.removeEventListener('inputreport', handleInputReport);
    try { await hidDevice.close(); } catch (e) { /* ok */ }
    hidDevice = null;
    for (const sib of hidExtraDevices) {
      sib.removeEventListener('inputreport', handleInputReport);
      try { await sib.close(); } catch (e) { /* ok */ }
    }
    hidExtraDevices = [];
    onPuckDisconnected();
  }
  if (controllerDriver) {
    if (controllerDriver.destroy) controllerDriver.destroy();
    controllerDriver = null;
  }
  gyroActive = false;
  gyroPermitted = false;
  syntheticGamepad = null;
  _firstReportLogged = false;
  // Shared SensorFusion owns orientation + all intermediate state.
  gyroFusion.reset();
  gyroFusion.resetBias();
  calibrating = false;
  calibSamples = [];
  calibRetries = 0;
  connectGyroBtn.textContent = 'Connect';
  updateGyroToggle();
  hideGyroHud();
  hideCalibHint();
}

// ── Main loop ──

function loop() {
  requestAnimationFrame(loop);
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
    }
  }

  overlay.update(gamepad, gyroActive ? gyroFusion.orientation : null);

  // Drive the 2D button HUD (cheap; ~30 DOM class flips per frame).
  if (document.body.classList.contains('show-button-hud')) {
    updateButtonHud(gamepad);
  }

  // Forward gamepad state to the popout HUD window (no-op when popout
  // isn't open — main process drops the message). Sending unconditionally
  // is simpler than tracking popout-open state in this renderer; the IPC
  // overhead is trivial for the ~16-byte serialized snapshot.
  if (gamepad && window.electronAPI?.sendButtonHudState) {
    window.electronAPI.sendButtonHudState({
      buttons: gamepad.buttons.map(b => ({ pressed: !!b.pressed, value: b.value || 0 })),
      axes: Array.from(gamepad.axes || []),
      grips: _lastGrips || undefined,
    });
  }

  // Drive the 3D gimbal widget when visible
  if (gimbal && document.body.classList.contains('show-gimbal')) {
    gimbal.update(gyroActive ? gyroFusion.orientation : null);
  }

  // Live axis readout (pitch/yaw/roll in degrees, swing-twist per axis)
  if (document.body.classList.contains('show-axis-readout')) {
    const q = gyroActive ? gyroFusion.orientation : null;
    const toDeg = 180 / Math.PI;
    const twist = (ax, ay, az) => {
      if (!q) return 0;
      const d = q.x * ax + q.y * ay + q.z * az;
      return 2 * Math.atan2(d, q.w) * toDeg;
    };
    axPitchVal.textContent = Math.round(twist(1, 0, 0)) + '\u00B0';
    axRollVal.textContent = Math.round(twist(0, 0, 1)) + '\u00B0';
    axYawVal.textContent = Math.round(twist(0, 1, 0)) + '\u00B0';
  }

  // Update gyro HUD
  if (gyroActive) {
    _hudEuler.setFromQuaternion(gyroFusion.orientation, 'XYZ');
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

const PUCK_ALLOWED_SETTINGS_SOURCES = new Set(['gear-click', 'close-button']);

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
    gyroActive = false;
    gyroFusion.reset();
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
  // Force-prefer the HID-synthesized gamepad whenever we have a live
  // Bluetooth driver. On Electron 33 (Chromium 130) the Gamepad API
  // keeps returning a stale Gamepad object for the slot even after
  // DualSense has switched to 0x31 full-report mode — frozen axes and
  // buttons that never update. On Chrome/Mac the slot comes back null
  // and the legacy "real-first, synthetic-fallback" path below handles
  // it, but inside Electron we have to override the preference or the
  // stale slot wins and sticks/buttons silently stop working. Same
  // issue and same fix as the main game's InputManager.getGamepadState
  // (petegordon/tandemonium#199).
  if (controllerDriver &&
      controllerDriver.connectionType === 'bluetooth' &&
      syntheticGamepad) {
    return syntheticGamepad;
  }

  // Preferred source: the real Gamepad API, if it still owns this slot.
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

  // No slot yet and no HID → probe the Gamepad API for a fresh connection.
  if (gamepadIndex === null) {
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        switchController(gamepads[i]);
        return null;
      }
    }
    return null;
  }

  // Had a slot, the Gamepad API dropped it, and we have no HID fallback.
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
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
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
    set(17, b.mic);
  }
}

// 2D grip-sense indicator — readable at any 3D camera angle (the grip meshes
// are on the back of the controller and usually occluded). Lazily revealed the
// first time grip data arrives, then tracks left/right state.
let gripVizEnabled = localStorage.getItem('overlay:gripViz') !== '0'; // 3D handle glow on/off
// Grip-sense HUD row — toggles the LG/RG cells in the Button HUD from
// parsed.grips (dedicated path; grips aren't in the gamepad). Revealed via
// body.has-grips the first time a controller reports grips.
let _gripHudRefs = null;
let _lastGrips = null; // latest grip state, forwarded to the popout HUD
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

// Grip-sense display toggle — gates both the 2D edge indicator and the 3D
// markers/glow (overlay.setGripVisible).
const gripToggle = document.getElementById('grip-viz-toggle');
if (gripToggle) {
  gripToggle.checked = gripVizEnabled;
  gripToggle.addEventListener('change', (e) => {
    gripVizEnabled = e.target.checked;
    localStorage.setItem('overlay:gripViz', gripVizEnabled ? '1' : '0');
    if (overlay?.setGripVisible) overlay.setGripVisible(gripVizEnabled); // 3D handle glow only
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

// Highlight color — SHARED with PR #45 (same picker id `highlight-color`, key
// `overlay:highlightColor`, CSS var `--hl-color`). Here it drives the grip-sense
// color (3D markers + glow via setGripColor, and the 2D edge indicator via the
// CSS var). On #45 the same picker drives the button-press glow (setPressColor).
// MERGE NOTE: keep one picker; combine the handlers so applyHighlightColor calls
// both setGripColor and setPressColor.
const highlightColorInput = document.getElementById('highlight-color');
function applyHighlightColor(hex) {
  document.documentElement.style.setProperty('--hl-color', hex);
  if (overlay?.setGripColor) overlay.setGripColor(hex);
}
if (highlightColorInput) {
  const savedHl = localStorage.getItem('overlay:highlightColor');
  if (savedHl) { highlightColorInput.value = savedHl; applyHighlightColor(savedHl); }
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
    _lastGrips = parsed.grips;                                    // forwarded to the popout HUD
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

function startCalibration() {
  calibrating = true;
  calibSamples = [];
  calibRetries = 0;
  resetGyroState();
  // Reset camera to selected preset on calibration
  overlay.setCameraPreset(selectedCameraPreset);
  showCalibHint('Calibrating...', null);
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

driftModeSelect.addEventListener('change', (e) => {
  gravityMode = e.target.value;
  gyroFusion.gravityMode = GRAVITY_MODES[gravityMode] || 0;
});

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

// Camera presets — one selected at a time, used as calibration view
let selectedCameraPreset = 'player';
const cameraPresetBtns = document.querySelectorAll('.camera-presets button');

function selectCameraPreset(preset) {
  selectedCameraPreset = preset;
  if (overlay) overlay.setCameraPreset(preset);
  cameraPresetBtns.forEach(b => {
    b.classList.toggle('selected', b.dataset.preset === preset);
  });
}

cameraPresetBtns.forEach((btn) => {
  btn.addEventListener('click', () => selectCameraPreset(btn.dataset.preset));
});

// Set default selection (overlay not ready yet, just highlights the button)
selectCameraPreset('player');

// ── Window display toggles (cosmetic only — never affects functionality) ──
const showTitleCheck = document.getElementById('show-title');
const showGyroCheck = document.getElementById('show-gyro');
const showGearCheck = document.getElementById('show-gear');
const showGimbalCheck = document.getElementById('show-gimbal');
const gimbalFullCheck = document.getElementById('gimbal-full-mode');
const showRollHudCheck = document.getElementById('show-roll-hud');
const showAxisReadoutCheck = document.getElementById('show-axis-readout');
const showButtonHudCheck = document.getElementById('show-button-hud');
const buttonHudPositionSelect = document.getElementById('button-hud-position');
const popoutButtonHudBtn = document.getElementById('popout-button-hud');
const axPitchVal = document.getElementById('ax-pitch-val');
const axRollVal = document.getElementById('ax-roll-val');
const axYawVal = document.getElementById('ax-yaw-val');

const DISPLAY_PREFS_KEY = 'overlay-display-prefs';
try {
  const saved = JSON.parse(localStorage.getItem(DISPLAY_PREFS_KEY) || '{}');
  if (typeof saved.gimbal === 'boolean') showGimbalCheck.checked = saved.gimbal;
  if (typeof saved.gimbalFull === 'boolean') gimbalFullCheck.checked = saved.gimbalFull;
  if (typeof saved.rollHud === 'boolean') showRollHudCheck.checked = saved.rollHud;
  if (typeof saved.axisReadout === 'boolean') showAxisReadoutCheck.checked = saved.axisReadout;
  if (typeof saved.buttonHud === 'boolean') showButtonHudCheck.checked = saved.buttonHud;
  if (typeof saved.buttonHudPos === 'string') buttonHudPositionSelect.value = saved.buttonHudPos;
} catch (e) { /* ignore */ }

function applyDisplayToggles() {
  document.body.classList.toggle('show-title', showTitleCheck.checked);
  document.body.classList.toggle('show-gyro', showGyroCheck.checked);
  document.body.classList.toggle('show-gear', showGearCheck.checked);
  document.body.classList.toggle('show-gimbal', showGimbalCheck.checked);
  document.body.classList.toggle('hide-roll-hud', !showRollHudCheck.checked);
  document.body.classList.toggle('show-axis-readout', showAxisReadoutCheck.checked);
  document.body.classList.toggle('show-button-hud', showButtonHudCheck.checked);
  // Position class: prefix `pos-` and the selected value (bottom-left etc.)
  const buttonHud = document.getElementById('button-hud');
  if (buttonHud) {
    buttonHud.classList.remove('pos-bottom-left', 'pos-bottom-right', 'pos-top-left', 'pos-top-right');
    buttonHud.classList.add('pos-' + (buttonHudPositionSelect.value || 'bottom-left'));
  }
  if (showGimbalCheck.checked) ensureGimbal();
  if (gimbal) gimbal.fullMode = gimbalFullCheck.checked;
  try {
    localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify({
      gimbal: showGimbalCheck.checked,
      gimbalFull: gimbalFullCheck.checked,
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
  const gimbalCanvas = document.getElementById('gimbal-canvas');
  if (!gimbalCanvas) return;
  gimbal = new GyroGimbal(gimbalCanvas);
  new ResizeObserver(() => gimbal.resize()).observe(gimbalCanvas);
}

showTitleCheck.addEventListener('change', applyDisplayToggles);
showGyroCheck.addEventListener('change', applyDisplayToggles);
showGearCheck.addEventListener('change', applyDisplayToggles);
showGimbalCheck.addEventListener('change', applyDisplayToggles);
gimbalFullCheck.addEventListener('change', applyDisplayToggles);
showRollHudCheck.addEventListener('change', applyDisplayToggles);
showAxisReadoutCheck.addEventListener('change', applyDisplayToggles);
showButtonHudCheck.addEventListener('change', applyDisplayToggles);
buttonHudPositionSelect.addEventListener('change', applyDisplayToggles);
// Pop out the Button HUD into its own draggable window. When already open
// the IPC handler focuses the existing window and re-sends the current
// profile, so clicking again is harmless.
if (popoutButtonHudBtn) {
  popoutButtonHudBtn.addEventListener('click', async () => {
    if (!window.electronAPI?.openButtonHudWindow) return;
    await window.electronAPI.openButtonHudWindow(currentControllerType);
  });
}
applyDisplayToggles(); // apply defaults (all unchecked = all hidden)

// Right-click opens settings (needed when gear icon is hidden). When
// Puck is connected this is silently ignored by setSettingsVisible —
// the lizard-mode firmware fires phantom right-clicks at unpredictable
// intervals that no rate-limit can hold off.
window.addEventListener('contextmenu', (e) => {
  if (settingsPanel.contains(e.target)) return;
  e.preventDefault();
  toggleSettings('contextmenu');
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
    if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) return;

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
    const quality = (isImuStep && controllerDriver)
      ? analyzeImuStep(step.id, parseImuSamples(reports, controllerDriver))
      : null;
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
