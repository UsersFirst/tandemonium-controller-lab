const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Handle Squirrel.Windows install/update/uninstall events. When the Squirrel
// installer launches the app with --squirrel-install / --squirrel-updated /
// --squirrel-uninstall / --squirrel-obsolete, this quits immediately so the
// user doesn't see a flash of the UI followed by a relaunch on first run.
// Vendored locally (see electron/squirrel-startup.js) instead of the npm
// package, which gets workspace-hoisted out of app.asar and breaks the .exe.
if (require('./squirrel-startup')) {
  app.quit();
  return;
}

let mainWindow = null;
let tray = null;
let clickThrough = false;

// ── Persisted window size (issue #69) ──
// The controller body window should reopen at the size it was last left, so
// the user can line it up once for OBS and just hit "start recording" next
// time. We store width/height in a small JSON file under userData, keyed per
// mode (single vs. multi) so the two layouts don't clobber each other. The
// default for the single-controller window is 720×540 — a clean capture size.
const DEFAULT_WINDOW_SIZE = { width: 720, height: 540 };
const MULTI_WINDOW_SIZE = { width: 1100, height: 520 };
const LOBBY_WINDOW_SIZE = { width: 820, height: 660 };
let windowStatePath = null; // resolved once app is ready (needs userData path)
let saveWindowSizeTimer = null;

function getWindowStatePath() {
  if (!windowStatePath) {
    windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
  }
  return windowStatePath;
}

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf8')) || {};
  } catch (e) {
    return {};
  }
}

function writeWindowState(state) {
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    // Non-fatal — size persistence is a convenience, not correctness.
    console.log('[window-state] save failed:', e.message);
  }
}

// Sanity-check a saved size before trusting it (corrupt file, off-screen tiny
// values, etc.). Falls back to the mode's default for anything out of range.
function sanitizeSize(saved, fallback) {
  const w = saved && Number(saved.width);
  const h = saved && Number(saved.height);
  return {
    width: Number.isFinite(w) && w >= 200 && w <= 8000 ? Math.round(w) : fallback.width,
    height: Number.isFinite(h) && h >= 200 && h <= 8000 ? Math.round(h) : fallback.height,
  };
}
// Detached HUD windows — at most one open per kind. Tracked so the main
// renderer can forward profile/state events to them via IPC without
// re-opening or duplicating.
const hudWindows = {}; // keyed by kind ('button' | 'gyro' | 'axis' | 'roll')
let inventoryWindow = null;

// ── Frameless window dragging ──
// Per-window grab offset (cursor → window origin), captured at drag start.
// Driving the move from the main process with screen.getCursorScreenPoint()
// keeps repositioning DPI-correct and smooth, and avoids the cross-platform
// quirks of CSS -webkit-app-region: drag on a transparent frameless window
// (hijacked child clicks, double-click-to-maximize, flaky canvas hit-testing).
const dragOffsets = new Map(); // BrowserWindow.id -> { dx, dy }

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
  const list = hidControllerList();
  // The inventory window and the lobby both render this (the lobby shows each
  // seat's per-unit serial/MAC — see its Controllers panel).
  for (const w of [inventoryWindow, mainWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('hid-controllers-snapshot', list);
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

// Which size profile this launch uses. Single source of truth so the window
// creation and the "reset to default" handler agree on key + default size.
function getSizeMode() {
  const useLobby = process.env.OVERLAY_LOBBY === '1' || process.argv.includes('--lobby');
  if (useLobby) return { stateKey: 'lobby', defaultSize: LOBBY_WINDOW_SIZE };
  const useMulti = process.env.OVERLAY_MULTI === '1' || process.argv.includes('--multi');
  return {
    stateKey: useMulti ? 'multi' : 'main',
    defaultSize: useMulti ? MULTI_WINDOW_SIZE : DEFAULT_WINDOW_SIZE,
  };
}

function createWindow() {
  // Restore the last-used size for this mode (issue #69), falling back to the
  // mode's default (single = 720×540).
  const { stateKey, defaultSize } = getSizeMode();
  const { width, height } = sanitizeSize(readWindowState()[stateKey], defaultSize);

  mainWindow = new BrowserWindow({
    width,
    height,
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

  const entry = stateKey === 'lobby' ? 'lobby.html' : stateKey === 'multi' ? 'multi.html' : 'index.html';
  mainWindow.loadFile(path.join(__dirname, '..', 'src', entry));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // DevTools: Cmd+Shift+I to open manually (auto-open triggers Autofill errors)

  // Persist the window size as the user resizes (issue #69). Debounced so a
  // drag-resize doesn't hammer the disk; also saved on close as a backstop.
  const persistSize = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
    const [w, h] = mainWindow.getSize();
    const state = readWindowState();
    state[stateKey] = { width: w, height: h };
    writeWindowState(state);
  };
  mainWindow.on('resize', () => {
    // Live-update the settings panel's width×height fields as the user drags.
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [w, h] = mainWindow.getSize();
      mainWindow.webContents.send('window-size-changed', { width: w, height: h });
    }
    if (saveWindowSizeTimer) clearTimeout(saveWindowSizeTimer);
    saveWindowSizeTimer = setTimeout(persistSize, 400);
  });
  mainWindow.on('close', () => {
    if (saveWindowSizeTimer) { clearTimeout(saveWindowSizeTimer); saveWindowSizeTimer = null; }
    persistSize();
  });

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

  // ── Window size readout/editor (issue #69 follow-up) ──
  // The settings panel shows the live width×height and lets the user type an
  // exact size. getSize is the source of truth; setSize drives the window
  // (clamped to sane bounds so a stray keystroke can't shrink it to nothing
  // or blow it up off-screen). The matching 'window-size-changed' broadcast
  // (see createWindow) keeps the fields in sync when the user drag-resizes.
  ipcMain.handle('get-window-size', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const [width, height] = mainWindow.getSize();
    return { width, height };
  });
  ipcMain.on('set-window-size', (_event, { width, height }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const clampedW = Math.max(200, Math.min(8000, w));
    const clampedH = Math.max(200, Math.min(8000, h));
    mainWindow.setSize(clampedW, clampedH);
  });

  // "Reset all defaults" (settings panel) clears localStorage in the renderer,
  // but the window size lives in window-state.json (per mode), so it can't be
  // reached from there. Drop the persisted size and snap the live window back
  // to the mode's default so a reset truly restores everything.
  ipcMain.handle('reset-window-size', () => {
    const { stateKey, defaultSize } = getSizeMode();
    const state = readWindowState();
    delete state[stateKey];
    writeWindowState(state);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSize(defaultSize.width, defaultSize.height);
    }
    return defaultSize;
  });

  // ── Frameless window drag (renderer grabs a non-interactive area) ──
  // Renderer signals start/move/end; we compute position from the live
  // cursor so the grab point stays pinned under the pointer regardless of
  // DPI scaling or how fast the mouse moves. fromWebContents makes this work
  // for any frameless window (main overlay, detached HUD windows) that opts in.
  ipcMain.on('window-drag-start', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    dragOffsets.set(win.id, { dx: cursor.x - bounds.x, dy: cursor.y - bounds.y });
  });
  ipcMain.on('window-drag-move', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const off = dragOffsets.get(win.id);
    if (!off) return;
    const cursor = screen.getCursorScreenPoint();
    win.setPosition(Math.round(cursor.x - off.dx), Math.round(cursor.y - off.dy));
  });
  ipcMain.on('window-drag-end', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) dragOffsets.delete(win.id);
  });

  // Controller inventory window + its HID serial source (node-hid in main).
  ipcMain.handle('open-inventory-window', () => { openInventoryWindow(); return { opened: true }; });
  ipcMain.handle('list-hid-controllers', () => hidControllerList());

  // Detached HUD windows — a generic mechanism (issue #64). Each `kind` opens a
  // small frameless/transparent/always-on-top BrowserWindow loading its own
  // renderer HTML. One window per kind; re-focus if already open. State is
  // forwarded from the main renderer over IPC each frame (`hud-state`), so the
  // window needs no HID/Gamepad connection of its own.
  const HUD_WINDOWS = {
    button: { file: 'button-hud-window.html', width: 300, height: 280 },
    gyro:   { file: 'gyro-window.html',        width: 260, height: 260 },
    axis:   { file: 'axis-window.html',        width: 280, height: 90 },
    roll:   { file: 'roll-window.html',        width: 240, height: 170 },
    controllers: { file: 'controllers-window.html', width: 320, height: 460 },
  };

  ipcMain.handle('open-hud-window', async (_event, { kind, profile, greenScreen }) => {
    const cfg = HUD_WINDOWS[kind];
    if (!cfg) return { opened: false, reason: 'unknown kind' };
    const existing = hudWindows[kind];
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      existing.webContents.send('hud-profile-changed', profile);
      return { opened: true, alreadyOpen: true };
    }
    const win = new BrowserWindow({
      width: cfg.width, height: cfg.height,
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
    // Pass the current green-screen state in the query so the window can paint
    // the keyable background immediately on load (live changes come via
    // 'hud-greenscreen-update').
    win.loadFile(
      path.join(__dirname, '..', 'src', cfg.file),
      { query: {
        kind,
        profile: profile || '',
        gs: greenScreen?.on ? '1' : '0',
        gsColor: greenScreen?.color || '',
      } }
    );
    win.on('closed', () => { hudWindows[kind] = null; });
    hudWindows[kind] = win;
    return { opened: true, alreadyOpen: false };
  });

  // Green-screen on/off + color → broadcast to every open HUD window so they
  // chroma-key consistently with the main overlay.
  ipcMain.on('hud-greenscreen', (_event, gs) => {
    for (const k of Object.keys(hudWindows)) {
      const w = hudWindows[k];
      if (w && !w.isDestroyed()) w.webContents.send('hud-greenscreen-update', gs);
    }
  });

  // Profile change → forward to every open HUD window so labels track the
  // active controller without reopening.
  ipcMain.on('update-hud-profile', (_event, { profile }) => {
    for (const k of Object.keys(hudWindows)) {
      const w = hudWindows[k];
      if (w && !w.isDestroyed()) w.webContents.send('hud-profile-changed', profile);
    }
  });

  // Per-frame state forwarding to a specific HUD window (no-op if not open).
  // Forwarding from the main renderer (rather than the window polling its own
  // Gamepad API) sidesteps Chromium's per-document user-activation requirement.
  ipcMain.on('hud-state', (_event, { kind, state }) => {
    const w = hudWindows[kind];
    if (w && !w.isDestroyed()) w.webContents.send('hud-state-update', state);
  });

  // Controllers window → main overlay: a row was clicked; switch the shown pad.
  ipcMain.on('controller-select', (_event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('controller-select', payload);
  });

  // A detached window's close button uses this to close itself (frameless
  // windows have no titlebar close affordance).
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
