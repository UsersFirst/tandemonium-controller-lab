// ============================================================
// LOBBY-APP.JS — Seat-select navigator (versus / co-op / solo)
// ============================================================
//
// A controller-driven "player select" built on the controller-core
// ControllerManager. Uses the manager's native slot lifecycle:
//   - press any button        → manager claims a slot  → we seat the player
//   - hold PS/Home 2s          → manager releases slot  → we free the seat
//   - B on a joined seat       → releaseSlotToPool       → free the seat
// On top of that we add mode selection, team/seat topology, a join→ready
// gate, and per-controller lightbar + rumble feedback (DualSense today).
//
// This is the seam that will become Tandemonium's real lobby. Fixing any
// WebHID quirk belongs in packages/core, which flows here (workspace) and
// into the game (sync-controller-core).
// ============================================================

import { ControllerManager, ControllerRegistry } from '@usersfirst/controller-core';

const SLOT_IDS = ['P1', 'P2', 'P3', 'P4'];
const manager = new ControllerManager({ slotIds: SLOT_IDS });
window.__manager = manager;

const $ = (id) => document.getElementById(id);

// ── seat topology per mode ──
const MODES = ['together', 'versus', 'solo'];
function makeSeats(mode) {
  if (mode === 'solo') return { seats: [
      { id: 'cap', role: 'Captain', kind: 'cap', locked: false },
      { id: 'sto', role: 'Stoker', kind: 'sto', locked: true },
    ], fill: ['cap'] };
  if (mode === 'together') return { seats: [
      { id: 'cap', role: 'Captain', kind: 'cap', locked: false },
      { id: 'sto', role: 'Stoker', kind: 'sto', locked: false },
    ], fill: ['cap', 'sto'] };
  return { seats: [
      { id: 'bcap', role: 'Captain', team: 'a' }, { id: 'bsto', role: 'Stoker', team: 'a' },
      { id: 'rcap', role: 'Captain', team: 'b' }, { id: 'rsto', role: 'Stoker', team: 'b' },
    ], fill: ['bcap', 'rcap', 'bsto', 'rsto'] };
}

const state = {
  screen: 'mode',        // mode | lobby | level
  mode: null,
  seats: [], fill: [],
  occ: new Map(),        // seatId -> slotId
  bySlot: new Map(),     // slotId -> { seatId, phase:'joined'|'ready', player }
  nextP: 1,
};

const seat = (id) => state.seats.find((s) => s.id === id);
const teamCount = (t) => state.seats.filter((s) => s.team === t && state.occ.has(s.id)).length;
function nextOpen() { for (const id of state.fill) { const s = seat(id); if (s && !s.locked && !state.occ.has(id)) return s; } return null; }

// ── hardware feedback (DualSense lightbar + rumble; others no-op) ──
const RGB = { cap: { r:122, g:224, b:154 }, sto: { r:255, g:158, b:107 }, a: { r:110, g:168, b:255 }, b: { r:255, g:107, b:125 } };
function seatRGB(seatId) { const s = seat(seatId); if (!s) return RGB.cap; if (s.team) return RGB[s.team]; return s.kind === 'cap' ? RGB.cap : RGB.sto; }
function driverOf(slotId) { const s = manager.getSlot(slotId); return s ? s.driver : null; }
function feedback(slotId, ready) {
  const d = driverOf(slotId); const L = state.bySlot.get(slotId); if (!d || !L) return;
  const c = seatRGB(L.seatId); const k = ready ? 1 : 0.4;
  const lb = { r: (c.r*k)|0, g: (c.g*k)|0, b: (c.b*k)|0 };
  const pat = (d.constructor && d.constructor.PLAYER_LED_PATTERNS && d.constructor.PLAYER_LED_PATTERNS[L.player]) || 0;
  try {
    if (typeof d.setPlayerFeedback === 'function') d.setPlayerFeedback({ playerLEDs: pat, lightbar: lb });
    else if (typeof d.setLightbar === 'function') d.setLightbar(lb.r, lb.g, lb.b);
  } catch (e) {}
}
function clearFb(slotId) {
  const d = driverOf(slotId); if (!d) return;
  try {
    if (typeof d.setPlayerFeedback === 'function') d.setPlayerFeedback({ playerLEDs: 0, lightbar: { r:0, g:0, b:0 } });
    else if (typeof d.setLightbar === 'function') d.setLightbar(0, 0, 0);
  } catch (e) {}
}
function rumble(slotId, kind) {
  const d = driverOf(slotId); if (!d || typeof d.setRumble !== 'function') return;
  try { d.setRumble(0.6, 0.6, 110); if (kind === 'double') setTimeout(() => { try { d.setRumble(0.6, 0.6, 110); } catch (e) {} }, 150); } catch (e) {}
}

// ── seat transitions ──
function assignSeat(slot) {
  const s = nextOpen(); if (!s) return;
  state.occ.set(s.id, slot.id);
  state.bySlot.set(slot.id, { seatId: s.id, phase: 'joined', player: state.nextP++ });
  feedback(slot.id, false); rumble(slot.id, 'single'); render();
}
function freeSeat(slotId) {
  const L = state.bySlot.get(slotId); if (!L) return;
  state.occ.delete(L.seatId); state.bySlot.delete(slotId); clearFb(slotId); render();
}
function readyUp(slotId) { const L = state.bySlot.get(slotId); if (!L || L.phase !== 'joined') return; L.phase = 'ready'; feedback(slotId, true); rumble(slotId, 'double'); render(); }
function unready(slotId) { const L = state.bySlot.get(slotId); if (!L || L.phase !== 'ready') return; L.phase = 'joined'; feedback(slotId, false); render(); }
function leaveSlot(slotId) { clearFb(slotId); manager.releaseSlotToPool(slotId); }   // sync() frees the seat next frame
function switchTeam(slotId, dir) {
  const L = state.bySlot.get(slotId); if (!L) return; const s = seat(L.seatId); if (!s || !s.team) return;
  const other = s.team === 'a' ? 'b' : 'a';
  const target = state.seats.find((x) => x.team === other && x.role === s.role && !state.occ.has(x.id))
              || state.seats.find((x) => x.team === other && !state.occ.has(x.id));
  if (!target) return;
  state.occ.delete(s.id); state.occ.set(target.id, slotId); L.seatId = target.id;
  feedback(slotId, L.phase === 'ready'); render();
}

function minMet() {
  if (state.mode === 'solo') return state.occ.has('cap');
  if (state.mode === 'together') return state.occ.has('cap') && state.occ.has('sto');
  return teamCount('a') >= 1 && teamCount('b') >= 1;
}
function allReady() { const j = [...state.bySlot.keys()]; return j.length > 0 && minMet() && j.every((id) => state.bySlot.get(id).phase === 'ready'); }

// ── per-slot edge detection ──
const edge = new Map();
function btns(gp) {
  const p = (i) => !!(gp && gp.buttons && gp.buttons[i] && gp.buttons[i].pressed);
  const ax = (gp && gp.axes) || [];
  return { a: p(0), b: p(1), start: p(9),
    up: p(12) || (ax[1] || 0) < -0.5, down: p(13) || (ax[1] || 0) > 0.5,
    left: p(14) || (ax[0] || 0) < -0.5, right: p(15) || (ax[0] || 0) > 0.5 };
}
function edges(slotId, gp) {
  const prev = edge.get(slotId) || {}; const cur = btns(gp); const f = {};
  for (const k in cur) f[k] = cur[k] && !prev[k];
  edge.set(slotId, cur); return f;
}

// ── device naming ──
function devName(slotId) {
  const s = manager.getSlot(slotId);
  const raw = (s && s.hidDevice && s.hidDevice.productName) || (s && s.controllerLabel) || '';
  const info = ControllerRegistry.identifyFromGamepadId(raw);
  return info && info.driverName ? info.driverName : 'Controller';
}

// ── screens ──
function showScreen(name) {
  state.screen = name;
  edge.clear();   // re-prime every slot on the new screen (a button still held from the last screen won't fire)
  $('step-mode').hidden = name !== 'mode';
  $('step-lobby').hidden = name !== 'lobby';
  $('step-level').hidden = name !== 'level';
}

let modeIdx = 0;
function setModeIdx(i) {
  modeIdx = (i + MODES.length) % MODES.length;
  document.querySelectorAll('#step-mode [data-mode]').forEach((b, k) => b.classList.toggle('sel', k === modeIdx));
}
function enterMode(mode) {
  state.mode = mode; const m = makeSeats(mode); state.seats = m.seats; state.fill = m.fill;
  state.occ.clear(); state.bySlot.clear(); state.nextP = 1;
  $('lobby-title').textContent = mode === 'versus' ? 'Build your teams' : mode === 'solo' ? 'Solo ride' : 'Crew your tandem';
  $('join-hint').innerHTML = mode === 'versus'
    ? 'Press a button to join · <strong>◀ ▶</strong> switch team · <strong>A</strong> ready · <strong>B</strong> leave'
    : 'Press a button to claim a seat · <strong>A</strong> ready · <strong>B</strong> leave';
  showScreen('lobby'); syncSeats(); render();
}
function goLevel() {
  if (!allReady()) return;
  const parts = [];
  if (state.mode === 'versus') parts.push(`<span class="big">${teamCount('a')} v ${teamCount('b')}</span>Team Blue vs Team Red`);
  else if (state.mode === 'solo') parts.push(`<span class="big">Solo</span>`);
  else parts.push(`<span class="big">Co-op</span>Captain + Stoker`);
  const roster = state.seats.filter((s) => state.occ.has(s.id)).map((s) => {
    const slotId = state.occ.get(s.id); const L = state.bySlot.get(slotId);
    return `${s.role}: P${L ? L.player : '?'} <span style="opacity:.6">(${devName(slotId)})</span>`;
  }).join('<br>');
  $('level-summary').innerHTML = parts.join('') + '<br><br>' + roster;
  for (const id of state.bySlot.keys()) clearFb(id);
  showScreen('level');
}

// ── render ──
function cardHTML(s) {
  const kind = s.team ? (s.team === 'a' ? 'ta' : 'tb') : s.kind;
  if (s.locked) return `<div class="seat locked"><span class="role">${s.role}</span><span class="who">LOCKED</span><span class="dev">solo</span></div>`;
  const slotId = state.occ.get(s.id);
  if (slotId) {
    const L = state.bySlot.get(slotId); const rdy = L && L.phase === 'ready';
    return `<div class="seat ${kind} ${rdy ? 'ready' : 'joined'}"><span class="badge">P${L ? L.player : '?'}</span>${rdy ? '<span class="check">✓ READY</span>' : ''}<span class="role">${s.role}</span><span class="who">${devName(slotId)}</span><span class="dev">${rdy ? 'ready' : 'press A to ready'}</span></div>`;
  }
  return `<div class="seat open" data-seat="${s.id}"><span class="role">${s.role}</span><span class="who">OPEN</span><span class="dev">press a button</span></div>`;
}
function render() {
  const area = $('seat-area');
  if (state.mode === 'versus') {
    const col = (t, title) => `<div class="team ${t}"><div class="team-title">${title}</div><div class="team-slots">${state.seats.filter((s) => s.team === t).map(cardHTML).join('')}</div></div>`;
    area.innerHTML = `<div class="teams">${col('a', 'TEAM BLUE')}<div class="vs">VS</div>${col('b', 'TEAM RED')}</div>`;
  } else {
    area.innerHTML = `<div class="tandem"><div class="tandem-title">🚲 YOUR TANDEM</div><div class="tandem-seats">${state.seats.map(cardHTML).join('')}</div></div>`;
  }
  updateCTA(); updateDebug();
}
function updateCTA() {
  const btn = $('btn-choose-level'); const r = allReady();
  btn.disabled = !r; btn.classList.toggle('ready', r);
  const mu = state.mode === 'versus' && (teamCount('a') || teamCount('b')) ? ` (${teamCount('a')} v ${teamCount('b')})` : '';
  btn.textContent = (r ? '▶ CHOOSE LEVEL' : 'CHOOSE LEVEL') + mu;
}
function updateDebug() {
  const el = $('debug'); if (!el) return;
  const parts = manager.slots.filter((s) => s.state === 'claimed').map((s) => {
    const L = state.bySlot.get(s.id); const d = s.driver;
    return `${s.id}:${devName(s.id).split(' ')[0]}${L ? '·' + L.phase : ''}[${d ? (d.connectionType || 'hid') : 'no-hid'}]`;
  });
  el.textContent = (parts.join('   ') || 'no controllers — press a button to join') + (allReady() ? '   ✓ ALL READY' : '');
}
function updateControllerCount() {
  const el = $('ctrl-count'); if (!el) return;
  const claimed = manager.slots.filter((s) => s.state === 'claimed').length;
  const pooled = manager._hidPool.size;
  el.textContent = (claimed === 0 && pooled === 0)
    ? 'no controllers — press a button or Pair →'
    : `${claimed} active${pooled ? ` · ${pooled} paired` : ''}`;
}
// Approve/pool the next controller (main.js auto-selects a not-yet-picked one).
// requestDevice needs the click as its user gesture; the Steam Controller is
// HID-only, so it can only be recognized after this.
function pairController() {
  const free = SLOT_IDS.find((id) => manager.getSlot(id).state !== 'claimed') || SLOT_IDS[0];
  manager.connectHidForSlot(free).catch((err) => { const el = $('debug'); if (el) el.textContent = 'pair: ' + (err && err.message ? err.message : String(err)); });
}

// ── slot lifecycle sync (claim→seat, release→free) ──
function syncSeats() {
  for (const s of manager.slots) if (s.state === 'claimed' && !state.bySlot.has(s.id)) assignSeat(s);
  for (const id of [...state.bySlot.keys()]) { const s = manager.getSlot(id); if (!s || s.state !== 'claimed') freeSeat(id); }
}

// ── per-screen input drivers ──
// Prime-and-skip: a slot with no edge history (just claimed, or first frame on
// a screen) records its current button state and takes no action this frame,
// so the button that CLAIMED the slot can't also trigger select/ready.
function primeOrEdges(slot, gp) {
  if (!edge.has(slot.id)) { edge.set(slot.id, btns(gp)); return null; }
  return edges(slot.id, gp);
}
function driveMode(pads) {
  for (const s of manager.slots) {
    if (s.state !== 'claimed') { edge.delete(s.id); continue; }
    const e = primeOrEdges(s, s.effectiveGamepad(pads)); if (!e) continue;
    if (e.a) { enterMode(MODES[modeIdx]); return; }
    if (e.up) setModeIdx(modeIdx - 1); else if (e.down) setModeIdx(modeIdx + 1);
  }
}
function driveLobby(pads) {
  syncSeats();
  let start = false;
  for (const s of manager.slots) {
    if (s.state !== 'claimed') { edge.delete(s.id); continue; }
    const L = state.bySlot.get(s.id); if (!L) continue;
    const e = primeOrEdges(s, s.effectiveGamepad(pads)); if (!e) continue;
    if (e.start) start = true;
    if (L.phase === 'joined') {
      if (e.a) readyUp(s.id);
      else if (e.b) leaveSlot(s.id);
      else if (e.left) switchTeam(s.id, -1);
      else if (e.right) switchTeam(s.id, 1);
    } else if (L.phase === 'ready') {
      if (e.b) unready(s.id);
    }
  }
  if (start && allReady()) goLevel();
}

// ── boot + loop ──
function loop() {
  const now = performance.now();
  const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
  try {
    manager.ingestFrame(pads, now);
    if (state.screen === 'mode') driveMode(pads);
    else if (state.screen === 'lobby') driveLobby(pads);
    updateDebug();
    updateControllerCount();
  } catch (e) {
    console.error('[lobby] frame error (recovered):', e);
    const el = $('debug'); if (el) el.textContent = 'ERROR: ' + (e && e.message ? e.message : String(e));
  }
  requestAnimationFrame(loop);
}

async function boot() {
  // Mode buttons: click + controller.
  document.querySelectorAll('#step-mode [data-mode]').forEach((b, k) => {
    b.addEventListener('click', () => { setModeIdx(k); enterMode(b.dataset.mode); });
    b.addEventListener('mouseenter', () => setModeIdx(k));
  });
  $('btn-back-mode').addEventListener('click', () => { for (const id of state.bySlot.keys()) clearFb(id); showScreen('mode'); });
  $('btn-choose-level').addEventListener('click', goLevel);
  $('btn-restart').addEventListener('click', () => enterMode(state.mode));
  $('btn-pair').addEventListener('click', pairController);
  $('btn-pair-global').addEventListener('click', pairController);

  drawQR($('room-qr'), 'TNDM-7F3K');
  setModeIdx(0);

  if (navigator.hid) {
    // Pool already-approved controllers (gesture-free). New ones pair via the
    // per-slot "Pair" button (connectHidForSlot needs a user gesture); hot-plug
    // of approved devices is handled by wireHidHotplug.
    await manager.autoPoolApprovedHid();
    manager.wireHidHotplug();
  }
  loop();
}

// ── deterministic fake QR (online-join affordance) ──
function drawQR(cv, seed) {
  if (!cv) return; const ctx = cv.getContext('2d'); const n = 21, cell = cv.width / n;
  ctx.fillStyle = '#081109'; ctx.fillRect(0, 0, cv.width, cv.height);
  let h = 0x811c9dc5; for (const c of seed) { h ^= c.charCodeAt(0); h = (h * 0x01000193) >>> 0; }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  ctx.fillStyle = '#d7ffe6';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (rnd() > 0.5) ctx.fillRect(x*cell, y*cell, cell, cell);
  const f = (ox, oy) => { ctx.fillStyle = '#081109'; ctx.fillRect(ox*cell, oy*cell, 7*cell, 7*cell); ctx.fillStyle = '#d7ffe6'; ctx.fillRect((ox+1)*cell, (oy+1)*cell, 5*cell, 5*cell); ctx.fillStyle = '#081109'; ctx.fillRect((ox+2)*cell, (oy+2)*cell, 3*cell, 3*cell); };
  f(0, 0); f(n-7, 0); f(0, n-7);
}

boot();
