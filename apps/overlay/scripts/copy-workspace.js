#!/usr/bin/env node
// Copies workspace package sources into apps/overlay/src/lib/ so the
// importmap in index.html / multi.html can resolve them as plain ES modules
// (no bundler). Also copies visualizer GLB assets into src/assets/controllers/
// where controller-profiles.js expects them at runtime.
//
// Mirrors the copy-three.js pattern: run as prestart and prepackage so dev
// and packaged builds both pick the latest sources off the workspace.

const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');

// Paths are relative to the repo root. scripts/build-site.js reads this list too, so the
// site it builds vendors the same packages to the same places.
const targets = [
  { label: '@usersfirst/controller-core', src: 'packages/core/src', dest: 'apps/overlay/src/lib/controller-core' },
  { label: '@usersfirst/controller-visualizer', src: 'packages/visualizer/src', dest: 'apps/overlay/src/lib/controller-visualizer' },
  { label: '@usersfirst/ui', src: 'packages/ui/src', dest: 'apps/overlay/src/lib/ui' },
  { label: 'visualizer GLB assets', src: 'packages/visualizer/assets/controllers', dest: 'apps/overlay/src/assets/controllers' },
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function main() {
  for (const t of targets) {
    const src = path.join(repoRoot, t.src);
    const dest = path.join(repoRoot, t.dest);
    if (!fs.existsSync(src)) {
      console.error(`ERROR: missing source for ${t.label}: ${src}`);
      process.exit(1);
    }
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    copyRecursive(src, dest);
    console.log(`Copied ${t.label} → ${path.relative(repoRoot, dest)}`);
  }
}

if (require.main === module) main();

module.exports = { targets };
