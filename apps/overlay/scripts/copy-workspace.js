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

const targets = [
  {
    label: '@usersfirst/controller-core',
    src: path.join(repoRoot, 'packages', 'core', 'src'),
    dest: path.join(appRoot, 'src', 'lib', 'controller-core'),
  },
  {
    label: '@usersfirst/controller-visualizer',
    src: path.join(repoRoot, 'packages', 'visualizer', 'src'),
    dest: path.join(appRoot, 'src', 'lib', 'controller-visualizer'),
  },
  {
    label: 'visualizer GLB assets',
    src: path.join(repoRoot, 'packages', 'visualizer', 'assets', 'controllers'),
    dest: path.join(appRoot, 'src', 'assets', 'controllers'),
  },
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

for (const t of targets) {
  if (!fs.existsSync(t.src)) {
    console.error(`ERROR: missing source for ${t.label}: ${t.src}`);
    process.exit(1);
  }
  if (fs.existsSync(t.dest)) {
    fs.rmSync(t.dest, { recursive: true, force: true });
  }
  copyRecursive(t.src, t.dest);
  console.log(`Copied ${t.label} → ${path.relative(repoRoot, t.dest)}`);
}
