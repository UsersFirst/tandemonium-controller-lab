#!/usr/bin/env node
// Copies Three.js modules from node_modules into src/lib/ so the import map works
// in both Electron and standalone browser contexts.

const fs = require('fs');
const path = require('path');

const srcLib = path.join(__dirname, '..', 'src', 'lib');

// Resolve `three` regardless of where the workspace installer placed it
// (hoisted to repo-root node_modules, or kept under apps/overlay/node_modules).
// `three/package.json` is not in the package's `exports` map so we can't
// require.resolve it directly — resolve the main entry instead and walk up
// until we find the package root.
let threeDir;
try {
  let dir = path.dirname(require.resolve('three'));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'three') { threeDir = dir; break; }
    }
    dir = path.dirname(dir);
  }
  if (!threeDir) throw new Error('walked out of node_modules without finding three');
} catch (e) {
  console.error('ERROR: could not resolve `three` package:', e.message);
  console.error('Did you run `npm install` at the repo root?');
  process.exit(1);
}

// Core module — handle different Three.js versions:
//   0.161 and earlier: build/three.module.js
//   0.170+: build/three.module.js may be removed, use build/three.cjs or src/Three.js
//   Some versions: build/three.webgpu.js as ESM entry
fs.mkdirSync(srcLib, { recursive: true });

const coreCandidates = [
  path.join(threeDir, 'build', 'three.module.js'),
  path.join(threeDir, 'build', 'three.module.min.js'),
  path.join(threeDir, 'src', 'Three.js'),
];
let coreCopied = false;
for (const candidate of coreCandidates) {
  if (fs.existsSync(candidate)) {
    fs.copyFileSync(candidate, path.join(srcLib, 'three.module.js'));
    console.log(`  Core: ${path.relative(threeDir, candidate)}`);
    coreCopied = true;
    break;
  }
}
if (!coreCopied) {
  console.error('ERROR: Could not find Three.js core module in node_modules/three/');
  console.error('Looked in:', coreCandidates.map(c => path.relative(threeDir, c)).join(', '));
  process.exit(1);
}

// Addons we need
const addons = [
  'loaders/GLTFLoader.js',
  'loaders/OBJLoader.js',
  'loaders/MTLLoader.js',
  'loaders/FBXLoader.js',
  'controls/OrbitControls.js',
  'exporters/GLTFExporter.js',
  'libs/fflate.module.js',
  'utils/BufferGeometryUtils.js',
  'curves/NURBSCurve.js',
  'curves/NURBSUtils.js',
];

// Addon directories vary by Three.js version
const addonDirs = [
  path.join(threeDir, 'examples', 'jsm'),  // 0.161 and earlier
  path.join(threeDir, 'addons'),            // 0.170+
];

for (const addon of addons) {
  let copied = false;
  for (const dir of addonDirs) {
    const src = path.join(dir, addon);
    if (fs.existsSync(src)) {
      const dest = path.join(srcLib, 'addons', addon);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`  Copied ${addon}`);
      copied = true;
      break;
    }
  }
  if (!copied) {
    console.warn(`  Warning: ${addon} not found`);
  }
}

console.log('Three.js modules copied to src/lib/');
