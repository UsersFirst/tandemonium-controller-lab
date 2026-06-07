const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Handle Squirrel.Windows install/update/uninstall events. When the Squirrel
// installer launches the app with --squirrel-install / --squirrel-updated /
// --squirrel-uninstall / --squirrel-obsolete, this quits immediately so the
// user doesn't see a flash of the UI followed by a relaunch on first run.
if (require('electron-squirrel-startup')) {
  app.quit();
  return;
}

let mainWindow = null;
let tray = null;
let clickThrough = false;
// Button HUD popout window — at most one open at a time. Tracked so the
// main renderer can forward profile-change events to it via IPC without
// re-opening or duplicating.
let buttonHudWindow = null;
let inventoryWindow = null;

// ── Controller inventory: HID serial source (main process) ──
// The renderer's WebHID can't read serial numbers (Chromium blocklists the
// MAC/serial feature reports), but the MAIN process's HID device events DO
// carry `serialNumber` — over Bluetooth that's the controller's MAC, a stable
// per-unit id (and its OUI reveals a spoofed clone). We capture those events
// into a map and push it to the inventory window. No native module needed
// (avoids the node-hid/Electron-ABI rebuild); inventory degrades to the
// Gamepad API if serials don't come through.
const INVENTORY_VIDS = new Set([0x054c, 0x057e, 0x28de, 0x045e, 0x3537, 0x2dc8, 0x0f0d]);
const hidControllers = new Map(); // key -> { vendorId, productId, name, serialNumber, connected }

// Drop XInput slot indices ("01"/"02") and other too-short non-serials so they
// aren't mistaken for a per-unit id.
function sanitizeSerial(s) {
  const t = s ? String(s).trim() : '';
  return t.length >= 6 ? t : null;
}
function hidKey(d) { return d.guid || d.deviceId || `${d.vendorId}:${d.productId}`; }

function upsertHidController(d, connected) {
  if (!d || !INVENTORY_VIDS.has(d.vendorId)) return;
  const key = hidKey(d);
  const prev = hidControllers.get(key) || {};
  hidControllers.set(key, {
    vendorId: d.vendorId,
    productId: d.productId,
    name: d.name || d.productName || prev.name || null,
    // Keep a serial once we've seen one for this device, even if a later event omits it.
    serialNumber: sanitizeSerial(d.serialNumber) || prev.serialNumber || null,
    connected,
  });
  console.log('[inventory] HID', connected ? 'present' : 'gone', '-',
    (d.name || d.productId), 'serial=', d.serialNumber || '(none)');
}

function hidControllerList() { return [...hidControllers.values()]; }

function broadcastHidControllers() {
  if (inventoryWindow && !inventoryWindow.isDestroyed()) {
    inventoryWindow.webContents.send('hid-controllers-snapshot', hidControllerList());
  }
}

function openInventoryWindow() {
  if (inventoryWindow && !inventoryWindow.isDestroyed()) { inventoryWindow.focus(); return; }
  inventoryWindow = new BrowserWindow({
    width: 1040, height: 640,
    title: 'Controller Inventory',
    backgroundColor: '#14141f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  inventoryWindow.loadFile(path.join(__dirname, '..', 'src', 'inventory.html'));
  inventoryWindow.webContents.once('did-finish-load', () => broadcastHidControllers());
  inventoryWindow.on('closed', () => { inventoryWindow = null; });
}

function createWindow() {
  const useMulti = process.env.OVERLAY_MULTI === '1' || process.argv.includes('--multi');
  mainWindow = new BrowserWindow({
    width: useMulti ? 1100 : 600,
    height: useMulti ? 520 : 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: false,
    // Don't show the window until the renderer has painted — otherwise the
    // transparent window flashes the default chrome color (green/white on
    // Windows) for a few hundred ms before the HTML appears.
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const entry = useMulti ? 'multi.html' : 'index.html';
  mainWindow.loadFile(path.join(__dirname, '..', 'src', entry));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // DevTools: Cmd+Shift+I to open manually (auto-open triggers Autofill errors)

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleClickThrough() {
  clickThrough = !clickThrough;
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    mainWindow.webContents.send('click-through-changed', clickThrough);
  }
  updateTrayMenu();
}

function createTray() {
  // Use a simple icon — on production builds, replace with a proper icon
  tray = new Tray(path.join(__dirname, '..', 'src', 'assets', 'tray-icon.png'));
  updateTrayMenu();
  tray.setToolTip('3D Controller Overlay');
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: clickThrough ? 'Disable Click-Through' : 'Enable Click-Through',
      click: toggleClickThrough,
    },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: mainWindow?.isAlwaysOnTop() ?? true,
      click: () => {
        if (mainWindow) {
          const current = mainWindow.isAlwaysOnTop();
          mainWindow.setAlwaysOnTop(!current);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Show Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('toggle-settings');
          if (clickThrough) toggleClickThrough();
        }
      },
    },
    { type: 'separator' },
    { label: 'Controller Inventory…', click: openInventoryWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// Suppress Chromium Autofill DevTools errors
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Autofill');

app.whenReady().then(() => {
  createWindow();

  // Create tray icon if asset exists
  try {
    createTray();
  } catch (e) {
    console.log('Tray icon not found, skipping system tray');
  }

  // Handle quit from renderer
  ipcMain.on('quit-app', () => app.quit());

  // Controller inventory window + its HID serial source (node-hid in main).
  ipcMain.handle('open-inventory-window', () => { openInventoryWindow(); return { opened: true }; });
  ipcMain.handle('list-hid-controllers', () => hidControllerList());

  // Open the Button HUD popout window — spawns a small frameless,
  // transparent, always-on-top BrowserWindow that loads
  // src/button-hud-window.html. Only one popout at a time; if already
  // open, focus it instead of opening a duplicate.
  //
  // The popout polls navigator.getGamepads() in its own renderer (Gamepad
  // API is window-scoped but sees the same physical pads), so no
  // per-frame IPC traffic is needed. Profile is passed via URL query.
  ipcMain.handle('open-button-hud-window', async (_event, { profile }) => {
    if (buttonHudWindow && !buttonHudWindow.isDestroyed()) {
      buttonHudWindow.focus();
      // Update profile in case the caller passed a different one this time
      buttonHudWindow.webContents.send('popout-profile-changed', profile);
      return { opened: true, alreadyOpen: true };
    }
    buttonHudWindow = new BrowserWindow({
      width: 300, height: 240,
      transparent: true, frame: false,
      alwaysOnTop: true, resizable: true,
      hasShadow: false, skipTaskbar: false,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    // loadFile handles Windows path quirks (loadURL with raw `file://` +
    // backslashes is malformed on Windows) and the query option is the
    // documented way to pass URL parameters.
    buttonHudWindow.loadFile(
      path.join(__dirname, '..', 'src', 'button-hud-window.html'),
      { query: { profile: profile || '' } }
    );
    buttonHudWindow.on('closed', () => { buttonHudWindow = null; });
    return { opened: true, alreadyOpen: false };
  });

  // Main renderer forwards a profile change to the popout (if any) so its
  // labels track the active controller without the user reopening it.
  ipcMain.on('update-button-hud-profile', (_event, { profile }) => {
    if (buttonHudWindow && !buttonHudWindow.isDestroyed()) {
      buttonHudWindow.webContents.send('popout-profile-changed', profile);
    }
  });

  // Per-frame gamepad-state forwarding to the popout. Main renderer sends
  // a small {buttons, axes} snapshot every animation frame; we no-op when
  // no popout is open. Forwarding state in this direction (rather than
  // having the popout poll its own Gamepad API) sidesteps Chromium's
  // per-document user-activation requirement — the popout would otherwise
  // see all-null gamepads until the user clicked inside its window.
  ipcMain.on('button-hud-state', (_event, state) => {
    if (buttonHudWindow && !buttonHudWindow.isDestroyed()) {
      buttonHudWindow.webContents.send('button-hud-state-update', state);
    }
  });

  // Popout's close button uses this to close itself (frameless windows
  // have no titlebar close affordance).
  ipcMain.on('close-this-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  // Test Report export — renderer hands us the JSON string and a suggested
  // filename; we pop a native save dialog and write the file. Returning
  // { saved, path?, reason? } lets the renderer update its UI accordingly.
  ipcMain.handle('save-test-report', async (_event, { json, suggestedName }) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Controller Test Report',
        defaultPath: suggestedName || 'controller-test-report.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) {
        return { saved: false, reason: 'cancelled' };
      }
      fs.writeFileSync(result.filePath, json, 'utf8');
      return { saved: true, path: result.filePath };
    } catch (err) {
      return { saved: false, reason: 'error: ' + err.message };
    }
  });

  // Global shortcut: Ctrl+Shift+T to toggle click-through
  globalShortcut.register('CommandOrControl+Shift+T', toggleClickThrough);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tray) tray.destroy();
});

// Handle WebHID permission requests from renderer
app.on('web-contents-created', (_, contents) => {
  contents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'hid') return true;
    return true;
  });
  contents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'hid') return true;
    return false;
  });

  // Auto-select HID devices for requestDevice() calls.
  // Also listen for hid-device-added to grant persistent permission so
  // getDevices() returns them on subsequent connections.
  let selectTimeout = null;
  const alreadyPicked = new Set(); // deviceIds handed out in this session

  contents.session.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    console.log('select-hid-device: deviceList length =', details.deviceList?.length || 0);
    // This deviceList IS the set of currently-present HID devices, so a Scan
    // doubles as an authoritative refresh: capture each present device's serial,
    // then mark anything we knew about that ISN'T present now as disconnected.
    // (hid-device-removed is unreliable over Bluetooth / for ungranted Puck
    // interfaces, so this manual reconcile is how the inventory's connected
    // state stays honest without a native module.)
    const present = new Set();
    for (const d of details.deviceList || []) { upsertHidController(d, true); present.add(hidKey(d)); }
    for (const [key, c] of hidControllers) {
      if (!present.has(key) && c.connected) hidControllers.set(key, { ...c, connected: false });
    }
    broadcastHidControllers();
    if (details.deviceList && details.deviceList.length > 0) {
      if (selectTimeout) { clearTimeout(selectTimeout); selectTimeout = null; }
      // Prefer a device we haven't picked yet in this session. Falls back to
      // the first device when all have been handed out (single-controller case).
      const d = details.deviceList.find((x) => !alreadyPicked.has(x.deviceId))
                || details.deviceList[0];
      alreadyPicked.add(d.deviceId);
      console.log('select-hid-device: selecting', d.name || d.productId, '(alreadyPicked:', alreadyPicked.size, ')');
      try {
        callback(d.deviceId);
      } catch (e) {
        // Callback already used by a prior firing
      }
    } else if (!selectTimeout) {
      selectTimeout = setTimeout(() => {
        selectTimeout = null;
        console.log('select-hid-device: timeout — no device appeared');
        try { callback(''); } catch (e) { /* already resolved */ }
      }, 8000);
    }
  });

  // Grant persistent permission for HID devices so getDevices() returns them.
  // This fires when a device matching an active requestDevice() filter appears.
  contents.session.on('hid-device-added', (event, device) => {
    console.log('hid-device-added:', device.name || device.productId);
    upsertHidController(device, true);
    broadcastHidControllers();
  });

  contents.session.on('hid-device-removed', (event, device) => {
    console.log('hid-device-removed:', device.name || device.productId);
    upsertHidController(device, false);
    broadcastHidControllers();
  });
});
