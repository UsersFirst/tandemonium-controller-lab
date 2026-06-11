const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onClickThroughChanged: (callback) => ipcRenderer.on('click-through-changed', (_, val) => callback(val)),
  onToggleSettings: (callback) => ipcRenderer.on('toggle-settings', () => callback()),
  quit: () => ipcRenderer.send('quit-app'),

  // ── Frameless window drag ──
  // The renderer detects a grab on a non-interactive area and drives the
  // window move through the main process (which reads the live cursor for
  // DPI-correct positioning). start once on pointerdown, move per frame,
  // end on pointerup.
  windowDragStart: () => ipcRenderer.send('window-drag-start'),
  windowDragMove: () => ipcRenderer.send('window-drag-move'),
  windowDragEnd: () => ipcRenderer.send('window-drag-end'),

  // Test Report export — writes JSON to a user-chosen path via native save dialog.
  // Returns { saved: true, path } or { saved: false, reason: 'cancelled' | 'error: ...' }.
  saveTestReport: (json, suggestedName) =>
    ipcRenderer.invoke('save-test-report', { json, suggestedName }),

  // ── Button HUD popout (a second BrowserWindow with just the HUD) ──
  // Called from the main overlay's renderer to open / update / close the
  // popout. The popout window receives profile updates via the
  // 'popout-profile-changed' channel.
  openButtonHudWindow: (profile) =>
    ipcRenderer.invoke('open-button-hud-window', { profile }),
  updateButtonHudProfile: (profile) =>
    ipcRenderer.send('update-button-hud-profile', { profile }),
  // Per-frame gamepad-state forward (main renderer → popout). Cheap; the
  // state object is just {buttons:[{pressed,value}…], axes:[…]} so JSON
  // serialization stays small even at 60+Hz.
  sendButtonHudState: (state) =>
    ipcRenderer.send('button-hud-state', state),
  // Subscriptions used by the popout window only.
  onPopoutProfileChange: (callback) =>
    ipcRenderer.on('popout-profile-changed', (_, profile) => callback(profile)),
  onButtonHudState: (callback) =>
    ipcRenderer.on('button-hud-state-update', (_, state) => callback(state)),
  // Used by the popout window's close button to close itself cleanly.
  closeWindow: () => ipcRenderer.send('close-this-window'),

  // ── Controller inventory ──
  // Open the inventory window (from the main overlay or tray).
  openInventoryWindow: () => ipcRenderer.invoke('open-inventory-window'),
  // One-shot current HID controller list (with serials, from node-hid in main).
  listHidControllers: () => ipcRenderer.invoke('list-hid-controllers'),
  // Periodic snapshot of currently-present HID controllers (with serials).
  onHidControllersSnapshot: (callback) =>
    ipcRenderer.on('hid-controllers-snapshot', (_, list) => callback(list)),
});
