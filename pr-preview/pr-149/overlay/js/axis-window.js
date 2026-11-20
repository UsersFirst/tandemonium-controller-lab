// ============================================================
// AXIS VALUES WINDOW — detached pitch/roll/yaw readout (issue #64)
// ============================================================
//
// Display-only. The main overlay forwards {pitch, roll, yaw, active, colors}
// each frame over IPC ('hud-state-update', kind 'axis'); this window just
// renders the numbers and applies the per-axis colors. Green-screen carries
// over from the main overlay (initial via the open query, live via broadcast).

const elP = document.getElementById('ax-pitch');
const elR = document.getElementById('ax-roll');
const elY = document.getElementById('ax-yaw');
const root = document.documentElement;

// Window chrome (drag / close / green-screen) is handled by hud-window-chrome.js.

if (window.electronAPI?.onHudState) {
  window.electronAPI.onHudState((s) => {
    if (!s) return;
    if (s.colors) {
      root.style.setProperty('--ax-pitch', s.colors.pitch);
      root.style.setProperty('--ax-roll', s.colors.roll);
      root.style.setProperty('--ax-yaw', s.colors.yaw);
    }
    elP.textContent = Math.round(s.pitch || 0) + '°';
    elR.textContent = Math.round(s.roll || 0) + '°';
    elY.textContent = Math.round(s.yaw || 0) + '°';
  });
}
