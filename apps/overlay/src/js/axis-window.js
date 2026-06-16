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

// ── Green-screen carry-over ──
function applyGreenScreen(on, color) {
  document.body.style.background = on ? (color || '#00b140') : 'transparent';
}
const params = new URLSearchParams(window.location.search);
applyGreenScreen(params.get('gs') === '1', params.get('gsColor'));
window.electronAPI?.onHudGreenScreen?.((gs) => applyGreenScreen(gs.on, gs.color));

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

const closeBtn = document.getElementById('close-btn');
if (closeBtn) closeBtn.addEventListener('click', () => window.electronAPI?.closeWindow?.());
