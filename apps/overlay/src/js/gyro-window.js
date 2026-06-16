// ============================================================
// GYRO HUD WINDOW — detached 3D gyro display (issue #64)
// ============================================================
//
// Renders the GyroGimbal in its own transparent, always-on-top window. The
// main overlay forwards the controller orientation each frame over IPC
// ('hud-state-update', kind 'gyro') as a plain {q:{x,y,z,w}, active, fullMode}
// snapshot — this window has no HID/Gamepad connection of its own.
//
// GyroGimbal.update() renders on each call, so we just drive it from the
// incoming state (≈60 Hz). On null/inactive it renders the rest pose.

import * as THREE from 'three';
import { GyroGimbal } from '@usersfirst/controller-visualizer';

const canvas = document.getElementById('gyro-canvas');
const gimbal = new GyroGimbal(canvas);
gimbal.fullMode = false;
try {
  new ResizeObserver(() => gimbal.resize()).observe(canvas);
} catch (_) { /* ResizeObserver unavailable — fixed-size window still works */ }

// Initial paint so the gimbal is visible before the first state arrives.
gimbal.update(null);

const q = new THREE.Quaternion();
if (window.electronAPI?.onHudState) {
  window.electronAPI.onHudState((s) => {
    if (s && typeof s.fullMode === 'boolean') gimbal.fullMode = s.fullMode;
    if (s && s.active && s.q) {
      q.set(s.q.x, s.q.y, s.q.z, s.q.w);
      gimbal.update(q);
    } else {
      gimbal.update(null);
    }
  });
} else {
  console.warn('[gyro window] electronAPI.onHudState is undefined — preload did not bind; gyro will not update.');
}

const closeBtn = document.getElementById('close-btn');
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    if (window.electronAPI?.closeWindow) window.electronAPI.closeWindow();
  });
}
