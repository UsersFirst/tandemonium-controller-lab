// ============================================================
// CONTROLLER SOURCE — abstract producer of InputFrames
// ============================================================
//
// A ControllerSource is anything that can enumerate controllers and
// produce a normalized InputFrame for each. The arbiter (input-arbiter.js)
// composes one or more sources and, per physical controller, reads exactly
// one of them (WebHID-first). Mirrors the ControllerDriver base-class
// pattern in drivers/base-driver.js.
//
// Concrete sources:
//   - WebHIDSource      (this package — the spine; wraps ControllerManager)
//   - GamepadAPISource  (this package — fallback; no gyro)
//   - SteamInputSource  (@usersfirst/controller-steam — OPTIONAL adapter;
//                        not in core, so core never depends on Steamworks)
//
// ============================================================

/**
 * A handle the source uses to identify one controller it sees. Opaque to
 * the arbiter except for `.id` (stable within the source) and `.identity`
 * (a ControllerIdentity used to dedup the same physical pad across sources).
 * @typedef {Object} SourceController
 * @property {string} id                       stable within this source for this controller
 * @property {import('../input-frame.js').ControllerIdentity} identity
 * @property {boolean} hasGyro
 */

export class ControllerSource {
  /** @returns {string} one of SOURCE.* */
  get id() {
    throw new Error('ControllerSource.id getter not implemented');
  }

  /** Begin observing controllers (wire listeners, start polling, etc.). */
  start() {}

  /** Stop observing and release resources. */
  stop() {}

  /**
   * Controllers this source currently sees.
   * @returns {SourceController[]}
   */
  list() {
    throw new Error(`${this.constructor.name}.list() not implemented`);
  }

  /**
   * Produce the current normalized frame for one controller.
   * @param {SourceController} _controller
   * @returns {import('../input-frame.js').InputFrame}
   */
  read(_controller) {
    throw new Error(`${this.constructor.name}.read() not implemented`);
  }

  /**
   * @param {SourceController} controller
   * @returns {boolean}
   */
  supportsGyro(controller) {
    return !!controller?.hasGyro;
  }
}
