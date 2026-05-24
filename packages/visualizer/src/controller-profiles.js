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
    // Procedural highlight markers — the Steam Controller GLB is a
    // single solid body (Valve's published CAD is the external shell
    // only, no assembly parts), so there are no sub-meshes to animate
    // for buttons / sticks / triggers. Instead the visualizer creates
    // small glowing spheres at these positions, parented to bodyGroup
    // so they rotate with the controller, and brightens each one when
    // its mapped button/axis is active.
    //
    // Positions were captured by clicking on the rendered model in the
    // overlay with window.__pickerMode = true (the in-overlay click-
    // to-pick coordinate logger added in PR #18). Each click logs the
    // hit (x, y, z) in body-local coordinates; values pasted here
    // verbatim from that session. Coordinate frame post-fit:
    //   +X = controller right (B button side)
    //   +Y = up out of the face (face buttons at Y≈0.039, stick caps
    //         raised to Y≈0.049, triggers behind face at Y≈-0.014)
    //   +Z = toward the bottom of the controller (grip end). Top edge
    //         where bumpers + Y button sit is at the most negative Z.
    highlightMarkers: {
      buttons: {
        // Face buttons (Xbox arrangement: Y top, A bottom, X left, B right)
        0:  { position: [ 0.0759, 0.0392, -0.0316], color: 0x33dd55, radius: 0.006 },  // A — green
        1:  { position: [ 0.0901, 0.0375, -0.0455], color: 0xdd3333, radius: 0.006 },  // B — red
        2:  { position: [ 0.0619, 0.0406, -0.0468], color: 0x3366dd, radius: 0.006 },  // X — blue
        3:  { position: [ 0.0750, 0.0388, -0.0636], color: 0xeebb22, radius: 0.006 },  // Y — yellow
        // Shoulders (top edge of each grip)
        4:  { position: [-0.0796, 0.0154, -0.0848], color: 0xffaa00, radius: 0.008 },  // LB
        5:  { position: [ 0.0725, 0.0148, -0.0861], color: 0xffaa00, radius: 0.008 },  // RB
        // System buttons (small, flanking Steam button on the face)
        8:  { position: [-0.0459, 0.0384, -0.0669], color: 0xcccccc, radius: 0.004 },  // View
        9:  { position: [ 0.0438, 0.0385, -0.0663], color: 0xcccccc, radius: 0.004 },  // Menu
        // D-pad (mirror of face buttons, on left grip side)
        12: { position: [-0.0785, 0.0387, -0.0601], color: 0x66ccff, radius: 0.005 },  // up
        13: { position: [-0.0795, 0.0384, -0.0363], color: 0x66ccff, radius: 0.005 },  // down
        14: { position: [-0.0905, 0.0374, -0.0482], color: 0x66ccff, radius: 0.005 },  // left
        15: { position: [-0.0683, 0.0394, -0.0507], color: 0x66ccff, radius: 0.005 },  // right
        // Steam button (large center logo)
        16: { position: [ 0.0003, 0.0394, -0.0489], color: 0x66bbff, radius: 0.008 },
        // 2026 Steam Controller "..." Quick Access Menu button. Position
        // captured at [-0.0009, 0.0297, +0.0191] (center-low on face,
        // below the trackpad row). Driver doesn't yet parse a button
        // bit for it — likely one of the "TBD" bits in
        // SteamlessController's byte map (buf[02] bit 4 or buf[04]
        // bit 6). Wire up when the protocol decode adds it; uncomment
        // to surface a marker once the gamepad button index is known.
        // 17: { position: [-0.0009, 0.0297,  0.0191], color: 0xffffff, radius: 0.005 },
      },
      triggers: {
        // Trigger paddles — on the BACK side of the top edge (Y<0)
        6: { position: [-0.0793, -0.0143, -0.0750], color: 0xffcc00, radius: 0.009 },  // LT
        7: { position: [ 0.0760, -0.0135, -0.0758], color: 0xffcc00, radius: 0.009 },  // RT
      },
      stickClicks: {
        // Stick caps — raised above the face (Y≈0.05). The cap itself
        // glows when the user clicks the stick (L3/R3 are buttons
        // 10/11 in Gamepad-API standard).
        10: { position: [-0.0375, 0.0495, -0.0306], color: 0x44aaff, radius: 0.008 },  // L3
        11: { position: [ 0.0348, 0.0494, -0.0282], color: 0x44aaff, radius: 0.008 },  // R3
      },
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
