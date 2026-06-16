// ============================================================
// button-hud-window.js — standalone popout for the 2D button HUD
// ============================================================
//
// Runs in its own BrowserWindow (spawned by Electron main on user demand
// from the Settings panel). Receives gamepad state via IPC from the main
// overlay window every animation frame — not via its own Gamepad API
// polling, because:
//   - Chromium's Gamepad API requires per-document user activation
//     (click/keypress inside the popout window) before reporting state,
//     which is invisible UX for a frameless transparent popout.
//   - The main overlay already has the gamepad working; forwarding state
//     is cheaper than re-establishing it in a second context.
//
// IPC channels (via window.electronAPI from preload.js — generic HUD-window API):
//   - onHudProfileChange — fires when the main window's controller
//     profile changes (dropdown / IMU probe), so labels track
//   - onHudState — fires every frame with the {buttons, axes} snapshot

// Direct relative-path import — does NOT pull in @usersfirst/controller-visualizer's
// index.js barrel, which would transitively load ControllerOverlay + GyroGimbal
// and require `three` in the importmap. The popout has no 3D scene; it only
// needs PROFILES for the hudLabels block.
import { PROFILES } from '../lib/controller-visualizer/controller-profiles.js';

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
         dot:  document.querySelector('#button-hud [data-stick="l"] .bh-stick-dot'),
         line: document.querySelector('#button-hud [data-stick="l"] .bh-stick-line') },
    r: { wrap: document.querySelector('#button-hud [data-stick="r"]'),
         dot:  document.querySelector('#button-hud [data-stick="r"] .bh-stick-dot'),
         line: document.querySelector('#button-hud [data-stick="r"] .bh-stick-line') },
  },
};
document.querySelectorAll('#button-hud [data-btn]').forEach(el => {
  refs.buttons[Number(el.getAttribute('data-btn'))] = el;
});

// ── Profile / labels ─────────────────────────────────────────────────
function applyProfile(profileKey) {
  const profile = PROFILES[profileKey] || PROFILES.dualsense;
  profileNameEl.textContent = profile.name || profileKey || 'Controller';

  // Show the back-paddle row only for controllers that map them (slots 18-21).
  document.body.classList.toggle('has-paddles', profile.buttonMap?.[18] !== undefined);

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
if (window.electronAPI?.onHudProfileChange) {
  window.electronAPI.onHudProfileChange((profile) => applyProfile(profile));
}

// ── HUD state update (driven by IPC frames from main) ────────────────
const gripEls = {
  l: document.querySelector('#button-hud [data-grip="l"]'),
  r: document.querySelector('#button-hud [data-grip="r"]'),
};
function applyState(state) {
  if (!state) return;
  const buttons = state.buttons || [];
  for (const [idx, el] of Object.entries(refs.buttons)) {
    const pressed = !!buttons[idx]?.pressed;
    if (el.classList.contains('pressed') !== pressed) el.classList.toggle('pressed', pressed);
  }
  // Capacitive grips (forwarded from main; not in the gamepad).
  if (state.grips) {
    document.body.classList.add('has-grips');
    gripEls.l?.classList.toggle('active', !!state.grips.left);
    gripEls.r?.classList.toggle('active', !!state.grips.right);
  }
  const l2v = buttons[6]?.value || 0;
  const r2v = buttons[7]?.value || 0;
  if (refs.triggers.l2.fill) refs.triggers.l2.fill.style.height = (l2v * 100) + '%';
  if (refs.triggers.r2.fill) refs.triggers.r2.fill.style.height = (r2v * 100) + '%';

  const axes = state.axes || [0, 0, 0, 0];
  const STICK_RADIUS_PCT = 40;
  const placeStick = (s, ax, ay) => {
    const x = (ax || 0) * STICK_RADIUS_PCT;
    const y = (ay || 0) * STICK_RADIUS_PCT;
    if (s.dot) s.dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    if (s.line) {
      s.line.style.width = Math.hypot(x, y) + 'px';
      s.line.style.transform = `rotate(${Math.atan2(y, x) * 180 / Math.PI}deg)`;
    }
  };
  placeStick(refs.sticks.l, axes[0], axes[1]);
  placeStick(refs.sticks.r, axes[2], axes[3]);
  if (refs.sticks.l.wrap) refs.sticks.l.wrap.classList.toggle('pressed', !!buttons[10]?.pressed);
  if (refs.sticks.r.wrap) refs.sticks.r.wrap.classList.toggle('pressed', !!buttons[11]?.pressed);
}

if (window.electronAPI?.onHudState) {
  window.electronAPI.onHudState(applyState);
} else {
  console.warn('[button-hud popout] electronAPI.onHudState is undefined — preload script did not bind; popout will not receive button updates.');
}

// ── Close button (frameless window has no titlebar close) ────────────
closeBtn.addEventListener('click', () => {
  if (window.electronAPI?.closeWindow) window.electronAPI.closeWindow();
  else window.close();
});
// ESC also closes — handy when the popout has focus.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBtn.click();
});
