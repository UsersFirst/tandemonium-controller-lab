// ============================================================
// DETACHED HUD WINDOW — shared chrome (drag / close / green-screen)
// ============================================================
//
// Plain (non-module) script shared by every detached HUD window. It drags the
// window via JS (pointerdown → windowDrag* IPC, which moves the SENDER window),
// NOT via CSS -webkit-app-region: drag. That matters: app-region drag hands the
// area to the OS and the DOM never sees the mouse events, so hover can't work.
// With JS dragging the events still flow, so `body:hover` reveals the close
// button anywhere in the window AND the whole window stays draggable.
//
// Drag is suppressed over genuinely interactive bits: <button>/<a>/inputs and
// anything marked `.no-drag-ui`. Load this BEFORE the per-window renderer.
(function () {
  const api = window.electronAPI;

  // ── JS window dragging (events still reach the DOM, unlike app-region drag) ──
  if (api && api.windowDragStart) {
    let dragging = false;
    let movePending = false;
    const interactive = 'button, a, input, select, textarea, .no-drag-ui';
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest(interactive)) return;
      dragging = true;
      api.windowDragStart();
      if (e.target instanceof Element) {
        try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
      }
    });
    window.addEventListener('pointermove', () => {
      if (!dragging || movePending) return;
      movePending = true;
      requestAnimationFrame(() => { movePending = false; if (dragging) api.windowDragMove(); });
    });
    const end = () => { if (dragging) { dragging = false; api.windowDragEnd(); } };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  // ── Green-screen carry-over (initial via open query, live via broadcast) ──
  function applyGreenScreen(on, color) {
    document.body.style.background = on ? (color || '#00b140') : 'transparent';
  }
  const params = new URLSearchParams(window.location.search);
  applyGreenScreen(params.get('gs') === '1', params.get('gsColor'));
  if (api && api.onHudGreenScreen) api.onHudGreenScreen((gs) => applyGreenScreen(gs.on, gs.color));

  // ── Close button ──
  const closeBtn = document.getElementById('close-btn');
  if (closeBtn && api && api.closeWindow) closeBtn.addEventListener('click', () => api.closeWindow());
})();
