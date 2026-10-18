// Controller Inventory window (Electron). Drives ControllerInventory from two
// sources: the main process's HID device events (devices WITH serials, pushed
// as snapshots over IPC) and the renderer's Gamepad API (covers pads without
// HID serials, e.g. Xbox). Renders the table; persists to localStorage. The
// MAC (when present, over Bluetooth) is the per-unit identity; we don't try to
// classify genuine-vs-clone by OUI (unreliable — see controller-identity memo).

import { ControllerInventory, formatSerial, isMacSerial } from '@usersfirst/controller-core/controller-inventory';

const api = window.electronAPI;
const LS_KEY = 'controller-inventory';
const inv = new ControllerInventory();
try { const s = localStorage.getItem(LS_KEY); if (s) inv.loadJSON(JSON.parse(s)); } catch {}
const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(inv.toJSON())); } catch {} };

const status = document.getElementById('status');
const fmt = (t) => (t ? new Date(t).toLocaleString() : '—');

// ── HID source (main process; carries serials) ──
// Main sends the full controller map (each with a `connected` flag) whenever it
// changes. We apply it directly — connected → observeConnect, else disconnect.
function applyHidSnapshot(list) {
  if (!Array.isArray(list)) return;
  for (const c of list) {
    const desc = { source: 'hid', vendorId: c.vendorId, productId: c.productId, productName: c.name, serialNumber: c.serialNumber };
    if (c.connected) inv.observeConnect(desc); else inv.observeDisconnect(desc);
  }
  save();
  render();
}

if (api) {
  api.onHidControllersSnapshot(applyHidSnapshot);
  api.listHidControllers().then(applyHidSnapshot).catch(() => {});
} else {
  status.textContent = 'Not running in Electron — HID serials unavailable (Gamepad API only).';
}

// Serials populate when the HID device list is enumerated, which needs a user
// gesture. The Scan button triggers it; main captures the serials and pushes
// them back. (No chooser appears — the main process auto-handles selection.)
const scanBtn = document.getElementById('scan');
if (scanBtn) {
  scanBtn.onclick = async () => {
    if (!navigator.hid) { status.textContent = 'WebHID unavailable.'; return; }
    try {
      status.textContent = 'Scanning…';
      await navigator.hid.requestDevice({ filters: [] });
      status.textContent = '';
    } catch (e) { status.textContent = e.message; }
  };
}

// ── Gamepad API source (no serials; covers Xbox & any pad we lack HID for) ──
const seenPads = new Map();
function pollGamepads() {
  const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
  const live = new Set();
  for (const gp of pads) {
    if (!gp) continue;
    live.add(gp.index);
    if (!seenPads.has(gp.index)) {
      seenPads.set(gp.index, gp.id);
      inv.observeConnect({ source: 'gamepad', gamepadId: gp.id });
      save(); render();
    }
  }
  for (const [i, id] of seenPads) {
    if (!live.has(i)) { seenPads.delete(i); inv.observeDisconnect({ source: 'gamepad', gamepadId: id }); save(); render(); }
  }
}
setInterval(pollGamepads, 600);

// ── Render ──
function transportOf(rec) {
  const list = rec.transports instanceof Set ? [...rec.transports] : (rec.transports || []);
  const hasHid = list.includes('hid');
  if (hasHid && isMacSerial(rec.serialNumber)) return 'Bluetooth';
  if (hasHid) return 'USB / HID';
  return 'Gamepad';
}

function render() {
  const rows = inv.list();
  const wrap = document.getElementById('tableWrap');
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty">No controllers seen yet. Connect a pad over Bluetooth or USB; press a button on a Gamepad-API-only pad (Xbox) to register it.</div>';
    return;
  }
  const head = ['Name', 'Serial / MAC', 'Transport', 'Status', 'Gyro', 'Trackpads', 'Haptics', 'First seen', 'Last connected', 'Last disconnected', '#'];
  const row = (r) => {
    const c = r.capabilities;
    const transports = (r.transports instanceof Set ? [...r.transports] : (r.transports || [])).map((t) => `<span class="tag">${t}</span>`).join(' ');
    return `<tr>
      <td>${r.name || '(unknown)'} <span class="dim">${r.vendorId != null ? r.vendorId.toString(16).padStart(4, '0') + ':' + r.productId.toString(16).padStart(4, '0') : ''}</span></td>
      <td class="dim">${r.serialNumber ? formatSerial(r.serialNumber) : '—'}</td>
      <td>${transportOf(r)} <span class="dim">${transports}</span></td>
      <td><span class="pill ${r.connected ? 'on' : 'off'}">${r.connected ? 'connected' : 'offline'}</span></td>
      <td class="${c.gyro ? 'yes' : 'no'}">${c.gyro ? '✓' : '—'}</td>
      <td class="${c.trackpadCount ? 'yes' : 'no'}">${c.trackpadCount || '—'}</td>
      <td>${c.haptics ? (c.haptics.count ?? '?') + ' <span class="dim">' + (c.haptics.type || '') + '</span>' : '<span class="no">—</span>'}</td>
      <td class="dim">${fmt(r.firstSeen)}</td>
      <td class="dim">${fmt(r.lastConnected)}</td>
      <td class="dim">${fmt(r.lastDisconnected)}</td>
      <td class="dim">${r.connectCount}</td>
    </tr>`;
  };
  wrap.innerHTML = `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
}

document.getElementById('clear').onclick = () => { inv.clear(); save(); render(); };

render();
setInterval(render, 1000); // keep timestamps fresh
