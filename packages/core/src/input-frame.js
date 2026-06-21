// ============================================================
// INPUT FRAME — the source-agnostic controller contract
// ============================================================
//
// Phase 1 of the WebHID-first input architecture (#80). This module
// defines the ONE shape every input source produces and every consumer
// (game, 3D visualizer, HUD) reads — so nothing above the source layer
// has to know whether a frame came from raw WebHID, the Gamepad API, or
// (later, optional) Steam Input.
//
// Design rules this module enforces (see docs/STEAM-INPUT-ARCHITECTURE-PLAN.md):
//   1. WebHID is the foundational spine. This file has ZERO dependencies
//      (no `three`, no DOM) so it stays in the dependency-free test set
//      and is safe to import anywhere — including an Electron preload that
//      ships frames over IPC. That is why `motion.quaternion` is a PLAIN
//      {x,y,z,w} object and NOT a THREE.Quaternion: it must be structured-
//      cloneable across the IPC boundary.
//   2. Steam Input is an optional ADAPTER, never a dependency. The
//      `SteamInputSource` lives in the separate `@usersfirst/controller-steam`
//      package; this file only reserves its SourceId + the `glyphs` slot.
//
// ============================================================

/**
 * Where a frame came from. The arbiter (see input-arbiter.js) picks ONE
 * source per physical controller — never two — to avoid double-input.
 * @readonly
 * @enum {string}
 */
export const SOURCE = Object.freeze({
  WEBHID: 'webhid',
  STEAM_INPUT: 'steam-input', // produced by @usersfirst/controller-steam (optional)
  GAMEPAD_API: 'gamepad-api',
});

/**
 * Default arbitration order: WebHID first (it preserves device identity +
 * real gyro and works off-Steam), Steam Input next (forced only where raw
 * HID is occluded — e.g. Steam Deck built-in controls), Gamepad API last
 * (no gyro, thin identity — the fallback for driver-less pads like Xbox on
 * Chromium). A per-controller preference or a `forced` source can override
 * this; see `chooseSource`.
 * @type {ReadonlyArray<string>}
 */
export const SOURCE_PRIORITY = Object.freeze([
  SOURCE.WEBHID,
  SOURCE.STEAM_INPUT,
  SOURCE.GAMEPAD_API,
]);

/** Standard gamepad button count (Gamepad API "standard" mapping, 0..16). */
export const STANDARD_BUTTON_COUNT = 17;

// ── Type contracts (JSDoc — this is plain JS, kept duck-typed) ──

/**
 * @typedef {Object} ControllerIdentity
 * @property {?string} profileKey  visualizer/profile key — 'dualsense' | 'switch-pro' | 'xbox' | 'steam-controller'. Drives which 3D model renders.
 * @property {?number} vendorId
 * @property {?number} productId
 * @property {?string} unitId      per-UNIT id (BT MAC / serial / vid:pid). Used to dedup the same physical controller across sources. See controller-inventory.identityKey.
 * @property {string}  label       human-readable controller name
 */

/**
 * @typedef {Object} StandardButton
 * @property {boolean} pressed
 * @property {boolean} touched
 * @property {number}  value   0..1 (analog triggers carry their real value here)
 */

/**
 * Orientation/motion. `quaternion` is world-space orientation as a plain
 * object (NOT THREE.Quaternion — see file header). `gyro` is raw angular
 * velocity (deg/s, device frame); `accel` is g. A source that has no IMU
 * sets `motion: null` on the frame entirely.
 * @typedef {Object} MotionState
 * @property {{x:number,y:number,z:number,w:number}} quaternion
 * @property {{x:number,y:number,z:number}} gyro
 * @property {{x:number,y:number,z:number}} accel
 * @property {boolean} hasGyro
 */

/**
 * The normalized per-controller frame. Produced by a ControllerSource,
 * consumed by everything downstream.
 * @typedef {Object} InputFrame
 * @property {string} sourceId            one of SOURCE.*
 * @property {ControllerIdentity} identity
 * @property {StandardButton[]} buttons   standard layout, length STANDARD_BUTTON_COUNT
 * @property {number[]} axes              [lx, ly, rx, ry]
 * @property {{l2:number,r2:number}} triggers
 * @property {?MotionState} motion        null when the source has no motion data
 * @property {?Object} extras             optional rich inputs: { touchpads?, paddles?, grips? }
 * @property {?GlyphProvider} glyphs      only Steam Input populates this; null ⇒ consumers fall back to visualizer profile labels
 * @property {number} timestamp           performance.now()-style ms when the frame was produced
 */

/**
 * Optional per-frame glyph lookup. Only the Steam Input adapter supplies
 * one (it can map a player's actual bindings to official button art). When
 * `glyphs` is null on a frame, consumers render their own labels from the
 * visualizer's controller-profiles (`hudLabels`) — i.e. the lab is its own
 * glyph authority and Steam glyphs are a bonus, never a dependency.
 * @typedef {Object} GlyphProvider
 * @property {(action: string) => (?string)} svgForAction   local file path / data URI to an SVG, or null
 * @property {(action: string) => (?string)} labelForAction localized physical-input label, or null
 */

// ── Pure helpers (fully testable, no I/O) ──

/** A zeroed standard button. */
function emptyButton() {
  return { pressed: false, touched: false, value: 0 };
}

/**
 * Build a blank InputFrame for `sourceId` with the given identity. Useful
 * for "controller present but idle this tick" and as the base every
 * builder fills in.
 * @param {string} sourceId
 * @param {ControllerIdentity} [identity]
 * @returns {InputFrame}
 */
export function makeEmptyFrame(sourceId, identity = {}) {
  const buttons = [];
  for (let i = 0; i < STANDARD_BUTTON_COUNT; i++) buttons.push(emptyButton());
  return {
    sourceId,
    identity: {
      profileKey: identity.profileKey ?? null,
      vendorId: identity.vendorId ?? null,
      productId: identity.productId ?? null,
      unitId: identity.unitId ?? null,
      label: identity.label ?? '',
    },
    buttons,
    axes: [0, 0, 0, 0],
    triggers: { l2: 0, r2: 0 },
    motion: null,
    extras: null,
    glyphs: null,
    timestamp: 0,
  };
}

/**
 * Normalize a THREE.Quaternion (or any {x,y,z,w}) into a plain, IPC-safe
 * object. Returns null for null input so callers can pass it straight
 * through to MotionState.
 * @param {?{x:number,y:number,z:number,w:number}} q
 * @returns {?{x:number,y:number,z:number,w:number}}
 */
export function quatToPlain(q) {
  if (!q) return null;
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/**
 * Map a standard-mapping Gamepad (real Gamepad-API pad OR the manager's
 * synthetic gamepad) into an InputFrame. The single normalization point
 * for button/axis/trigger layout — every WebHID and Gamepad-API frame goes
 * through here, so the standard layout is defined in exactly one place.
 *
 * `motion` (a MotionState or null) is supplied by the caller because the
 * Gamepad object carries no IMU — WebHIDSource passes its fusion-derived
 * MotionState, GamepadAPISource passes null.
 *
 * @param {Object} gamepad  { buttons:[{pressed,touched,value}], axes:number[] }
 * @param {Object} opts
 * @param {string} opts.sourceId
 * @param {ControllerIdentity} opts.identity
 * @param {?MotionState} [opts.motion]
 * @param {?Object} [opts.extras]
 * @param {number} [opts.timestamp]
 * @returns {InputFrame}
 */
export function frameFromGamepad(gamepad, { sourceId, identity, motion = null, extras = null, timestamp = 0 } = {}) {
  const frame = makeEmptyFrame(sourceId, identity);
  if (gamepad) {
    const src = gamepad.buttons || [];
    for (let i = 0; i < STANDARD_BUTTON_COUNT; i++) {
      const b = src[i];
      if (!b) continue;
      frame.buttons[i].pressed = !!b.pressed;
      frame.buttons[i].touched = !!(b.touched ?? b.pressed);
      frame.buttons[i].value = typeof b.value === 'number' ? b.value : (b.pressed ? 1 : 0);
    }
    const ax = gamepad.axes || [];
    for (let i = 0; i < 4; i++) frame.axes[i] = typeof ax[i] === 'number' ? ax[i] : 0;
    // Standard mapping: button 6 = L2, button 7 = R2 (analog value carried).
    frame.triggers.l2 = frame.buttons[6]?.value ?? 0;
    frame.triggers.r2 = frame.buttons[7]?.value ?? 0;
  }
  frame.motion = motion;
  frame.extras = extras;
  frame.timestamp = timestamp;
  return frame;
}

/**
 * Stable key for matching the SAME physical controller across different
 * sources (so the arbiter never reads one controller twice). Prefers the
 * per-unit id, then vid:pid, then the label. Mirrors the precedence in
 * controller-inventory.identityKey but operates on a ControllerIdentity.
 * @param {ControllerIdentity} identity
 * @returns {string}
 */
export function identityMatchKey(identity) {
  if (!identity) return 'unknown';
  if (identity.unitId) return `unit:${identity.unitId}`;
  if (identity.vendorId != null && identity.productId != null) {
    return `vidpid:${identity.vendorId}:${identity.productId}`;
  }
  if (identity.label) return `label:${identity.label.toLowerCase()}`;
  return 'unknown';
}

/**
 * Pick the single source to read for one physical controller, WebHID-first.
 *
 *   1. `forced` wins if that source actually sees the controller. This is
 *      the Steam Deck built-in case: raw HID is kernel-occluded, so the
 *      arbiter forces SOURCE.STEAM_INPUT.
 *   2. else a per-controller `preference` wins if available (the opt-in
 *      "I want Steam Input for this pad" path — the library successor to
 *      Tandemonium's tandemonium_dualsense_source).
 *   3. else the first available source by SOURCE_PRIORITY (WebHID).
 *
 * @param {Iterable<string>|Object} available  the source ids that currently see this controller (array, Set, or object keyed by source id)
 * @param {Object} [opts]
 * @param {?string} [opts.forced]      a source id that MUST be used if present
 * @param {?string} [opts.preference]  a source id to prefer if present
 * @param {ReadonlyArray<string>} [opts.priority]  default SOURCE_PRIORITY
 * @returns {?string} the chosen source id, or null if `available` is empty
 */
export function chooseSource(available, { forced = null, preference = null, priority = SOURCE_PRIORITY } = {}) {
  const has = (id) => {
    if (!id) return false;
    if (available instanceof Set) return available.has(id);
    if (Array.isArray(available)) return available.includes(id);
    if (available && typeof available === 'object') return !!available[id];
    return false;
  };
  if (forced && has(forced)) return forced;
  if (preference && has(preference)) return preference;
  for (const id of priority) {
    if (has(id)) return id;
  }
  return null;
}
