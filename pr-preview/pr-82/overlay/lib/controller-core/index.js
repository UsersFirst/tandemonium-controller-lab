// ============================================================
// @usersfirst/controller-core — barrel exports
// ============================================================
//
// Convenience re-exports. Deep imports (subpath exports) are also supported:
//   import { ControllerManager } from '@usersfirst/controller-core/manager';
//   import { ControllerRegistry } from '@usersfirst/controller-core/drivers/controller-registry';
//
// See package.json `exports` for the full subpath map.

export {
  ControllerManager,
  Slot,
  gamepadHasActivity,
  gamepadHasFreshActivity,
  stableIdFor,
  makeSyntheticGamepad,
  resetSynthetic,
  applyParsedToSynthetic,
} from './manager.js';

export {
  SensorFusion,
  FUSION_CALIB_COUNT,
  FUSION_CALIB_COUNT_BT,
} from './sensor-fusion.js';

export { ControllerDriver } from './drivers/base-driver.js';
export { ControllerRegistry } from './drivers/controller-registry.js';
export { PlayStationDriver } from './drivers/playstation-driver.js';
export { SwitchProDriver } from './drivers/switch-pro-driver.js';
export { XboxDriver } from './drivers/xbox-driver.js';
export { SteamControllerDriver } from './drivers/steam-controller-driver.js';

export { DEVICES, PENDING_DEVICES, PROTOCOLS } from './devices.js';

export { analyzeImuStep } from './imu-analysis.js';

export {
  ControllerInventory,
  normalizeDescriptor,
  identityKey,
  capabilitiesFor,
  macOui,
  formatSerial,
  isMacSerial,
} from './controller-inventory.js';

// ── Input architecture (#80): WebHID-first sources + arbiter ──
export {
  SOURCE,
  SOURCE_PRIORITY,
  STANDARD_BUTTON_COUNT,
  makeEmptyFrame,
  frameFromGamepad,
  quatToPlain,
  identityMatchKey,
  chooseSource,
} from './input-frame.js';

export { InputArbiter } from './input-arbiter.js';
export { ControllerSource } from './sources/base-source.js';
export { WebHIDSource } from './sources/webhid-source.js';
export { GamepadAPISource } from './sources/gamepad-source.js';
