#!/usr/bin/env node
// ============================================================
// SPLIT DPAD — re-shape an existing regions JSON so a single
// `dpad` region becomes four cardinal regions: dpad_up,
// dpad_right, dpad_down, dpad_left.
// ============================================================
//
// Reads the source GLB (to get triangle centroids), reads the
// region map saved by tools/face-painter/, isolates the dpad
// region, fits a local plane to its centroids via PCA, and
// assigns each face to one of four 90°-wedges around the dpad
// centroid in that plane. Writes a new region map with the
// four directional regions replacing the original `dpad`.
//
// Usage:
//   node tools/split-dpad.js <source.glb> <regions.json> [out.json] [--region dpad]
//
// Default out.json: <regions.json basename>.split-dpad.json
// Default region:   "dpad"
//
// The face-index convention matches tools/split-glb.js: triangle
// f's vertex i is at positions[getIndex(f, i) * 3 .. +2], where
// getIndex honors the source mesh's index buffer if present.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import meshoptimizer from 'meshoptimizer';
const { MeshoptDecoder, MeshoptEncoder } = meshoptimizer;
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, dirname, extname, join } from 'node:path';
import { argv, exit } from 'node:process';

const args = argv.slice(2).filter(a => !a.startsWith('--'));
const flags = Object.fromEntries(
  argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
);
const regionName = flags.region || 'dpad';
const [srcArg, regionsArg, outArg] = args;
if (!srcArg || !regionsArg) {
  console.error('Usage: node tools/split-dpad.js <source.glb> <regions.json> [out.json] [--region dpad]');
  exit(1);
}

const srcPath = resolve(srcArg);
const regionsPath = resolve(regionsArg);
const outPath = outArg
  ? resolve(outArg)
  : join(dirname(regionsPath), basename(regionsPath, extname(regionsPath)) + '.split-dpad.json');

const regionMap = JSON.parse(readFileSync(regionsPath, 'utf8'));
if (regionMap.schema !== 'glb-region-map/v1') {
  console.error(`Unknown schema: ${regionMap.schema}`);
  exit(1);
}

const targetRegion = regionMap.regions.find(r => r.name === regionName);
if (!targetRegion) {
  console.error(`Region "${regionName}" not found in ${regionsPath}`);
  console.error('Available regions:', regionMap.regions.map(r => r.name).join(', '));
  exit(1);
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
const doc = await io.read(srcPath);
const sourceMesh = doc.getRoot().listMeshes()[0];
const sourcePrim = sourceMesh.listPrimitives()[0];

const indices = sourcePrim.getIndices();
const positions = sourcePrim.getAttribute('POSITION').getArray();
const indexCount = indices
  ? indices.getCount()
  : sourcePrim.getAttribute('POSITION').getCount();
const triCount = indexCount / 3;
const indexArr = indices ? indices.getArray() : null;
const getIdx = (f, v) => indexArr ? indexArr[f * 3 + v] : (f * 3 + v);

console.log(`source: ${triCount.toLocaleString()} triangles, ${targetRegion.faces.length.toLocaleString()} in "${regionName}"`);

// 1) Per-face centroid in model space
const centroids = new Float64Array(targetRegion.faces.length * 3);
for (let i = 0; i < targetRegion.faces.length; i++) {
  const f = targetRegion.faces[i];
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < 3; v++) {
    const vi = getIdx(f, v);
    cx += positions[vi * 3];
    cy += positions[vi * 3 + 1];
    cz += positions[vi * 3 + 2];
  }
  centroids[i * 3]     = cx / 3;
  centroids[i * 3 + 1] = cy / 3;
  centroids[i * 3 + 2] = cz / 3;
}

// 2) Region centroid + covariance matrix → eigenvectors (PCA)
let mx = 0, my = 0, mz = 0;
for (let i = 0; i < centroids.length; i += 3) {
  mx += centroids[i]; my += centroids[i + 1]; mz += centroids[i + 2];
}
const n = centroids.length / 3;
mx /= n; my /= n; mz /= n;
console.log(`region centroid: (${mx.toFixed(3)}, ${my.toFixed(3)}, ${mz.toFixed(3)})`);

let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
for (let i = 0; i < centroids.length; i += 3) {
  const dx = centroids[i] - mx, dy = centroids[i + 1] - my, dz = centroids[i + 2] - mz;
  cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
  cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
}
const cov = [
  [cxx / n, cxy / n, cxz / n],
  [cxy / n, cyy / n, cyz / n],
  [cxz / n, cyz / n, czz / n],
];

// Jacobi eigendecomposition for a 3×3 symmetric matrix
function jacobi3(m) {
  const a = m.map(r => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 100; iter++) {
    // Find largest off-diagonal
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { p = 0; q = 2; max = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > max) { p = 1; q = 2; max = Math.abs(a[1][2]); }
    if (max < 1e-12) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = theta >= 0
      ? 1 / (theta + Math.sqrt(1 + theta * theta))
      : 1 / (theta - Math.sqrt(1 + theta * theta));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    a[p][p] = app - t * apq;
    a[q][q] = aqq + t * apq;
    a[p][q] = a[q][p] = 0;
    for (let i = 0; i < 3; i++) {
      if (i !== p && i !== q) {
        const aip = a[i][p], aiq = a[i][q];
        a[i][p] = a[p][i] = c * aip - s * aiq;
        a[i][q] = a[q][i] = s * aip + c * aiq;
      }
      const vip = v[i][p], viq = v[i][q];
      v[i][p] = c * vip - s * viq;
      v[i][q] = s * vip + c * viq;
    }
  }
  return {
    values: [a[0][0], a[1][1], a[2][2]],
    vectors: [
      [v[0][0], v[1][0], v[2][0]],
      [v[0][1], v[1][1], v[2][1]],
      [v[0][2], v[1][2], v[2][2]],
    ],
  };
}

const eig = jacobi3(cov);
// Sort by ascending eigenvalue: smallest = normal, others = in-plane
const order = [0, 1, 2].sort((a, b) => eig.values[a] - eig.values[b]);
const normal = eig.vectors[order[0]];
const inPlane1 = eig.vectors[order[1]];  // smaller in-plane spread
const inPlane2 = eig.vectors[order[2]];  // larger in-plane spread

console.log(`eigenvalues (ascending): ${order.map(i => eig.values[i].toExponential(2)).join(', ')}`);
console.log(`normal axis:   (${normal.map(v => v.toFixed(3)).join(', ')})`);
console.log(`in-plane 1:    (${inPlane1.map(v => v.toFixed(3)).join(', ')})`);
console.log(`in-plane 2:    (${inPlane2.map(v => v.toFixed(3)).join(', ')})`);

// 3) Decide which in-plane axis is "up" vs "right". The dpad's normal
//    is roughly the controller's face normal — so its two in-plane
//    axes are spread across the controller's WIDTH and DEPTH. The
//    longer world-bbox dimension of the whole controller is typically
//    its width (grip-to-grip), so the in-plane axis more aligned with
//    that world axis is "right"; the other is "up".
//
//    Sign of "up": the dpad sits near one edge of the controller. Its
//    "up" arrow should point AWAY from the controller centroid (toward
//    the nearer edge), so orient up so up·(dpadCentroid − bodyCentroid)
//    is positive. Sign of "right" then comes from normal × up, flipped
//    if it ends up pointing away from world +X.
//
//    Override available via --up-axis=+x|-x|+y|-y|+z|-z if a controller
//    has an unusual orientation.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// Overall controller bbox + centroid from all triangle centroids
let bbMin = [Infinity, Infinity, Infinity], bbMax = [-Infinity, -Infinity, -Infinity];
let bodyCx = 0, bodyCy = 0, bodyCz = 0, bodyN = 0;
for (let f = 0; f < triCount; f++) {
  let tx = 0, ty = 0, tz = 0;
  for (let v = 0; v < 3; v++) {
    const vi = getIdx(f, v);
    tx += positions[vi * 3]; ty += positions[vi * 3 + 1]; tz += positions[vi * 3 + 2];
  }
  tx /= 3; ty /= 3; tz /= 3;
  bodyCx += tx; bodyCy += ty; bodyCz += tz; bodyN++;
  if (tx < bbMin[0]) bbMin[0] = tx; if (tx > bbMax[0]) bbMax[0] = tx;
  if (ty < bbMin[1]) bbMin[1] = ty; if (ty > bbMax[1]) bbMax[1] = ty;
  if (tz < bbMin[2]) bbMin[2] = tz; if (tz > bbMax[2]) bbMax[2] = tz;
}
bodyCx /= bodyN; bodyCy /= bodyN; bodyCz /= bodyN;
const bbSize = [bbMax[0] - bbMin[0], bbMax[1] - bbMin[1], bbMax[2] - bbMin[2]];
console.log(`controller bbox size: (${bbSize.map(v => v.toFixed(0)).join(', ')})`);
console.log(`controller centroid: (${bodyCx.toFixed(0)}, ${bodyCy.toFixed(0)}, ${bodyCz.toFixed(0)})`);

let up, right;
if (flags['up-axis']) {
  const axisMap = {
    '+x': [1, 0, 0], '-x': [-1, 0, 0],
    '+y': [0, 1, 0], '-y': [0, -1, 0],
    '+z': [0, 0, 1], '-z': [0, 0, -1],
  };
  up = axisMap[flags['up-axis']];
  if (!up) { console.error(`Unknown --up-axis: ${flags['up-axis']}`); exit(1); }
  console.log(`up axis (override): (${up.join(', ')})`);
  // right derived from normal × up, projected to keep it perpendicular
  right = normalize(cross(normal, up));
} else {
  // Auto: pick "right" as the in-plane axis more aligned with the
  // controller's widest world axis.
  const widthAxisIdx =
    bbSize[0] >= bbSize[1] && bbSize[0] >= bbSize[2] ? 0 :
    bbSize[1] >= bbSize[2] ? 1 : 2;
  const widthAxis = [0, 0, 0]; widthAxis[widthAxisIdx] = 1;
  const align1 = Math.abs(dot(inPlane1, widthAxis));
  const align2 = Math.abs(dot(inPlane2, widthAxis));
  right = (align1 > align2 ? inPlane1 : inPlane2).slice();
  up    = (align1 > align2 ? inPlane2 : inPlane1).slice();

  // Orient "up" away from controller centroid
  const disp = [mx - bodyCx, my - bodyCy, mz - bodyCz];
  if (dot(up, disp) < 0) for (let i = 0; i < 3; i++) up[i] = -up[i];

  // Right = normal × up so the (right, up, normal) frame is consistent.
  // Then flip right if it ends up pointing in -X direction (purely
  // cosmetic — keeps "right on dpad" ≈ "right in world" when possible).
  right = normalize(cross(normal, up));
  if (right[widthAxisIdx] < 0) for (let i = 0; i < 3; i++) right[i] = -right[i];
}

console.log(`up axis:    (${up.map(v => v.toFixed(3)).join(', ')})`);
console.log(`right axis: (${right.map(v => v.toFixed(3)).join(', ')})`);

// 4) Bucket each face into one of the four cardinal wedges:
//    nearest cardinal direction (45° dividers between cardinals).
//    Tie-broken by sign so faces exactly on a diagonal go consistently.
const buckets = {
  dpad_up:    [],
  dpad_right: [],
  dpad_down:  [],
  dpad_left:  [],
};
for (let i = 0; i < n; i++) {
  const dx = centroids[i * 3]     - mx;
  const dy = centroids[i * 3 + 1] - my;
  const dz = centroids[i * 3 + 2] - mz;
  const u = dx * up[0]    + dy * up[1]    + dz * up[2];
  const r = dx * right[0] + dy * right[1] + dz * right[2];

  // Wedge by nearest cardinal: compare |u| vs |r|
  const f = targetRegion.faces[i];
  if (Math.abs(u) >= Math.abs(r)) {
    if (u >= 0) buckets.dpad_up.push(f);
    else        buckets.dpad_down.push(f);
  } else {
    if (r >= 0) buckets.dpad_right.push(f);
    else        buckets.dpad_left.push(f);
  }
}

console.log('split:');
for (const [k, v] of Object.entries(buckets)) {
  console.log(`  ${k.padEnd(12)} ${v.length.toLocaleString()} faces`);
}

// 5) Emit new regions JSON — original target region replaced by the 4 splits
const colors = {
  dpad_up:    '#ff5577',
  dpad_right: '#55ddaa',
  dpad_down:  '#5577ff',
  dpad_left:  '#ffcc44',
};
const newRegions = [];
for (const r of regionMap.regions) {
  if (r.name === regionName) {
    for (const dir of ['dpad_up', 'dpad_right', 'dpad_down', 'dpad_left']) {
      newRegions.push({ name: dir, color: colors[dir], faces: buckets[dir] });
    }
  } else {
    newRegions.push(r);
  }
}

const out = {
  ...regionMap,
  regions: newRegions,
  savedAt: new Date().toISOString(),
};
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${outPath}`);
