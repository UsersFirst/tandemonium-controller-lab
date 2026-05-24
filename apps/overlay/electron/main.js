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
    const url = `file://${path.join(__dirname, '..', 'src', 'button-hud-window.html')}?profile=${encodeURIComponent(profile || '')}`;
    buttonHudWindow.loadURL(url);
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
  });

  contents.session.on('hid-device-removed', (event, device) => {
    console.log('hid-device-removed:', device.name || device.productId);
  });
});
