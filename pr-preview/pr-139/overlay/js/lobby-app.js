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

import { ControllerManager, ControllerRegistry, MAX_CONTROLLERS, playerSlotIds } from '@usersfirst/controller-core';
// The UI kit (uf-flow / uf-step / uf-button / uf-seat / uf-chip). Importing
// registers the elements; lobby.html links tokens.css. Screen state now lives
// in <uf-flow>, seats are <uf-seat> driven from `state`, buttons are <uf-button>.
import { UfControllerGlyph } from '@usersfirst/ui';

// Pre-allocate a generous slot pool (shared core constant) so MORE controllers
// than there are seats can be RECOGNIZED (ACTIVE) and wait in the lounge for a
// seat to open — the modes cap seats at 4 (versus 2v2), but a 5th+ controller
// should still be seen and queue, not silently do nothing (it had nowhere to go
// with only 4 slots). Only claimed slots cost anything.
const SLOT_IDS = playerSlotIds();
const manager = new ControllerManager({ slotIds: SLOT_IDS });
window.__manager = manager;

/**
 * Tell the main-process HID picker what we already hold, so a pairing prompt
 * grants a controller we do NOT have. Cheap; call right before prompting.
 */
function publishHeldHidDevices() {
  const api = window.electronAPI;
  if (!api || typeof api.setHeldHidDevices !== 'function') return;
  try { api.setHeldHidDevices(manager.heldHidDescriptors()); } catch { /* not fatal */ }
}

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
// core's slotIdentity: the bound HID driver's entry first (a GameSir Super Nova
// claims over the Gamepad API as a Sony pad, but its bound HID handle knows what
// it is), then the pad label, then the HID product string. Seats and the lounge
// show the short name ("DualSense"); the Controllers panel shows the full one.
function devName(slotId) { return manager.slotIdentity(slotId).shortName; }

// What controllerRoster needs from the lobby: player number, seat, ready. The
// seat is in this app's words (Tandemonium's captain / stoker, teams a / b);
// core passes it through, and label / tone tell the roster UI what to show.
function seatOf(slotId) {
  const L = state.bySlot.get(slotId);
  if (!L) return null;
  const s = L.seatId != null ? seat(L.seatId) : null;
  if (!s) return { player: L.player, ready: L.phase === 'ready' };
  const tone = s.team ? (s.team === 'a' ? 'team-a' : 'team-b') : (s.role === 'Stoker' ? 'stoker' : 'captain');
  return {
    player: L.player,
    seat: { team: s.team || 'coop', role: s.role.toLowerCase(), label: s.team ? `P${L.player}` : s.role, tone },
    ready: L.phase === 'ready',
  };
}

// ── screens ──
// <uf-flow id="lobby-flow"> owns which <uf-step> is visible (ids: mode | lobby |
// level). We never hide/show steps by hand; we ask the flow, and mirror its
// current id into state.screen for the per-screen input drivers in loop().
const flow = /** @type {import('@usersfirst/ui').UfFlow} */ ($('lobby-flow'));
flow.addEventListener('uf-flow:change', (e) => {
  state.screen = e.detail.to;
  edge.clear();   // re-prime every slot on the new screen (a button still held from the last screen won't fire)
});
function showScreen(name) { flow.go(name); }

let modeIdx = 0;
const modeButtons = () => /** @type {import('@usersfirst/ui').UfButton[]} */ (Array.from(document.querySelectorAll('#mode uf-button[data-mode]')));
function setModeIdx(i) {
  modeIdx = (i + MODES.length) % MODES.length;
  modeButtons().forEach((b, k) => { b.selected = k === modeIdx; });
}
function enterMode(mode) {
  state.mode = mode; const m = makeSeats(mode); state.seats = m.seats; state.fill = m.fill;
  state.occ.clear(); state.bySlot.clear(); state.nextP = 1;
  const lobbyStep = /** @type {import('@usersfirst/ui').UfStep} */ ($('lobby'));
  // Plain titles that say where you are (House Tandem voice lives in the team box and hints).
  lobbyStep.prompt = mode === 'versus' ? 'Local versus' : mode === 'solo' ? 'Solo ride' : 'Local multiplayer';
  lobbyStep.hint = mode === 'versus'
    ? 'Press a button = joined · <uf-controller-glyph button="confirm" size="sm"></uf-controller-glyph> take a seat → ready · <uf-controller-glyph button="dpad-h" size="sm"></uf-controller-glyph> team · <uf-controller-glyph button="dpad-v" size="sm"></uf-controller-glyph> swap · <uf-controller-glyph button="back" size="sm"></uf-controller-glyph> back · hold <uf-controller-glyph button="home" size="sm"></uf-controller-glyph> to release · all ready? <uf-controller-glyph button="confirm" size="sm"></uf-controller-glyph> → level'
    : 'Press a button = joined · <uf-controller-glyph button="confirm" size="sm"></uf-controller-glyph> take a seat → ready · <uf-controller-glyph button="back" size="sm"></uf-controller-glyph> back · hold <uf-controller-glyph button="home" size="sm"></uf-controller-glyph> to release · all ready? <uf-controller-glyph button="confirm" size="sm"></uf-controller-glyph> → level';
  showScreen('lobby'); syncSeats(); render();
}
function goLevel() {
  if (!allReady()) return;
  const parts = [];
  if (state.mode === 'versus') parts.push(`<span class="big">${teamCount('a')} v ${teamCount('b')}</span>Team Blue vs Team Red`);
  else if (state.mode === 'solo') parts.push(`<span class="big">Solo</span>`);
  else parts.push(`<span class="big">Co-op</span>Captain + Stoker`);
  // Who's riding: one <uf-player-card> per seated player (kit 0.4) — the same
  // card Tandemonium's room uses. Seat words are this app's.
  const cards = state.seats.filter((s) => state.occ.has(s.id)).map((s) => {
    const slotId = state.occ.get(s.id); const L = state.bySlot.get(slotId);
    const tone = s.team ? (s.team === 'a' ? 'team-a' : 'team-b') : (s.kind === 'sto' ? 'stoker' : 'captain');
    return `<uf-player-card name="${esc(devName(slotId))}" subtitle="${s.role}${s.team ? ' · team ' + (s.team === 'a' ? 'blue' : 'red') : ''}" tone="${tone}" badge="P${L ? L.player : '?'}"></uf-player-card>`;
  }).join('');
  $('level-summary').innerHTML = parts.join('') + `<div class="level-cards">${cards}</div>`;
  for (const id of state.bySlot.keys()) clearFb(id);
  showScreen('level');
}

// ── render ──
// One <uf-seat> per seat, a pure function of state (the element owns its look).
// The confirm glyph for the controller in a slot (its own family, not P1's).
function glyphFor(slotId, button = 'confirm') {
  const id = manager.slotIdentity(slotId);
  return `<uf-controller-glyph size="sm" button="${button}" family="${id.glyphFamily}"${id.swapAB ? ' swap' : ''}></uf-controller-glyph>`;
}
function cardHTML(s) {
  const tone = s.team ? (s.team === 'a' ? 'team-a' : 'team-b') : (s.kind === 'cap' ? 'captain' : 'stoker');
  if (s.locked) return `<uf-seat seat="${s.role}" tone="${tone}" who="LOCKED" dev="solo" state="locked"></uf-seat>`;
  const slotId = state.occ.get(s.id);
  if (slotId) {
    const L = state.bySlot.get(slotId); const rdy = L && L.phase === 'ready';
    const hint = rdy ? 'ready' : `press ${glyphFor(slotId)} to ready`;
    return `<uf-seat seat="${s.role}" tone="${tone}" who="${esc(devName(slotId))}" hint='${hint}' state="${rdy ? 'ready' : 'joined'}" badge="P${L ? L.player : '?'}"></uf-seat>`;
  }
  return `<uf-seat seat="${s.role}" tone="${tone}" who="Open" dev="press a button on any controller" state="open" data-seat="${s.id}"></uf-seat>`;
}
// Seats (uf-team + uf-seat) and, under them, every connected controller
// (uf-controller-roster strip, rows from core's controllerRoster). The strip
// replaces the old JOINED "lounge": it shows every controller — joined ones
// waiting for a seat, connected ones that haven't pressed yet, and who sits where.
function render() {
  const area = $('seat-area');
  let html;
  if (state.mode === 'versus') {
    const team = (t, title) => `<uf-team tone="${t === 'a' ? 'team-a' : 'team-b'}" heading="${title}" layout="column">${state.seats.filter((s) => s.team === t).map(cardHTML).join('')}</uf-team>`;
    html = `<div class="teams">${team('a', 'Team blue')}<div class="vs">VS</div>${team('b', 'Team red')}</div>`;
  } else {
    html = `<uf-team tone="coop" heading="🚲 Your tandem" layout="row">${state.seats.map(cardHTML).join('')}</uf-team>`;
  }
  const seats = state.seats.filter((s) => !s.locked).length;
  area.innerHTML = html + `<uf-controller-roster id="seat-roster" variant="strip" capacity="${seats}"></uf-controller-roster>`;
  updateRoster((navigator.getGamepads && navigator.getGamepads()) || []);
  updateCTA(); updateDebug();
}
// Cheap to call every frame: the element only re-renders when a row changes.
function updateRoster(pads) {
  const el = /** @type {any} */ (document.getElementById('seat-roster'));
  if (el) el.rows = manager.controllerRoster(pads, { seatOf });
}
function updateCTA() {
  const btn = /** @type {import('@usersfirst/ui').UfButton} */ ($('btn-choose-level')); const r = allReady();
  btn.disabled = !r; btn.selected = r;   // accent + selected = the filled, pulsing "go" look
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
  el.textContent = perf + (parts.join('   ') || 'no controllers — press a button to join') + (allReady() ? '   ✓ ALL READY' : '');   // debug bar: manager names
}
let pairMsg = '', pairMsgUntil = 0;
function flashPairMsg(m) { pairMsg = m; pairMsgUntil = performance.now() + 2600; }
function updateControllerCount() {
  const el = $('ctrl-count'); if (!el) return;
  if (pairMsg && performance.now() < pairMsgUntil) { el.textContent = pairMsg; return; }
  const claimed = manager.slots.filter((s) => s.state === 'claimed').length;
  // Count only usable pooled controllers — excludes idle Steam Puck receiver
  // interfaces (shared core filter), same as the list.
  const pooled = manager.presentablePoolEntries().length;
  el.textContent = (claimed === 0 && pooled === 0)
    ? 'no controllers — press a button or Pair →'
    : `${claimed} in use${pooled ? ` · ${pooled} available` : ''}`;
}
// Approve/pool the next controller. requestDevice needs the click as its user
// gesture; the Steam Controller is HID-only, so it can only be recognized after
// this. Gives visible feedback: after boot auto-pools everything, there's often
// nothing new to pair.
//
// Environment-aware, so a redundant click doesn't stall (issue seen in Electron):
//   • Browser — the requestDevice picker IS the only way to grant access, so
//     always allow it (prompt: true).
//   • Electron — the app auto-grants + auto-pools, so requestDevice is only
//     needed for the FIRST grant on a fresh profile. It also enumerates every
//     system HID device and briefly blocks. So: pool an already-approved device
//     cheaply; only run the scan when nothing is paired yet (first-time setup)
//     or the user explicitly asks for it by clicking again ("force scan").
const IS_ELECTRON = navigator.userAgent.includes('Electron');
let _forceScanUntil = 0;
async function pairController() {
  const free = SLOT_IDS.find((id) => manager.getSlot(id).state !== 'claimed') || SLOT_IDS[0];
  const before = manager._hidPool.size;
  flashPairMsg('pairing…'); openCtrlPanel(true);
  try {
    let dev;
    if (!IS_ELECTRON) {
      dev = await manager.connectHidForSlot(free, { prompt: true });
    } else {
      dev = await manager.connectHidForSlot(free, { prompt: false });   // cheap: pool an already-approved device
      if (!dev) {
        const nothingPairedYet = manager._hidPool.size === 0;            // fresh profile — scan is justified
        const armed = performance.now() < _forceScanUntil;              // user clicked again to force it
        if (nothingPairedYet || armed) {
          _forceScanUntil = 0;
          dev = await manager.connectHidForSlot(free, { prompt: true }); // the (blocking) system HID scan
        } else {
          const n = manager.presentablePoolEntries().length;
          _forceScanUntil = performance.now() + 5000;
          flashPairMsg(n ? `✓ ${n} connected — click again to scan for a new one` : 'no controller found — click again to scan');
          return;
        }
      }
    }
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
// The Controllers panel: core's controllerRoster (claimed slots, pooled WebHID
// entries with idle Puck siblings hidden, unclaimed pads minus BT ghosts) shown
// by <uf-controller-roster variant="list">, with this app's diagnostics (seat,
// vid:pid, the raw HID string, the per-unit serial) on each row's detail line.
function rosterSub(r) {
  if (r.seat) return `P${r.player ?? '?'} · ${r.seat.role === 'stoker' ? 'Stoker' : 'Captain'}${r.seat.team && r.seat.team !== 'coop' ? ` · team ${r.seat.team === 'a' ? 'blue' : 'red'}` : ''}`;
  if (r.kind === 'slot') return r.player != null ? `P${r.player} · joined` : 'joined';
  return r.kind === 'pool' ? 'WebHID · idle' : 'Gamepad · press a button';
}
function ctrlRows(pads) {
  return manager.controllerRoster(pads, { seatOf }).map((r) => {
    const vp = r.vendorId != null ? { vendorId: r.vendorId, productId: r.productId } : null;
    // The list prints the seat badge itself; seated rows add only the player and team here.
    const lead = r.seat ? `P${r.player ?? '?'}${r.seat.team && r.seat.team !== 'coop' ? ` · team ${r.seat.team === 'a' ? 'blue' : 'red'}` : ''}` : rosterSub(r);
    const parts = [lead, vpStr(vp)];
    if (r.hwName) parts.push('▪ ' + r.hwName);   // real HID string — the ONLY way to tell apart two same-vid:pid pads
    const unit = identityLine(vp, r.connection); if (unit) parts.push(unit);
    return { ...r, detail: parts.join(' · ') };
  });
}
function renderCtrlPanel(pads) {
  const panel = $('ctrl-panel'); if (!panel || panel.hidden) return;
  const list = $('cp-list'); if (!list) return;
  let el = /** @type {any} */ (list.querySelector('uf-controller-roster'));
  if (!el) { list.innerHTML = '<uf-controller-roster variant="list" heading="All controllers"></uf-controller-roster>'; el = list.firstElementChild; }
  const rows = ctrlRows(pads);
  el.rows = rows;
  const n = (st) => rows.filter((r) => st.includes(r.state)).length;
  const note = $('cp-note'); if (note) note.textContent = `${n(['joined', 'seated', 'ready'])} joined · ${n(['connected'])} connected · ${n(['seated'])} seated · ${n(['ready'])} ready`;
}
function openCtrlPanel(open) {
  const panel = $('ctrl-panel'); if (!panel) return;
  panel.hidden = !open;
  const btn = $('btn-ctrl-list');
  if (btn) { btn.setAttribute('aria-expanded', String(open)); btn.textContent = 'Controllers ' + (open ? '▴' : '▾'); }
  if (open) { renderCtrlPanel((navigator.getGamepads && navigator.getGamepads()) || []); }
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

// Every family=auto button prompt follows P1's controller (core identity).
let _glyphKey = '';
function syncGlyphFamily() {
  const p1 = manager.slots.find((s) => s.state === 'claimed');
  const id = p1 ? manager.slotIdentity(p1) : null;
  const key = id ? id.glyphFamily + (id.swapAB ? '/swap' : '') : 'generic';
  if (key === _glyphKey) return;
  _glyphKey = key;
  UfControllerGlyph.setDefault({ family: id ? id.glyphFamily : 'generic', swap: !!(id && id.swapAB) });
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
    else if (state.screen === 'lobby') { driveLobby(pads); updateRoster(pads); }
    syncGlyphFamily();
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
  modeButtons().forEach((b, k) => {
    b.addEventListener('click', () => { setModeIdx(k); enterMode(b.dataset.mode); });
    b.addEventListener('mouseenter', () => setModeIdx(k));
  });
  $('btn-back-mode').addEventListener('click', () => { for (const id of state.bySlot.keys()) clearFb(id); if (!flow.back()) flow.go('mode'); });
  $('btn-choose-level').addEventListener('click', goLevel);
  $('btn-restart').addEventListener('click', () => { flow.back(); enterMode(state.mode); });
  $('btn-pair').addEventListener('click', pairController);
  $('btn-pair-global').addEventListener('click', pairController);
  $('btn-ctrl-list').addEventListener('click', toggleCtrlPanel);
  $('btn-close-app').addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.quit) window.electronAPI.quit();
    else if (window.close) window.close();
  });

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
