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

  // ── Detached HUD windows (a second BrowserWindow per `kind`) ──
  // The main overlay opens/updates a detached HUD window by kind
  // ('button' | 'gyro'). The window receives profile changes via
  // 'hud-profile-changed' and per-frame state via 'hud-state-update'.
  openHudWindow: (kind, profile) =>
    ipcRenderer.invoke('open-hud-window', { kind, profile }),
  updateHudProfile: (profile) =>
    ipcRenderer.send('update-hud-profile', { profile }),
  // Per-frame state forward (main renderer → window). Cheap, small JSON:
  // button → {buttons:[{pressed,value}…], axes:[…]}; gyro → {q:{x,y,z,w}, active}.
  sendHudState: (kind, state) =>
    ipcRenderer.send('hud-state', { kind, state }),
  // Subscriptions used by the detached HUD windows.
  onHudProfileChange: (callback) =>
    ipcRenderer.on('hud-profile-changed', (_, profile) => callback(profile)),
  onHudState: (callback) =>
    ipcRenderer.on('hud-state-update', (_, state) => callback(state)),
  // Used by a detached window's close button to close itself cleanly.
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
