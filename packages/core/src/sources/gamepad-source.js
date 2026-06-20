// ============================================================
// GAMEPAD API SOURCE — driver-less fallback (no gyro)
// ============================================================
//
// Reads navigator.getGamepads() directly. Used for controllers we have no
// WebHID driver for (e.g. Xbox pads on Chromium) and as the last-resort
// fallback in the arbiter's WebHID-first order. Produces no motion data —
// the Gamepad API exposes none.
//
// Phase 1 scaffold (#80).
// ============================================================

import { ControllerSource } from './base-source.js';
import { SOURCE, frameFromGamepad } from '../input-frame.js';
import { ControllerRegistry } from '../drivers/controller-registry.js';

export class GamepadAPISource extends ControllerSource {
  constructor() {
    super();
    this._pads = [];
  }

  get id() { return SOURCE.GAMEPAD_API; }

  /** @param {ArrayLike<Gamepad>} pads navigator.getGamepads() snapshot for this tick */
  setPads(pads) {
    this._pads = pads || [];
  }

  /** @returns {import('./base-source.js').SourceController[]} */
  list() {
    const out = [];
    for (const gp of this._pads) {
      if (!gp) continue;
      out.push({
        id: `gamepad:${gp.index}`,
        identity: this._identityForPad(gp),
        hasGyro: false,
        _index: gp.index,
      });
    }
    return out;
  }

  /**
   * @param {import('./base-source.js').SourceController} controller
   * @returns {import('../input-frame.js').InputFrame}
   */
  read(controller) {
    const gp = this._pads[controller?._index];
    return frameFromGamepad(gp, {
      sourceId: SOURCE.GAMEPAD_API,
      identity: controller?.identity,
      motion: null,
      timestamp: gp?.timestamp || 0,
    });
  }

  _identityForPad(gp) {
    const info = ControllerRegistry.identifyFromGamepadId(gp.id || '');
    const vp = ControllerRegistry.parseGamepadVendorProduct(gp.id || '');
    return {
      profileKey: info?.controllerProfile || info?.protocol || null,
      vendorId: vp?.vendorId ?? null,
      productId: vp?.productId ?? null,
      unitId: vp ? `vidpid:${vp.vendorId}:${vp.productId}` : null,
      label: gp.id || '',
    };
  }
}
