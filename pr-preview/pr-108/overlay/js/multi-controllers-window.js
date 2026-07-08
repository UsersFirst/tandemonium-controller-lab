// ============================================================
// MULTI-CONTROLLERS WINDOW — detached players & controllers roster
// ============================================================
//
// Display-only popout for the multi app. multi-app.js forwards the roster rows
// each frame over IPC ('hud-state-update', kind 'multi-controllers'); this window
// renders them: claimed controllers as PLAYER n, pooled streaming controllers as
// AVAILABLE. Window chrome (drag / close) is handled by hud-window-chrome.js.
//
// Row shape (from multi-app.js rosterRows): { name, vp, state, active }
//   state: 'AVAILABLE' | 'PLAYER n' | 'PLAYER n (reconnecting)'

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function tagClass(state) {
  if (state.includes('reconnecting')) return 'reconnecting';
  if (state.startsWith('PLAYER')) return 'player';
  return 'available';
}

let sig = '';
function render(rows) {
  if (!Array.isArray(rows)) return;
  const s = rows.map((r) => r.name + '|' + r.state + '|' + r.vp).join('~');
  if (s !== sig) {
    sig = s;
    listEl.innerHTML = rows.length ? rows.map((r, i) => {
      const tc = tagClass(r.state);
      const dotCls = r.active ? 'on' : (tc === 'player' ? 'player' : '');
      return `<div class="row" data-i="${i}">` +
        `<span class="dot" data-dot="${i}"></span>` +
        `<span class="main"><span class="name">${esc(r.name)}</span>` +
        `<span class="sub">${esc(r.vp)}</span></span>` +
        `<span class="tag ${tc}">${esc(r.state)}</span></div>`;
    }).join('') : '<div class="empty">No controllers connected.<br>Power one on.</div>';
    if (countEl) countEl.textContent = rows.length ? `(${rows.length})` : '';
  }
  // Live dot state updates without a full re-render.
  for (let i = 0; i < rows.length; i++) {
    const d = listEl.querySelector(`[data-dot="${i}"]`);
    if (d) {
      const tc = tagClass(rows[i].state);
      d.classList.toggle('on', !!rows[i].active);
      d.classList.toggle('player', !rows[i].active && tc === 'player');
    }
  }
}

if (window.electronAPI && window.electronAPI.onHudState) {
  window.electronAPI.onHudState(render);
}
