// ============================================================
// CONTROLLER PROFILES — per-controller 3D model configuration
// ============================================================

/**
 * Each profile defines:
 *  - model:          path to GLB file relative to src/
 *  - name:           display name
 *  - buttonMap:      Gamepad API button index → mesh name in GLB
 *  - axisMap:        Gamepad API axis index → { mesh, component: 'x'|'z' }
 *  - pressDepth:     how far buttons translate on press (metres)
 *  - triggerMaxAngle: max trigger rotation in radians (~30°)
 *  - stickMaxTilt:   max stick tilt in radians (~15°)
 *  - hasGyro:        whether WebHID gyro is supported
 *  - hasTouchpad:    whether WebHID touchpad is supported
 *  - bodyMesh:       mesh name for the controller body (gyro target)
 */

export const PROFILES = {
  dualsense: {
    model: 'assets/controllers/dualsense.glb',
    name: 'DualSense',

    // Gamepad API standard button index → mesh name
    buttonMap: {
      0:  'face_cross',       // Cross / A
      1:  'face_circle',      // Circle / B
      2:  'face_square',      // Square / X
      3:  'face_triangle',    // Triangle / Y
      4:  'bumper_l1',        // L1
      5:  'bumper_r1',        // R1
      8:  'button_create',    // Create / Share
      9:  'button_options',   // Options / Start
      12: 'dpad_up',
      13: 'dpad_down',
      14: 'dpad_left',
      15: 'dpad_right',
      16: 'button_ps',        // PS button
      17: 'button_mic',       // Mic / mute (procedurally added — not in GLB)
    },

    // Analog triggers (button index → mesh, animated by value 0-1)
    triggerMap: {
      6: 'trigger_l2',
      7: 'trigger_r2',
    },

    // Gamepad API axes → stick assemblies
    // Each stick has multiple meshes that tilt together, pivoting at the base
    // axes[0]=left X, axes[1]=left Y, axes[2]=right X, axes[3]=right Y
    stickMap: {
      left:  { meshes: ['stick_left', 'stick_left_ring', 'stick_left_base'], axisX: 0, axisY: 1 },
      right: { meshes: ['stick_right', 'stick_right_ring', 'stick_right_base'], axisX: 2, axisY: 3 },
    },

    pressDepth: 0.002,        // 2mm button press depth
    triggerMaxAngle: 0.52,    // ~30 degrees
    stickMaxTilt: 0.26,       // ~15 degrees

    hasGyro: true,
    // DualSense driver outputs (pitch, yaw, roll) directly — no transform needed
    gyroTransform: (gx, gy, gz) => [gx, gy, gz],
    hasTouchpad: true,
    touchpadMesh: 'touchpad',
    touchPoint1Mesh: 'touch_point1',
    touchPoint2Mesh: 'touch_point2',
    bodyMeshes: ['body_top', 'body_bottom', 'body_extra'],  // gyro applied to bodyGroup parent

    // Color groups for user-customizable body/accent colors
    bodyColorMeshes: [
      'body_top', 'face_cross', 'face_circle', 'face_square', 'face_triangle',
      'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'touchpad',
      'button_create', 'button_options',
    ],
    accentColorMeshes: [
      'body_bottom', 'body_extra', 'bumper_l1', 'bumper_r1',
      'trigger_l2', 'trigger_r2', 'button_ps', 'button_mic',
    ],
    defaultBodyColor: '#e8e8ec',
    defaultAccentColor: '#1a1a1e',
    // Per-controller labels for the 2D button HUD. Keys are Gamepad-API
    // standard button indices; missing keys fall back to the default
    // ABXY/L1-R1-L2-R2 labels in the HTML markup. Use short text (≤3
    // chars) — the HUD elements are small.
    hudLabels: {
      0: '✕', 1: '○', 2: '□', 3: '△',   // ✕ ○ □ △
      4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2',
      8: 'Cre', 9: 'Opt', 16: 'PS', 17: 'TP',
    },
  },

  'switch-pro': {
    model: 'assets/controllers/switch-pro.glb',
    name: 'Switch Pro',
    buttonMap: {
      0:  'face_b',
      1:  'face_a',
      2:  'face_y',
      3:  'face_x',
      4:  'bumper_l',
      5:  'bumper_r',
      8:  'button_minus',
      9:  'button_plus',
      12: 'dpad_up',
      13: 'dpad_down',
      14: 'dpad_left',
      15: 'dpad_right',
      16: 'button_home',
      17: 'button_capture',
    },
    triggerMap: {
      6: 'trigger_zl',
      7: 'trigger_zr',
    },
    stickMap: {
      left:  { meshes: ['stick_left', 'stick_left_ring', 'stick_left_base'], axisX: 0, axisY: 1 },
      right: { meshes: ['stick_right', 'stick_right_ring', 'stick_right_base'], axisX: 2, axisY: 3 },
    },
    pressDepth: 0.002,
    triggerMaxAngle: 0.52,
    stickMaxTilt: 0.26,
    hasGyro: true,
    // Switch Pro driver remaps: output = {x: rawX, y: rawZ, z: rawY}
    // Swap pitch↔roll (gx↔gz) and negate both to match DualSense 3D orientation.
    gyroTransform: (gx, gy, gz) => [-gz, gy, -gx],
    hasTouchpad: false,
    bodyMeshes: ['body_top', 'body_bottom', 'body_extra'],
    bodyColorMeshes: [
      'body_top', 'face_a', 'face_b', 'face_x', 'face_y',
      'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right',
    ],
    accentColorMeshes: [
      'body_bottom', 'body_extra', 'bumper_l', 'bumper_r',
      'trigger_zl', 'trigger_zr', 'button_home',
      'button_minus', 'button_plus', 'button_capture',
    ],
    defaultBodyColor: '#2d2d2d',
    defaultAccentColor: '#1a1a1a',
    // Chromium remaps Nintendo Switch Pro to the Gamepad-API standard
    // layout (button 0 = bottom-of-face, etc.), so the labels reflect
    // whatever Nintendo's physical button is at that index position.
    hudLabels: {
      0: 'B',  1: 'A',  2: 'Y',  3: 'X',          // Nintendo: A right, B bottom
      4: 'L',  5: 'R',  6: 'ZL', 7: 'ZR',
      8: '−', 9: '+', 16: 'H', 17: 'Cap',    // − Plus Home Capture
    },
  },

  xbox: {
    model: 'assets/controllers/xbox.glb',
    name: 'Xbox',
    buttonMap: {
      0:  'face_a',
      1:  'face_b',
      2:  'face_x',
      3:  'face_y',
      4:  'bumper_lb',
      5:  'bumper_rb',
      8:  'button_view',
      9:  'button_menu',
      12: 'dpad_up',
      13: 'dpad_down',
      14: 'dpad_left',
      15: 'dpad_right',
      16: 'button_xbox',
    },
    triggerMap: {
      6: 'trigger_lt',
      7: 'trigger_rt',
    },
    stickMap: {
      left:  { meshes: ['stick_left', 'stick_left_ring', 'stick_left_base'], axisX: 0, axisY: 1 },
      right: { meshes: ['stick_right', 'stick_right_ring', 'stick_right_base'], axisX: 2, axisY: 3 },
    },
    pressDepth: 0.002,
    triggerMaxAngle: 0.52,
    stickMaxTilt: 0.26,
    hasGyro: false,
    hasTouchpad: false,
    bodyMeshes: ['body_top', 'body_bottom', 'body_extra'],
    bodyColorMeshes: [
      'body_top', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right',
    ],
    accentColorMeshes: [
      'body_bottom', 'body_extra', 'bumper_lb', 'bumper_rb',
      'trigger_lt', 'trigger_rt', 'button_xbox',
      'face_a', 'face_b', 'face_x', 'face_y',
      'button_view', 'button_menu',
    ],
    defaultBodyColor: '#f0f0f0',
    defaultAccentColor: '#1a1a1a',
    hudLabels: {
      0: 'A',  1: 'B',  2: 'X',  3: 'Y',
      4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
      8: 'Vw', 9: 'Mn', 16: 'Xb', 17: '',         // no standard 17 on Xbox
    },
  },

  // ─────────────────────────────────────────────────────────────
  // GameSir Super Nova (DS4 mode) — photogrammetry-sourced model
  // ─────────────────────────────────────────────────────────────
  //
  // Single monolithic mesh from a photogrammetry capture (~400K tris,
  // ~2.8 MB). Because the model isn't separated into per-button meshes,
  // **button presses / stick tilts / trigger pulls cannot animate** —
  // only whole-body gyro rotation works. The body mesh is named `node_0`
  // (the photogrammetry tool's auto-name; preserved on purpose so future
  // re-captures don't need a profile edit).
  //
  // To enable button animations on this controller, source or model a
  // GLB with separated meshes (see docs/OPTIMIZING-GLB.md "Blender
  // path") and replace this entry.
  'gamesir-super-nova': {
    model: 'assets/controllers/gamesir-super-nova.glb',
    name: 'GameSir Super Nova',
    buttonMap: {},          // empty — no separated button meshes to animate
    triggerMap: {},         // empty — no separated trigger meshes
    stickMap: {},           // empty — no separated stick meshes
    pressDepth: 0.002,
    triggerMaxAngle: 0.52,
    stickMaxTilt: 0.26,
    hasGyro: true,
    // GameSir DS4 mode uses Sony's IMU layout (the lab's DS4 fix lands
    // gyro already aligned to the visualizer's convention).
    gyroTransform: (gx, gy, gz) => [gx, gy, gz],
    hasTouchpad: false,     // single mesh — no touchpad sub-mesh to highlight
    bodyMeshes: ['node_0'], // whole-body rotation target for gyro orientation
    // No color customization for a textured photogrammetry model.
    bodyColorMeshes: [],
    accentColorMeshes: [],
    defaultBodyColor: '#ffffff',
    defaultAccentColor: '#ffffff',
    // Super Nova ships with Xbox-style labels printed on the pad
    // (A B X Y, LB/LT/RB/RT) — match what's physically on the device.
    hudLabels: {
      0: 'A',  1: 'B',  2: 'X',  3: 'Y',
      4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
      8: 'Vw', 9: 'Mn', 16: 'Hm', 17: '',
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Steam Controller (2026) — Valve CAD-sourced model (CC BY-NC-SA)
  // ─────────────────────────────────────────────────────────────
  //
  // GLB derived from Valve's official engineering STL release
  // (gitlab.steamos.cloud/SteamHardware/SteamController). See
  // assets/controllers/STEAM_CONTROLLER_ATTRIBUTION.md for the full
  // license + conversion pipeline. The source is a single solid body
  // with no separated parts, so this profile is body-only — gyro
  // rotates the whole mesh; buttons/sticks/triggers don't animate.
  //
  // NOTE on licensing: this single asset is CC BY-NC-SA 4.0 — see the
  // attribution file. The rest of the visualizer is MIT.
  'steam-controller': {
    model: 'assets/controllers/steam-controller.glb',
    name: 'Steam Controller (2026)',
    buttonMap: {},          // empty — single solid body, no separated buttons
    triggerMap: {},
    stickMap: {},
    pressDepth: 0.002,
    triggerMaxAngle: 0.52,
    stickMaxTilt: 0.26,
    hasGyro: true,
    // Axis remap is applied inside the driver itself (Y↔Z swap on both
    // gyro and accel — see steam-controller-driver.js parseReport).
    // gyroTransform here is informational; the field isn't actively
    // consumed anywhere in the pipeline, but the identity transform
    // documents that no further visualizer-side rotation is needed.
    gyroTransform: (gx, gy, gz) => [gx, gy, gz],
    hasTouchpad: false,     // touchpads exist on hardware but not as sub-meshes
    bodyMeshes: ['node_0'],
    bodyColorMeshes: [],
    accentColorMeshes: [],
    defaultBodyColor: '#ffffff',
    defaultAccentColor: '#ffffff',
    // Xbox-style face labels (printed on the pad). Steam button at 16,
    // View/Menu at 8/9. No 17 (no equivalent of mute/capture on this
    // pad — back paddles surface via parsed.paddles instead).
    hudLabels: {
      0: 'A',  1: 'B',  2: 'X',  3: 'Y',
      4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
      8: 'Vw', 9: 'Mn', 16: 'St', 17: '',
    },
  },
};

/**
 * Auto-detect controller type from Gamepad API id string.
 * @param {string} id — Gamepad.id
 * @returns {string} profile key ('dualsense', 'switch-pro', 'xbox')
 */
export function detectControllerType(id) {
  const lower = id.toLowerCase();
  if (lower.includes('dualsense') || lower.includes('054c')) return 'dualsense';
  if (lower.includes('pro controller') || lower.includes('057e')) return 'switch-pro';
  if (lower.includes('xbox') || lower.includes('045e') || lower.includes('xinput')) return 'xbox';
  return 'dualsense'; // default fallback
}
