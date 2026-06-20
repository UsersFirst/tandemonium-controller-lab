// ============================================================
// WEBHID SOURCE — the foundational input spine
// ============================================================
//
// Wraps the existing ControllerManager (drivers + sensor fusion + slot/
// claim pool) and exposes its claimed controllers as the canonical
// ControllerSource. This is the DEFAULT source the arbiter reads; it is
// the only one that preserves real device identity and true sensor-fusion
// gyro, and it works entirely off-Steam.
//
// Phase 1 scaffold (#80): list()/read() map the manager's claimed Slots to
// SourceController + InputFrame. The arbiter integration (multi-source
// dedup, per-controller preference) lives in input-arbiter.js. Items left
// for later passes are marked TODO(#80).
//
// ============================================================

import { ControllerSource } from './base-source.js';
import { SOURCE, frameFromGamepad, quatToPlain, makeEmptyFrame } from '../input-frame.js';
import { ControllerRegistry } from '../drivers/controller-registry.js';

export class WebHIDSource extends ControllerSource {
  /**
   * @param {import('../manager.js').ControllerManager} manager
   */
  constructor(manager) {
    super();
    this._manager = manager;
    // Cache of the live gamepads array for the current tick. The Gamepad
    // API requires re-reading navigator.getGamepads() each frame (entries
    // are snapshots); the arbiter sets this once per tick via setPads().
    this._pads = [];
  }

  get id() { return SOURCE.WEBHID; }

  /**
   * Provide the per-tick gamepads snapshot (navigator.getGamepads()). The
   * arbiter calls this once per frame before list()/read() so Slot
   * .effectiveGamepad() can resolve the real pad when HID reports go stale.
   * @param {ArrayLike<Gamepad>} pads
   */
  setPads(pads) {
    this._pads = pads || [];
  }

  /**
   * Claimed slots become SourceControllers. We key on the slot id (stable
   * P1/P2) and derive identity from the slot's controller label + driver.
   * @returns {import('./base-source.js').SourceController[]}
   */
  list() {
    const out = [];
    for (const slot of this._manager.slots) {
      if (slot.state !== 'claimed') continue;
      out.push({
        id: `webhid:${slot.id}`,
        identity: this._identityForSlot(slot),
        hasGyro: !!slot.fusion,
        _slot: slot,
      });
    }
    return out;
  }

  /**
   * @param {import('./base-source.js').SourceController} controller
   * @returns {import('../input-frame.js').InputFrame}
   */
  read(controller) {
    const slot = controller?._slot;
    if (!slot) return makeEmptyFrame(SOURCE.WEBHID, controller?.identity);

    const gp = slot.effectiveGamepad(this._pads);
    const motion = this._motionForSlot(slot);
    // TODO(#80): surface slot extras (touchpad / paddles / grips) via the
    // 'hid-report' parsed payload once consumers need them — see Slot._emit.
    return frameFromGamepad(gp, {
      sourceId: SOURCE.WEBHID,
      identity: controller.identity,
      motion,
      extras: null,
      timestamp: gp?.timestamp || 0,
    });
  }

  // ── internals ──

  _identityForSlot(slot) {
    const info = ControllerRegistry.identifyFromGamepadId(slot.controllerLabel || '');
    const vp = ControllerRegistry.parseGamepadVendorProduct(slot.controllerLabel || '');
    return {
      profileKey: slot.controllerType || info?.controllerProfile || info?.protocol || null,
      vendorId: vp?.vendorId ?? null,
      productId: vp?.productId ?? null,
      // TODO(#80): wire the per-unit id (BT MAC / serial) from
      // controller-inventory once the manager threads it onto the slot.
      // vid:pid is the browser-only fallback until then.
      unitId: vp ? `vidpid:${vp.vendorId}:${vp.productId}` : null,
      label: slot.controllerLabel || '',
    };
  }

  _motionForSlot(slot) {
    const fusion = slot.fusion;
    if (!fusion || typeof fusion.getQuaternion !== 'function') return null;
    const quat = quatToPlain(fusion.getQuaternion());
    if (!quat) return null;
    return {
      quaternion: quat,
      // TODO(#80): expose latest raw gyro/accel from the fusion or the last
      // parsed report if a consumer needs rates rather than orientation.
      gyro: { x: 0, y: 0, z: 0 },
      accel: { x: 0, y: 0, z: 0 },
      hasGyro: true,
    };
  }
}
