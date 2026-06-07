#!/usr/bin/env node
// ============================================================
// build-web.js — assemble the GitHub Pages site for lab.usersfirst.games
// ============================================================
//
// Layout produced in _site/:
//   _site/index.html   ← web/index.html (landing page)
//   _site/overlay/     ← apps/overlay/src (the overlay app, served at /overlay)
//   _site/CNAME        ← custom domain
//   _site/.nojekyll    ← serve files verbatim (no Jekyll _underscore munging)
//
// Run AFTER `node apps/overlay/scripts/copy-workspace.js`, which populates
// apps/overlay/src/lib/{controller-core,controller-visualizer} + the GLB
// assets. `three` is loaded from a CDN in web mode (the overlay's importmap),
// so it is NOT vendored here.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const site = path.join(root, '_site');
const overlaySrc = path.join(root, 'apps', 'overlay', 'src');
const DOMAIN = 'lab.usersfirst.games';

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(path.join(overlaySrc, 'lib', 'controller-core'))) {
  console.error('ERROR: apps/overlay/src/lib not populated.');
  console.error('Run `node apps/overlay/scripts/copy-workspace.js` first.');
  process.exit(1);
}

fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(site, { recursive: true });

fs.copyFileSync(path.join(root, 'web', 'index.html'), path.join(site, 'index.html'));
copyDir(overlaySrc, path.join(site, 'overlay'));
fs.writeFileSync(path.join(site, 'CNAME'), DOMAIN + '\n');
fs.writeFileSync(path.join(site, '.nojekyll'), '');

console.log(`Built _site/ for ${DOMAIN} (landing at /, overlay at /overlay/).`);
