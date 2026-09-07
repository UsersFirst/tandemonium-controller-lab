// ============================================================
// CONTROLLERS WINDOW — detached list of all connected controllers
// ============================================================
//
// Display-only for now (Phase 1). The main overlay forwards the controller rows
// each frame over IPC ('hud-state-update', kind 'controllers'); this window
// renders them with live "in use" dots. Window chrome (drag / close) is handled
// by hud-window-chrome.js. Click-to-select comes in Phase 2.

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');

function vpStr(vp) {
  return vp ? ((vp.vendorId || 0).toString(16).padStart(4, '0') + ':' + (vp.productId || 0).toString(16).padStart(4, '0')) : '—';
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let sig = '';
function render(rows) {
  if (!Array.isArray(rows)) return;
  const s = rows.map((r) => r.key + '|' + r.state + '|' + r.name + '|' + r.conn + '|' + vpStr(r.vp) + '|' + (r.serial || '')).join('~');
  if (s !== sig) {
    sig = s;
    listEl.innerHTML = rows.length ? rows.map((r) =>
      `<div class="row${r.selected ? ' sel' : ''}" data-key="${esc(r.key)}">` +
      `<span class="dot" data-dot="${esc(r.key)}"></span>` +
      `<span class="main"><span class="name">${esc(r.name)}</span>` +
      `<span class="sub">${esc(r.conn)} · ${vpStr(r.vp)}</span>` +
      `${r.serial ? `<span class="serial"># ${esc(r.serial)}</span>` : ''}</span>` +
      `<span class="tag ${esc(r.state).toLowerCase()}">${esc(r.state)}</span></div>`
    ).join('') : '<div class="empty">No controllers detected.</div>';
    if (countEl) countEl.textContent = rows.length ? `(${rows.length})` : '';
  }
  for (const r of rows) {
    const d = listEl.querySelector(`[data-dot="${esc(r.key)}"]`);
    if (d) d.classList.toggle('on', !!r.active);
  }
}

if (window.electronAPI && window.electronAPI.onHudState) {
  window.electronAPI.onHudState(render);
}

// Click a row → tell the overlay to switch to that controller.
listEl.addEventListener('click', (e) => {
  const row = e.target instanceof Element ? e.target.closest('.row') : null;
  if (row && row.dataset.key && window.electronAPI && window.electronAPI.selectController) {
    window.electronAPI.selectController({ key: row.dataset.key });
  }
});
