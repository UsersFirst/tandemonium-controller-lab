// ============================================================
// MULTI-APP.JS — Dynamic multi-controller overlay view layer
// ============================================================
//
// Thin view on top of controller-core's ControllerManager. The manager owns all
// slot state, claim/release lifecycle, HID pairing, and sensor fusion. This file
// only renders it.
//
// DESIGN (dynamic roster): there are no fixed "Press to join" panels. The
// manager holds a generous pool of empty slots (MAX_PLAYERS); a PLAYER n panel
// is created the moment a controller CLAIMS a slot (goes ACTIVE) and disposed
// when it releases — so the grid grows/shrinks with the number of active
// players. Every connected-but-idle controller shows in the AVAILABLE list
// (toggled by the List button); pressing a button on one promotes it to its own
// PLAYER panel. The slot ordinal is the player number, so numbers are sticky
// across a brief drop (the manager's orphan→reconnect keeps the seat).
//
// WebHID-first: controllers are pooled over WebHID (autoPoolApprovedHid, gate-
// free) and the manager's ingestFrame claims them; the Gamepad API / XInput is
// the fallback for pads without a WebHID driver (Xbox). A periodic re-pool picks
// up a controller powered on AFTER launch. See [[multi-steam-controller]].
// ============================================================

import { ControllerOverlay, detectControllerType } from '@usersfirst/controller-visualizer';
import { ControllerRegistry, ControllerManager } from '@usersfirst/controller-core';

// Pre-allocated slot cap. Panels/canvases are only created for CLAIMED slots, so
// the real cost scales with active players, not this number. 16 is well past a
// practical local-multiplayer ceiling; bump if ever needed.
const MAX_PLAYERS = 16;
const SLOT_IDS = Array.from({ length: MAX_PLAYERS }, (_, i) => `P${i + 1}`);

// Re-pool interval: a controller powered on after launch streams into an
// already-enumerated interface (no WebHID 'connect' event), so we periodically
// re-run autoPoolApprovedHid to pick it up. Cheap (getDevices + a set check).
const RESCAN_MS = 3000;

const manager = new ControllerManager({ slotIds: SLOT_IDS });
window.__manager = manager;   // DevTools

// ── Per-player accent color (generated for all MAX_PLAYERS) ──
// Golden-angle hue spacing keeps 16 players visually distinct. Applied inline so
// we don't need a CSS class per player.
function playerHue(playerNum) { return Math.round(((playerNum - 1) * 137.508) % 360); }
function applyPlayerColor(root, titleEl, playerNum) {
  const h = playerHue(playerNum);
  root.style.borderColor = `hsla(${h}, 72%, 62%, 0.45)`;
  root.style.boxShadow = `0 0 30px hsla(${h}, 72%, 52%, 0.18) inset`;
  if (titleEl) titleEl.style.color = `hsl(${h}, 72%, 72%)`;
}

// ── View: per-slot DOM wiring (created on claim, disposed on release) ──

class SlotView {
  constructor(slot, root, playerNum) {
    this.slot = slot;
    this.root = root;
    this.playerNum = playerNum;
    this.canvas = root.querySelector('[data-role="canvas"]');
    this.promptEl = root.querySelector('[data-role="prompt"]');
    this.hintEl = root.querySelector('[data-role="hint"]');
    this.subEl = root.querySelector('[data-role="sub"]');
    this.ringEl = root.querySelector('[data-role="ring"]');
    this.connectBtn = root.querySelector('[data-role="connect-hid"]');
    this.calibBtn = root.querySelector('[data-role="calibrate"]');
    this.diagBtn = root.querySelector('[data-role="diag-toggle"]');
    this.diagEl = root.querySelector('[data-role="diag"]');

    this.overlay = null;
    this.controllerType = 'dualsense';
    this._diagLastUpdate = 0;
    this._unsub = null;

    root.setAttribute('data-slot', slot.id);
    const titleEl = root.querySelector('.slot-title');
    this.titleEl = titleEl;
    if (titleEl) titleEl.textContent = `Player ${playerNum}`;
    applyPlayerColor(root, titleEl, playerNum);

    if (this.connectBtn) {
      this.connectBtn.addEventListener('click', () => {
        manager.connectHidForSlot(slot.id).catch((err) => {
          this.hintEl.textContent = `HID error: ${err.message}`;
        });
      });
    }
    if (this.diagBtn) {
      this.diagBtn.addEventListener('click', () => {
        if (!this.diagEl) return;
        if (this.diagEl.hasAttribute('hidden')) this.diagEl.removeAttribute('hidden');
        else this.diagEl.setAttribute('hidden', '');
      });
    }
    if (this.calibBtn) {
      this.calibBtn.addEventListener('click', () => {
        if (slot.fusion) {
          slot.startGyroCalibration();
          this.hintEl.textContent = 'Calibrating gyro — hold still…';
        }
      });
    }

    this._unsub = slot.on((s, reason, data) => this._onSlotChange(reason, data));
    // The view is created the frame AFTER the claim, so we missed the initial
    // 'claimed'/'hid-bound' events — render current state directly instead.
    this._renderClaimed();
    this._renderHidBadge(!!slot._hidEntry);
    if (slot.state === 'orphan') { this.root.classList.add('orphan'); this.hintEl.textContent = 'Reconnecting…'; }
  }

  async initOverlay(controllerType) {
    this.controllerType = controllerType || 'dualsense';
    this.overlay = new ControllerOverlay({
      canvas: this.canvas,
      transparent: true,
      controllerType: this.controllerType,
    });
    await this.overlay.init();
    this._resize();
  }

  dispose() {
    if (this._unsub) { try { this._unsub(); } catch {} this._unsub = null; }
    try { this.overlay?.dispose?.(); } catch {}
    this.overlay = null;
    this.root.remove();
  }

  _resize() {
    if (!this.overlay || !this.canvas) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w > 0 && h > 0) this.overlay.resize(w, h);
  }

  _onSlotChange(reason, data) {
    const s = this.slot;
    switch (reason) {
      case 'claimed':
        this.root.classList.remove('orphan');
        this._renderClaimed();
        break;
      case 'orphaned':
        this.hintEl.textContent = 'Reconnecting…';
        this.root.classList.add('orphan');
        break;
      case 'hid-bound':
        this._renderHidBadge(true);
        break;
      case 'hid-unbound':
        this._renderHidBadge(false);
        break;
      case 'ring':
        this._renderRing(s.ringPct);
        break;
      case 'hid-report':
        if (data?.touchpad && this.overlay?.updateTouchpad) {
          this.overlay.updateTouchpad(data.touchpad, data.touchpadButton);
        }
        break;
      // 'released' is handled by the loop's view reconciliation (disposes us).
    }
  }

  _renderClaimed() {
    const s = this.slot;
    this.root.classList.remove('empty', 'orphan');
    this.root.classList.add('claimed');
    this.promptEl.textContent = labelForGamepad(s.controllerLabel);
    this.hintEl.textContent = 'Hold PS/Home 2s to release';
    this.subEl.textContent = (s.controllerId || '').slice(0, 28);

    const idInfo = ControllerRegistry.identifyFromGamepadId(s.controllerLabel || '');
    const desired = idInfo?.controllerProfile || detectControllerType(s.controllerLabel || '') || 'dualsense';
    if (desired !== this.controllerType && this.overlay) {
      this.controllerType = desired;
      this.overlay.setControllerType(desired);
    }
  }

  _renderRing(pct) {
    if (!this.ringEl) return;
    if (pct > 0) {
      this.ringEl.classList.add('visible');
      this.ringEl.style.setProperty('--p', String(pct));
    } else {
      this.ringEl.classList.remove('visible');
      this.ringEl.style.setProperty('--p', '0');
    }
  }

  _renderHidBadge(on) {
    if (!this.connectBtn) return;
    this.connectBtn.classList.toggle('status', on);
    this.connectBtn.textContent = on ? 'Gyro Connected' : 'Connect Gyro (WebHID)';
    if (this.calibBtn) this.calibBtn.style.display = on ? '' : 'none';
  }

  tick(pads) {
    const s = this.slot;
    const isCalibrating = !!(s.fusion && s.fusion.calibrating);
    if (s._wasCalibrating && !isCalibrating) {
      s.fusion?.reset();
      this.hintEl.textContent = s.state === 'claimed' ? 'Hold PS/Home 2s to release' : '';
    }
    s._wasCalibrating = isCalibrating;

    const gp = s.effectiveGamepad(pads);
    const gyroQ = (s.state === 'claimed' && s.fusion) ? s.fusion.orientation : null;
    if (this.overlay) this.overlay.update(gp, gyroQ);
  }
}

function labelForGamepad(gamepadIdString) {
  const idInfo = ControllerRegistry.identifyFromGamepadId(gamepadIdString || '');
  const type = idInfo?.protocol || detectControllerType(gamepadIdString || '');
  if (type === 'steam-controller') return 'Steam Controller connected';
  if (type === 'dualsense') return 'DualSense connected';
  if (type === 'switch-pro') return 'Switch Pro connected';
  if (type === 'xbox') return 'Xbox Controller connected';
  return 'Controller connected';
}

// ── Dynamic view lifecycle ──
// A PLAYER panel exists iff its slot is non-empty. Reconciled each frame so it
// stays correct however the slot got claimed/released (button press, PS-hold,
// hot-plug, reconnect) without threading events through view creation.

const slotsContainer = document.getElementById('slots');
const slotTemplate = document.getElementById('slot-template');
const emptyState = document.getElementById('empty-state');
const views = new Map(); // slotId -> SlotView

function playerNumFor(slot) { return manager.slots.indexOf(slot) + 1; }

function ensureView(slot) {
  if (views.has(slot.id)) return views.get(slot.id);
  const fragment = slotTemplate.content.cloneNode(true);
  const root = fragment.querySelector('.slot');
  slotsContainer.appendChild(fragment);
  const view = new SlotView(slot, root, playerNumFor(slot));
  views.set(slot.id, view);
  // Model + gyro: derive the profile from the controller that just claimed.
  const idInfo = ControllerRegistry.identifyFromGamepadId(slot.controllerLabel || '');
  const type = idInfo?.controllerProfile || detectControllerType(slot.controllerLabel || '') || 'dualsense';
  view.initOverlay(type).catch((err) => console.error(`[${slot.id}] overlay init failed`, err));
  return view;
}

function disposeView(slot) {
  const view = views.get(slot.id);
  if (!view) return;
  view.dispose();
  views.delete(slot.id);
}

function reconcileViews() {
  for (const slot of manager.slots) {
    const shouldShow = slot.state !== 'empty';
    if (shouldShow && !views.has(slot.id)) ensureView(slot);
    else if (!shouldShow && views.has(slot.id)) disposeView(slot);
  }
  if (emptyState) emptyState.classList.toggle('hidden', views.size > 0);
}

// ── AVAILABLE / PLAYER roster list (toggled by the List button) ──

const listPanel = document.getElementById('controller-list');
const listBody = document.getElementById('controller-list-body');
const listCount = document.getElementById('controller-list-count');
const listToggle = document.getElementById('list-toggle');
if (listToggle && listPanel) {
  listToggle.addEventListener('click', () => {
    const open = listPanel.classList.toggle('hidden');
    listToggle.classList.toggle('open', !open);
  });
}

function ctrlName(device) {
  const e = ControllerRegistry.getEntry(device.vendorId, device.productId);
  if (e && e.name) return e.name;
  return device.productName || 'Controller';
}
function vpStr(d) {
  return `${(d.vendorId || 0).toString(16).padStart(4, '0')}:${(d.productId || 0).toString(16).padStart(4, '0')}`;
}
function synthActive(gp) {
  if (!gp) return false;
  for (const b of (gp.buttons || [])) if (b && (b.pressed || (b.value || 0) > 0.5)) return true;
  for (const a of (gp.axes || [])) if (Math.abs(a) > 0.5) return true;
  return false;
}

// Build the roster: every claimed controller (as PLAYER n) + every pooled,
// streaming controller (as AVAILABLE). Fan-out (Steam Puck) idle sibling
// interfaces are hidden — only a streaming interface is a real controller.
function rosterRows() {
  const rows = [];
  for (const slot of manager.slots) {
    if (slot.state === 'empty') continue;
    const d = slot._hidEntry?.device || null;
    rows.push({
      name: d ? ctrlName(d) : (labelForGamepad(slot.controllerLabel) || 'Controller'),
      vp: d ? vpStr(d) : '—',
      state: slot.state === 'orphan' ? `PLAYER ${playerNumFor(slot)} (reconnecting)` : `PLAYER ${playerNumFor(slot)}`,
      active: slot._hidEntry ? synthActive(slot._hidEntry.synthetic) : false,
      sort: playerNumFor(slot),
    });
  }
  let avail = 1000;
  for (const entry of manager._hidPool.values()) {
    const d = entry.device;
    const isFanout = !!entry.driver?.constructor?.needsSiblingFanout;
    if (isFanout && !(entry.hidActiveSince > 0)) continue;   // idle Puck sibling — not a controller
    rows.push({
      name: ctrlName(d),
      vp: vpStr(d),
      state: 'AVAILABLE',
      active: synthActive(entry.synthetic),
      sort: avail++,
    });
  }
  rows.sort((a, b) => a.sort - b.sort);
  // Disambiguate identical names (two Steam bodies share name+vid:pid).
  const counts = new Map();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) || 0) + 1);
  const seen = new Map();
  for (const r of rows) {
    if (counts.get(r.name) > 1) { const n = (seen.get(r.name) || 0) + 1; seen.set(r.name, n); r.name = `${r.name} #${n}`; }
  }
  return rows;
}

let _listLastUpdate = 0;
function renderRoster(now) {
  if (!listBody || !listPanel || listPanel.classList.contains('hidden')) return;
  if (now - _listLastUpdate < 200) return;   // ~5Hz
  _listLastUpdate = now;
  const rows = rosterRows();
  if (listCount) listCount.textContent = String(rows.length);
  if (rows.length === 0) {
    listBody.innerHTML = '<div class="cl-empty">No controllers connected. Power one on.</div>';
    return;
  }
  listBody.innerHTML = rows.map((r) => {
    const isPlayer = r.state.startsWith('PLAYER');
    const dotCls = r.active ? 'on' : (isPlayer ? 'player' : '');
    const stateCls = isPlayer ? 'player' : 'avail';
    return `<div class="cl-row">
      <span class="cl-dot ${dotCls}"></span>
      <span class="cl-name">${escapeHtml(r.name)}</span>
      <span class="cl-vp">${escapeHtml(r.vp)}</span>
      <span class="cl-state ${stateCls}">${escapeHtml(r.state)}</span>
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ── Diagnostics panel (per PLAYER) ──

function hex4(n) { return n != null ? '0x' + n.toString(16).padStart(4, '0') : '—'; }

function renderSlotDiagnostics(view, pads) {
  if (!view.diagEl || view.diagEl.hasAttribute('hidden')) return;
  const now = performance.now();
  if (now - view._diagLastUpdate < 160) return;
  view._diagLastUpdate = now;

  const s = view.slot;
  const gp = s.gamepadIndex != null ? pads[s.gamepadIndex] : null;
  const synth = s.synthetic;
  const hid = s.hidDevice;
  const driver = s.driver;

  const pressedSynth = synth ? synth.buttons.map((b, i) => b.pressed ? i : -1).filter((i) => i >= 0) : [];
  const axesSynth = synth ? synth.axes.map((a) => a.toFixed(2)).join(', ') : '';

  const lines = [];
  lines.push(`<span class="k">── WebHID ──</span>`);
  if (hid) {
    lines.push(`<span class="k">product  </span> <span class="v">${escapeHtml(hid.productName || '(unnamed)')}</span>`);
    lines.push(`<span class="k">vid:pid  </span> <span class="v">${hex4(hid.vendorId)}:${hex4(hid.productId)}</span>`);
    lines.push(`<span class="k">driver   </span> <span class="ok">${escapeHtml(driver?.entry?.name || '?')}</span>  <span class="k">conn</span> <span class="v">${escapeHtml(driver?.connectionType || '?')}</span>`);
    const gyroOk = s.fusion && s.fusion._lastGyroTime > 0 && !s.fusion.calibrating;
    lines.push(`<span class="k">gyro     </span> ${gyroOk ? '<span class="ok">integrating</span>' : (s.fusion?.calibrating ? '<span class="warn">calibrating…</span>' : '<span class="warn">idle</span>')}`);
    lines.push(`<span class="k">synth    </span> pressed=[<span class="v">${pressedSynth.join(',')}</span>] axes=[<span class="v">${escapeHtml(axesSynth)}</span>]`);
  } else {
    lines.push(`<span class="warn">no HID bound</span>`);
  }
  if (gp) lines.push(`<span class="k">gamepad  </span> <span class="v">${escapeHtml(gp.id)}</span>`);

  view.diagEl.innerHTML = lines.join('\n');
}

// ── Debug strip ──

const debugEl = document.getElementById('debug-readout');

function renderDebugStrip(pads) {
  if (!debugEl || debugEl.classList.contains('hidden')) return;
  const lines = [`slots claimed: ${views.size}/${MAX_PLAYERS}`];
  for (const v of views.values()) {
    const s = v.slot;
    const pressed = [];
    if (s.synthetic) for (let b = 0; b < s.synthetic.buttons.length; b++) if (s.synthetic.buttons[b].pressed) pressed.push(b);
    lines.push(`  Player ${v.playerNum} [${s.state}] ${s.hidDevice?.productName || '?'} pressed=[${pressed.join(',')}]`);
  }
  lines.push(`pool (available): ${manager._hidPool.size}`);
  for (const entry of manager._hidPool.values()) {
    const streaming = entry.hidActiveSince > 0;
    const fan = entry.driver?.constructor?.needsSiblingFanout ? ' fanout' : '';
    lines.push(`  [pool] ${entry.device.productName || '?'} ${vpStr(entry.device)}${fan} streaming=${streaming}`);
  }
  const seen = pads.filter(Boolean).length;
  lines.push(`gamepad-api pads: ${seen}`);
  debugEl.textContent = lines.join('\n');
}

// ── Wiring ──

async function boot() {
  window.addEventListener('resize', () => views.forEach((v) => v._resize()));

  if (navigator.hid) {
    // WebHID-first: pool every approved, known device (gate-free). Hot-plug of
    // approved devices + the periodic rescan keep the pool fresh.
    await manager.autoPoolApprovedHid();
    manager.wireHidHotplug();
    setInterval(() => { manager.autoPoolApprovedHid().catch(() => {}); }, RESCAN_MS);
  }

  loop();
}

function loop() {
  const now = performance.now();
  const pads = (navigator.getGamepads && navigator.getGamepads()) || [];

  manager.ingestFrame(pads, now);
  reconcileViews();

  for (const v of views.values()) {
    v.tick(pads);
    renderSlotDiagnostics(v, pads);
  }

  renderRoster(now);
  renderDebugStrip(pads);

  requestAnimationFrame(loop);
}

boot();
