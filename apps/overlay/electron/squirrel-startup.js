// Vendored, dependency-free port of `electron-squirrel-startup` (v1.0.1).
//
// Why vendored: this app is built in a monorepo (npm workspaces) where the
// `electron-squirrel-startup` package gets hoisted to the repo-root
// node_modules. Electron Forge packages only apps/overlay, so the hoisted
// module never lands in app.asar and `require('electron-squirrel-startup')`
// throws "Cannot find module" in the packaged .exe. Keeping a copy inside the
// app's own source (like copy-three.js does for three) guarantees it ships in
// the asar regardless of how the installer hoists dependencies.
//
// Behaviour is identical to the upstream package: when Squirrel.Windows
// launches the app with a --squirrel-* lifecycle flag, create/remove the
// Start-Menu + desktop shortcuts via Update.exe and signal the caller to quit.
// The only thing dropped is the optional `debug` logging (the package's sole
// dependency), which is what pulled in the hoisting problem.

const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

function run(args, done) {
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  spawn(updateExe, args, { detached: true }).on('close', done);
}

function check() {
  if (process.platform === 'win32') {
    const cmd = process.argv[1];
    const target = path.basename(process.execPath);

    if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
      run([`--createShortcut=${target}`], app.quit);
      return true;
    }
    if (cmd === '--squirrel-uninstall') {
      run([`--removeShortcut=${target}`], app.quit);
      return true;
    }
    if (cmd === '--squirrel-obsolete') {
      app.quit();
      return true;
    }
  }
  return false;
}

module.exports = check();
