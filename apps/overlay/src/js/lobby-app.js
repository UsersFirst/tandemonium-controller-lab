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
  occ: new Map(),        // seatId -> slotId (seated only)
  bySlot: new Map(),     // slotId -> { seatId: string|null, phase:'active'|'joined'|'ready', player }
                         //   active = recognized, no seat · joined/ready = in a seat (seatId set)
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

// Dim neutral lightbar = recognized (ACTIVE) but not in a seat yet.
function activeFb(slotId) {
  const d = driverOf(slotId); const L = state.bySlot.get(slotId); if (!d || !L) return;
  const lb = { r: 34, g: 36, b: 44 };
  const pat = (d.constructor && d.constructor.PLAYER_LED_PATTERNS && d.constructor.PLAYER_LED_PATTERNS[L.player]) || 0;
  try {
    if (typeof d.setPlayerFeedback === 'function') d.setPlayerFeedback({ playerLEDs: pat, lightbar: lb });
    else if (typeof d.setLightbar === 'function') d.setLightbar(lb.r, lb.g, lb.b);
  } catch (e) {}
}

// ── recognition / seat state machine ──
// PAIRED (pool) → ACTIVE (recognized, no seat) → ASSIGNED (in a Captain/Stoker
// seat: phase joined→ready). B steps out one level; A steps in.
function recognize(slot) {                                   // PAIRED → ACTIVE
  if (state.bySlot.has(slot.id)) return;
  state.bySlot.set(slot.id, { seatId: null, phase: 'active', player: state.nextP++ });
  activeFb(slot.id); rumble(slot.id, 'single'); render();
}
function takeSeat(slotId) {                                   // ACTIVE → ASSIGNED
  const L = state.bySlot.get(slotId); if (!L || L.phase !== 'active') return;
  const s = nextOpen(); if (!s) return;                      // seats full → stay ACTIVE
  state.occ.set(s.id, slotId); L.seatId = s.id; L.phase = 'joined';
  feedback(slotId, false); rumble(slotId, 'single'); render();
}
function leaveSeat(slotId) {                                  // ASSIGNED → ACTIVE
  const L = state.bySlot.get(slotId); if (!L || L.seatId == null) return;
  state.occ.delete(L.seatId); L.seatId = null; L.phase = 'active';
  activeFb(slotId); render();
}
// (No voluntary ACTIVE→AVAILABLE via B — "once active, always active". The only
// way back to AVAILABLE is the manager's PS/Home hold-release or a disconnect,
// both of which empty the manager slot → freeSeat below.)
function freeSeat(slotId) {                                   // manager slot vanished (PS/Home hold or disconnect)
  const L = state.bySlot.get(slotId); if (!L) return;
  if (L.seatId != null) state.occ.delete(L.seatId);
  state.bySlot.delete(slotId); clearFb(slotId); render();
}
function readyUp(slotId) { const L = state.bySlot.get(slotId); if (!L || L.phase !== 'joined') return; L.phase = 'ready'; feedback(slotId, true); rumble(slotId, 'double'); render(); }
function unready(slotId) { const L = state.bySlot.get(slotId); if (!L || L.phase !== 'ready') return; L.phase = 'joined'; feedback(slotId, false); render(); }
function switchTeam(slotId, dir) {
  const L = state.bySlot.get(slotId); if (!L || L.seatId == null) return; const s = seat(L.seatId); if (!s || !s.team) return;
  const other = s.team === 'a' ? 'b' : 'a';
  const target = state.seats.find((x) => x.team === other && x.role === s.role && !state.occ.has(x.id))
              || state.seats.find((x) => x.team === other && !state.occ.has(x.id));
  if (!target) return;
  state.occ.delete(s.id); state.occ.set(target.id, slotId); L.seatId = target.id;
  feedback(slotId, L.phase === 'ready'); render();
}
// ▲▼ in versus: swap Captain ⇄ Stoker within your own team. If the other seat
// is taken, the two players trade seats; if it's open, you just slide over.
function switchRole(slotId) {
  const L = state.bySlot.get(slotId); if (!L || L.seatId == null) return; const s = seat(L.seatId); if (!s || !s.team) return;
  const otherRole = s.role === 'Captain' ? 'Stoker' : 'Captain';
  const target = state.seats.find((x) => x.team === s.team && x.role === otherRole);
  if (!target) return;
  if (state.occ.has(target.id)) {
    const otherSlot = state.occ.get(target.id); const OL = state.bySlot.get(otherSlot);
    state.occ.set(target.id, slotId); state.occ.set(s.id, otherSlot);
    L.seatId = target.id; if (OL) OL.seatId = s.id;
    feedback(slotId, L.phase === 'ready'); if (OL) feedback(otherSlot, OL.phase === 'ready');
  } else {
    state.occ.delete(s.id); state.occ.set(target.id, slotId); L.seatId = target.id;
    feedback(slotId, L.phase === 'ready');
  }
  render();
}

function minMet() {
  if (state.mode === 'solo') return state.occ.has('cap');
  if (state.mode === 'together') return state.occ.has('cap') && state.occ.has('sto');
  return teamCount('a') >= 1 && teamCount('b') >= 1;
}
// Only SEATED controllers gate the launch — an ACTIVE (recognized, seatless)
// controller is a bystander and neither counts nor blocks.
function allReady() {
  const seated = [...state.bySlot.keys()].filter((id) => state.bySlot.get(id).seatId != null);
  return seated.length > 0 && minMet() && seated.every((id) => state.bySlot.get(id).phase === 'ready');
}

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
// Prefer the bound HID driver's real identity: a GameSir Super Nova claims via
// the Gamepad API as DualSense (054c:0ce6) but its bound HID handle knows it's
// a DualShock 4 — so once bound we name it by the driver, not the pad label.
function devName(slotId) {
  const s = manager.getSlot(slotId);
  if (s && s.driver && s.driver.entry && s.driver.entry.name) return s.driver.entry.name;
  const byLabel = ControllerRegistry.identifyFromGamepadId((s && s.controllerLabel) || '');
  if (byLabel && byLabel.driverName) return byLabel.driverName;
  const raw = (s && s.hidDevice && s.hidDevice.productName) || '';
  const byName = ControllerRegistry.identifyFromGamepadId(raw);
  return (byName && byName.driverName) ? byName.driverName : (raw || 'Controller');
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
    ? 'Press a button = active · <strong>A</strong> take seat → ready · <strong>◀ ▶</strong> team · <strong>▲ ▼</strong> swap · <strong>B</strong> back (ready→seat→active) · hold <strong>PS</strong> to release · all ready? <strong>A</strong> → level'
    : 'Press a button = active · <strong>A</strong> take a seat → ready · <strong>B</strong> back (ready→seat→active) · hold <strong>PS/Home</strong> to release · all ready? <strong>A</strong> → level';
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
// Recognized-but-seatless controllers waiting to pick a seat.
function loungeHTML() {
  const active = [...state.bySlot.keys()].filter((id) => state.bySlot.get(id).seatId == null);
  if (!active.length) return '';
  const chips = active.map((id) => {
    const L = state.bySlot.get(id);
    return `<div class="lounge-chip"><span class="lc-badge">P${L.player}</span><span class="lc-name">${devName(id)}</span><span class="lc-hint">press A to take a seat</span></div>`;
  }).join('');
  return `<div class="lounge"><div class="lounge-title">RECOGNIZED · pick a seat</div><div class="lounge-chips">${chips}</div></div>`;
}
function render() {
  const area = $('seat-area');
  let html;
  if (state.mode === 'versus') {
    const col = (t, title) => `<div class="team ${t}"><div class="team-title">${title}</div><div class="team-slots">${state.seats.filter((s) => s.team === t).map(cardHTML).join('')}</div></div>`;
    html = `<div class="teams">${col('a', 'TEAM BLUE')}<div class="vs">VS</div>${col('b', 'TEAM RED')}</div>`;
  } else {
    html = `<div class="tandem"><div class="tandem-title">🚲 YOUR TANDEM</div><div class="tandem-seats">${state.seats.map(cardHTML).join('')}</div></div>`;
  }
  area.innerHTML = html + loungeHTML();
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
  const perf = `[${_frameMs.toFixed(1)}ms/f · ${_workMs.toFixed(1)}ms work · pool ${manager._hidPool.size}] `;
  el.textContent = perf + (parts.join('   ') || 'no controllers — press a button to join') + (allReady() ? '   ✓ ALL READY' : '');
}
let pairMsg = '', pairMsgUntil = 0;
function flashPairMsg(m) { pairMsg = m; pairMsgUntil = performance.now() + 2600; }
function updateControllerCount() {
  const el = $('ctrl-count'); if (!el) return;
  if (pairMsg && performance.now() < pairMsgUntil) { el.textContent = pairMsg; return; }
  const claimed = manager.slots.filter((s) => s.state === 'claimed').length;
  const pooled = manager._hidPool.size;
  el.textContent = (claimed === 0 && pooled === 0)
    ? 'no controllers — press a button or Pair →'
    : `${claimed} in use${pooled ? ` · ${pooled} available` : ''}`;
}
// Approve/pool the next controller (main.js auto-selects a not-yet-picked one).
// requestDevice needs the click as its user gesture; the Steam Controller is
// HID-only, so it can only be recognized after this. Gives visible feedback:
// after boot auto-pools everything, there's often nothing new to pair, and the
// old silent no-op read as "the button is broken".
async function pairController() {
  const free = SLOT_IDS.find((id) => manager.getSlot(id).state !== 'claimed') || SLOT_IDS[0];
  const before = manager._hidPool.size;
  flashPairMsg('pairing…'); openCtrlPanel(true);
  try {
    const dev = await manager.connectHidForSlot(free);
    const after = manager._hidPool.size;
    if (dev) flashPairMsg('paired ✓ ' + (dev.productName || 'controller'));
    else if (after > before) flashPairMsg('paired ✓');
    else flashPairMsg(after ? `nothing new — ${after} already paired` : 'no controller found to pair');
  } catch (err) {
    flashPairMsg('pair failed: ' + (err && err.message ? err.message : String(err)));
  }
}

// ── controllers panel (paired vs active vs open, + live "in use" dot) ──
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function padActive(gp) {
  if (!gp) return false;
  for (const b of (gp.buttons || [])) if (b && (b.pressed || (b.value || 0) > 0.5)) return true;
  for (const a of (gp.axes || [])) if (Math.abs(a) > 0.5) return true;
  return false;
}
function stickMag(gp) { const ax = (gp && gp.axes) || []; return Math.max(Math.abs(ax[0] || 0), Math.abs(ax[1] || 0), Math.abs(ax[2] || 0), Math.abs(ax[3] || 0)); }
// vid:pid string — the definitive identity, so a row that reads "DualSense" over
// the Gamepad API vs its true WebHID handle is unambiguous.
function vpStr(vp) { return vp ? ((vp.vendorId || 0).toString(16).padStart(4, '0') + ':' + (vp.productId || 0).toString(16).padStart(4, '0')) : '—'; }

// ── per-unit identity (Electron main process; empty on the web build) ──
// The renderer's WebHID handle carries no serial (Chromium blocklists it), but
// the Electron main process sees it on the HID device events — over Bluetooth
// that serial is the controller's MAC (a stable per-unit id whose OUI even outs
// a spoofed clone). main.js pushes that inventory here via `hid-controllers-
// snapshot`. We match it to panel rows by vid:pid.
let hidInventory = [];
function setInventory(list) { hidInventory = Array.isArray(list) ? list : []; }
function unitsForVp(vp) {
  if (!vp) return [];
  return hidInventory.filter((u) => u.vendorId === vp.vendorId && u.productId === vp.productId);
}
function vpOfSlot(s) {
  if (s.hidDevice) return { vendorId: s.hidDevice.vendorId, productId: s.hidDevice.productId };
  return ControllerRegistry.parseGamepadVendorProduct(s.controllerLabel) || null;
}
// One line of per-unit identity for a panel row. Unique vid:pid → the serial.
// Electron's main HIDDevice has no `collections`, so a descriptor fingerprint is
// impossible; instead we disambiguate two identical-vid:pid units by connection
// type (a Bluetooth unit carries a MAC serial, a USB DS4 carries none).
function identityLine(vp, connType) {
  const units = unitsForVp(vp);
  if (!units.length) return '';
  if (units.length === 1) return units[0].serialNumber ? '# ' + units[0].serialNumber : '# no serial (USB)';
  const withSerial = units.filter((u) => u.serialNumber);
  if (connType === 'bluetooth' && withSerial.length === 1) return '# ' + withSerial[0].serialNumber;
  if (connType === 'usb' && units.some((u) => !u.serialNumber)) return '# no serial (USB)';
  return '⚠ ' + units.length + ' units — ' + units.map((u) => u.serialNumber || 'no-serial').join(' · ');
}
// Enumerate every controller the manager can see, in three buckets:
//   ACTIVE — a claimed slot (someone took a seat); may be HID-bound or Gamepad-API-only
//   PAIRED — a HID entry idling in the pool (WebHID approved, gyro/lightbar ready, no seat yet)
//   OPEN   — a live Gamepad-API pad that's neither claimed nor pooled (press to join)
function ctrlEntries(pads) {
  const items = [];
  const claimedIdx = new Set();
  for (const s of manager.slots) {
    if (s.state !== 'claimed') continue;
    if (s.gamepadIndex != null) claimedIdx.add(s.gamepadIndex);
    const L = state.bySlot.get(s.id);
    const seated = !!(L && L.seatId != null);
    const role = seated && seat(L.seatId) ? seat(L.seatId).role : '';
    const hid = !!s._hidEntry;
    items.push({
      key: 's:' + s.id, name: esc(devName(s.id)),
      // controller layer: a claimed slot is ACTIVE. game layer: ASSIGNED/READY only when seated.
      cstate: 'ACTIVE', gstate: seated ? (L.phase === 'ready' ? 'READY' : 'ASSIGNED') : null,
      sub: seated ? `P${L.player} · ${role}` : (L ? `P${L.player} · recognized` : 'recognized'),
      hw: esc((s.hidDevice && s.hidDevice.productName) || ''),   // real HID string — the ONLY way to tell apart two same-vid:pid pads
      vp: vpOfSlot(s), device: s.hidDevice || null,
      conn: hid ? (s.driver && s.driver.connectionType ? s.driver.connectionType : 'hid') : 'gamepad',
      active: padActive(s.effectiveGamepad(pads)),
    });
  }
  let hi = 0;
  for (const entry of manager._hidPool.values()) {
    const nm = (entry.driver && entry.driver.entry && entry.driver.entry.name) || (entry.device && entry.device.productName) || 'Controller';
    items.push({
      // index in the key: two identical-vid:pid devices (real DS4 + GameSir spoof)
      // would otherwise collide to one row and share one activity dot.
      key: 'h:' + (hi++) + ':' + ((entry.device && entry.device.vendorId) || 0) + ':' + ((entry.device && entry.device.productId) || 0),
      name: esc(nm), cstate: 'AVAILABLE', gstate: null, sub: 'WebHID · idle',
      hw: esc((entry.device && entry.device.productName) || ''),
      vp: entry.device ? { vendorId: entry.device.vendorId, productId: entry.device.productId } : null,
      device: entry.device || null,
      conn: (entry.driver && entry.driver.connectionType) || 'hid',
      active: padActive(entry.synthetic),
    });
  }
  for (const gp of pads) {
    if (!gp) continue;
    if (claimedIdx.has(gp.index)) continue;
    if (stickMag(gp) > 0.5) continue;   // stuck-stick pad = likely a Chrome BT-reconnect ghost; skip
    const vp = ControllerRegistry.parseGamepadVendorProduct(gp.id);
    if (vp && manager._findPoolEntryByVidPid(vp.vendorId, vp.productId)) continue;   // already shown as PAIRED
    const info = ControllerRegistry.identifyFromGamepadId(gp.id);
    items.push({
      key: 'g:' + gp.index, name: esc((info && info.driverName) || 'Controller'), cstate: 'AVAILABLE', gstate: null,
      sub: 'Gamepad · press a button', hw: '', vp: vp || null, conn: 'gamepad', active: padActive(gp),
    });
  }
  for (const it of items) it.id = esc(identityLine(it.vp, it.conn));
  return items;
}
function buildCtrlRows(items) {
  const list = $('cp-list'); if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="cp-empty">No controllers detected.<br>Press a button, or “🎮 Pair controller”.</div>'; return; }
  list.innerHTML = items.map((it) =>
    `<div class="cp-row"><span class="cp-dot" data-dot="${it.key}"></span>` +
    `<div class="cp-main"><div class="cp-name">${it.name}</div><div class="cp-sub">${it.sub} · ${it.conn} · ${vpStr(it.vp)}</div>` +
    `${it.hw ? `<div class="cp-hw">▪ ${it.hw}</div>` : ''}` +
    `${it.id ? `<div class="cp-id${it.id[0] === '⚠' ? ' warn' : ''}">${it.id}</div>` : ''}</div>` +
    `<div class="cp-tags"><span class="cp-tag ${it.cstate.toLowerCase()}">${it.cstate}</span>` +
    `${it.gstate ? `<span class="cp-tag ${it.gstate.toLowerCase()}">${it.gstate}</span>` : ''}</div></div>`
  ).join('');
}
let ctrlSig = '';
function renderCtrlPanel(pads) {
  const panel = $('ctrl-panel'); if (!panel || panel.hidden) return;
  const items = ctrlEntries(pads);
  const sig = items.map((i) => i.key + '|' + i.cstate + '|' + (i.gstate || '') + '|' + i.sub + '|' + i.conn + '|' + i.name + '|' + i.hw + '|' + i.id + '|' + vpStr(i.vp)).join('~');
  if (sig !== ctrlSig) { ctrlSig = sig; buildCtrlRows(items); }
  const list = $('cp-list');
  for (const it of items) { const d = list.querySelector(`[data-dot="${it.key}"]`); if (d) d.classList.toggle('on', it.active); }
  const act = items.filter((i) => i.cstate === 'ACTIVE').length, av = items.filter((i) => i.cstate === 'AVAILABLE').length;
  const asg = items.filter((i) => i.gstate === 'ASSIGNED').length, rdy = items.filter((i) => i.gstate === 'READY').length;
  const note = $('cp-note'); if (note) note.textContent = `${act} active · ${av} available · ${asg} assigned · ${rdy} ready`;
}
function openCtrlPanel(open) {
  const panel = $('ctrl-panel'); if (!panel) return;
  panel.hidden = !open;
  const btn = $('btn-ctrl-list');
  if (btn) { btn.setAttribute('aria-expanded', String(open)); btn.textContent = 'Controllers ' + (open ? '▴' : '▾'); }
  if (open) { ctrlSig = ''; renderCtrlPanel((navigator.getGamepads && navigator.getGamepads()) || []); }
}
function toggleCtrlPanel() {
  const panel = $('ctrl-panel'); if (!panel) return;
  const opening = panel.hidden;
  // Gesture-backed serial scan (requestDevice needs user activation): opening the
  // panel refreshes every present device's serial into the inventory.
  if (opening && navigator.hid && navigator.userAgent.includes('Electron')) {
    navigator.hid.requestDevice({ filters: ControllerRegistry.getHIDFilters() }).catch(() => {});
  }
  openCtrlPanel(opening);
}

// ── slot lifecycle sync (claim→seat, release→free) ──
function syncSeats() {
  // A newly-claimed manager slot is RECOGNIZED (ACTIVE), not auto-seated.
  for (const s of manager.slots) if (s.state === 'claimed' && !state.bySlot.has(s.id)) recognize(s);
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
    if (L.phase === 'active') {                 // recognized & sticky ("once active, always active")
      if (e.a) takeSeat(s.id);                  // A takes a seat; only a PS/Home hold releases (→ AVAILABLE)
    } else if (L.phase === 'joined') {          // in a seat
      if (e.a) readyUp(s.id);
      else if (e.b) leaveSeat(s.id);            // step out to ACTIVE (recognized)
      else if (e.left) switchTeam(s.id, -1);
      else if (e.right) switchTeam(s.id, 1);
      else if (e.up || e.down) switchRole(s.id);
    } else if (L.phase === 'ready') {
      if (e.a && allReady()) { goLevel(); return; }   // last confirm — A again launches
      else if (e.b) unready(s.id);
    }
  }
  if (start && allReady()) goLevel();
}

// ── boot + loop ──
// Perf meters surfaced in the debug bar: _frameMs = wall time between frames
// (≈16.7 at a healthy 60fps); _workMs = synchronous work per frame. If input
// feels laggy but _workMs stays small, the cost is in HID/driver/main, not here.
let _lastTs = 0, _frameMs = 0, _workMs = 0, _lastPanel = 0;
function loop() {
  const now = performance.now();
  const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
  if (_lastTs) { const dt = now - _lastTs; if (dt > 0 && dt < 500) _frameMs = _frameMs ? _frameMs * 0.9 + dt * 0.1 : dt; }
  _lastTs = now;
  try {
    manager.ingestFrame(pads, now);
    if (state.screen === 'mode') driveMode(pads);
    else if (state.screen === 'lobby') driveLobby(pads);
    updateDebug();
    updateControllerCount();
    if (now - _lastPanel > 80) { _lastPanel = now; renderCtrlPanel(pads); }   // ~12Hz, not every frame
  } catch (e) {
    console.error('[lobby] frame error (recovered):', e);
    const el = $('debug'); if (el) el.textContent = 'ERROR: ' + (e && e.message ? e.message : String(e));
  }
  const wm = performance.now() - now; _workMs = _workMs ? _workMs * 0.9 + wm * 0.1 : wm;
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
  $('btn-ctrl-list').addEventListener('click', toggleCtrlPanel);

  // Per-unit serial/MAC inventory from the Electron main process (no-op on web).
  if (window.electronAPI) {
    try {
      if (electronAPI.listHidControllers) electronAPI.listHidControllers().then(setInventory).catch(() => {});
      if (electronAPI.onHidControllersSnapshot) electronAPI.onHidControllersSnapshot(setInventory);
      // Serial scan happens on a gesture (opening the Controllers panel / Pair) —
      // requestDevice needs user activation, so a boot timer can't populate it.
    } catch (e) { /* web build / API absent */ }
  }

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

boot();
