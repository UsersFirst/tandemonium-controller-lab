// ============================================================
// button-hud-window.js — standalone popout for the 2D button HUD
// ============================================================
//
// Runs in its own BrowserWindow (spawned by Electron main on user demand
// from the Settings panel). Self-contained: polls navigator.getGamepads()
// directly rather than receiving state via IPC from the main window —
// Gamepad API is window-scoped but sees the same physical controllers,
// so this avoids per-frame IPC chatter.
//
// IPC is only used for two things:
//   1. Initial profile (passed via URL query at open-time as ?profile=key)
//   2. Mid-session profile changes (main forwards 'profile-changed' via
//      window.electronAPI.onPopoutProfileChange)

import { PROFILES } from '@usersfirst/controller-visualizer';

// ── DOM refs ─────────────────────────────────────────────────────────
const profileNameEl = document.getElementById('profile-name');
const closeBtn = document.getElementById('close-btn');

const refs = {
  buttons: {},
  triggers: {
    l2: { fill: document.querySelector('#button-hud [data-trigger="l2"] .bh-trigger-fill'),
          label: document.querySelector('#button-hud [data-trigger="l2"] .bh-trigger-label') },
    r2: { fill: document.querySelector('#button-hud [data-trigger="r2"] .bh-trigger-fill'),
          label: document.querySelector('#button-hud [data-trigger="r2"] .bh-trigger-label') },
  },
  sticks: {
    l: { wrap: document.querySelector('#button-hud [data-stick="l"]'),
         dot:  document.querySelector('#button-hud [data-stick="l"] .bh-stick-dot') },
    r: { wrap: document.querySelector('#button-hud [data-stick="r"]'),
         dot:  document.querySelector('#button-hud [data-stick="r"] .bh-stick-dot') },
  },
};
document.querySelectorAll('#button-hud [data-btn]').forEach(el => {
  refs.buttons[Number(el.getAttribute('data-btn'))] = el;
});

// ── Profile / labels ─────────────────────────────────────────────────
function applyProfile(profileKey) {
  const profile = PROFILES[profileKey] || PROFILES.dualsense;
  profileNameEl.textContent = profile.name || profileKey || 'Controller';

  const labels = profile.hudLabels;
  if (!labels) return;
  for (const [idxStr, el] of Object.entries(refs.buttons)) {
    const label = labels[Number(idxStr)];
    if (label !== undefined) el.textContent = label;
  }
  if (refs.triggers.l2.label && labels[6] !== undefined) refs.triggers.l2.label.textContent = labels[6];
  if (refs.triggers.r2.label && labels[7] !== undefined) refs.triggers.r2.label.textContent = labels[7];
}

// Initial profile from URL ?profile=key
const params = new URLSearchParams(window.location.search);
applyProfile(params.get('profile') || 'dualsense');

// Mid-session updates from the main window (controller-type dropdown
// changed, IMU probe swapped profile, etc.) come through here.
if (window.electronAPI?.onPopoutProfileChange) {
  window.electronAPI.onPopoutProfileChange((profile) => applyProfile(profile));
}

// ── Per-frame HUD update ─────────────────────────────────────────────
function findActiveGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) if (gp && gp.connected) return gp;
  return null;
}

function update(gamepad) {
  const buttons = gamepad?.buttons || [];
  for (const [idx, el] of Object.entries(refs.buttons)) {
    const pressed = !!buttons[idx]?.pressed;
    if (el.classList.contains('pressed') !== pressed) el.classList.toggle('pressed', pressed);
  }
  const l2v = buttons[6]?.value || 0;
  const r2v = buttons[7]?.value || 0;
  if (refs.triggers.l2.fill) refs.triggers.l2.fill.style.height = (l2v * 100) + '%';
  if (refs.triggers.r2.fill) refs.triggers.r2.fill.style.height = (r2v * 100) + '%';

  const axes = gamepad?.axes || [0, 0, 0, 0];
  const STICK_RADIUS_PCT = 40;
  if (refs.sticks.l.dot) {
    const x = (axes[0] || 0) * STICK_RADIUS_PCT;
    const y = (axes[1] || 0) * STICK_RADIUS_PCT;
    refs.sticks.l.dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }
  if (refs.sticks.r.dot) {
    const x = (axes[2] || 0) * STICK_RADIUS_PCT;
    const y = (axes[3] || 0) * STICK_RADIUS_PCT;
    refs.sticks.r.dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }
  if (refs.sticks.l.wrap) refs.sticks.l.wrap.classList.toggle('pressed', !!buttons[10]?.pressed);
  if (refs.sticks.r.wrap) refs.sticks.r.wrap.classList.toggle('pressed', !!buttons[11]?.pressed);
}

function loop() {
  requestAnimationFrame(loop);
  update(findActiveGamepad());
}

// Gamepad events fire only after a button press on a fresh pad — this is
// just a heads-up log, not required for operation.
window.addEventListener('gamepadconnected', (e) => {
  console.log('[button-hud-window] gamepad connected:', e.gamepad.id);
});

requestAnimationFrame(loop);

// ── Close button (frameless window has no titlebar close) ────────────
closeBtn.addEventListener('click', () => {
  if (window.electronAPI?.closeWindow) window.electronAPI.closeWindow();
  else window.close();
});
// ESC also closes — handy when the popout has focus.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBtn.click();
});
