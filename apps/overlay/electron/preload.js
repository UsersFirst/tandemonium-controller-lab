const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onClickThroughChanged: (callback) => ipcRenderer.on('click-through-changed', (_, val) => callback(val)),
  onToggleSettings: (callback) => ipcRenderer.on('toggle-settings', () => callback()),
  quit: () => ipcRenderer.send('quit-app'),

  // Test Report export — writes JSON to a user-chosen path via native save dialog.
  // Returns { saved: true, path } or { saved: false, reason: 'cancelled' | 'error: ...' }.
  saveTestReport: (json, suggestedName) =>
    ipcRenderer.invoke('save-test-report', { json, suggestedName }),
});
