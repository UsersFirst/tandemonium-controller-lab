#!/usr/bin/env node
// ============================================================
// build-steam-controller-glb.mjs — merge ceski's per-part OBJs → one GLB
// ============================================================
//
// Builds packages/visualizer/assets/controllers/steam-controller-split.glb
// from the vendored ceski Steam Controller parts (steam-controller-src/*.obj).
// Each part becomes one glTF node named by its filename stem (top_shell,
// left_trigger, south_button, …) so the `steam-controller` visualizer profile
// can address it for per-button animation.
//
// Geometry © Valve Corporation, CC BY-NC-SA 4.0 (component separation +
// poly reduction by ceski-1). See STEAM_CONTROLLER_ATTRIBUTION.md.
//
// Dependency-free (.mjs, matches the repo). Outputs an uncompressed GLB; run
// `npx -y @gltf-transform/cli optimize <out> <out>` afterwards for meshopt if
// desired (the existing pipeline does this).
//
// Usage:
//   node tools/build-steam-controller-glb.mjs [--scale 0.1] [--out <path>]
//
// NOTE: --scale and orientation need VISUAL confirmation against the other
// controller GLBs (they're in metres; ceski's units are ~±0.7). Tune --scale,
// reload the overlay, and compare size. Default 0.1 is a starting guess.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const SRC = path.join(REPO, 'packages/visualizer/assets/controllers/steam-controller-src');

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SCALE = parseFloat(argVal('--scale', '0.073'));
const OUT = argVal('--out', path.join(REPO, 'packages/visualizer/assets/controllers/steam-controller-split.glb'));

/** Parse a Wavefront OBJ → { positions:Float32Array, normals:Float32Array, indices:Uint32Array }. */
function parseObj(text, scale) {
  const v = [], vn = [];
  const keyToIdx = new Map();
  const positions = [], normals = [], indices = [];
  const pushVertex = (vi, ni) => {
    const key = vi + '/' + ni;
    let idx = keyToIdx.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      const p = v[vi]; // [x,y,z]
      positions.push(p[0] * scale, p[1] * scale, p[2] * scale);
      const n = ni >= 0 && vn[ni] ? vn[ni] : [0, 0, 1];
      normals.push(n[0], n[1], n[2]);
      keyToIdx.set(key, idx);
    }
    return idx;
  };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('v ')) { const [, x, y, z] = t.split(/\s+/); v.push([+x, +y, +z]); }
    else if (t.startsWith('vn ')) { const [, x, y, z] = t.split(/\s+/); vn.push([+x, +y, +z]); }
    else if (t.startsWith('f ')) {
      const toks = t.split(/\s+/).slice(1).map((tok) => {
        const [vi, , ni] = tok.split('/');
        return [parseInt(vi, 10) - 1, ni ? parseInt(ni, 10) - 1 : -1];
      });
      // Triangulate the polygon as a fan.
      for (let i = 1; i + 1 < toks.length; i++) {
        indices.push(pushVertex(...toks[0]), pushVertex(...toks[i]), pushVertex(...toks[i + 1]));
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

// ── Build glTF document ──
const parts = readdirSync(SRC).filter((f) => f.endsWith('.obj')).sort();
console.log(`Merging ${parts.length} parts at scale ${SCALE} → ${path.relative(REPO, OUT)}`);

const bin = [];           // Buffer chunks
let byteLength = 0;
const bufferViews = [];
const accessors = [];
const meshes = [];
const nodes = [];
let gmin = [Infinity, Infinity, Infinity], gmax = [-Infinity, -Infinity, -Infinity];

function addBufferView(typedArray) {
  const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  // glTF requires 4-byte alignment of bufferView byteOffsets.
  while (byteLength % 4 !== 0) { bin.push(Buffer.from([0])); byteLength += 1; }
  const byteOffset = byteLength;
  bin.push(buf); byteLength += buf.length;
  bufferViews.push({ buffer: 0, byteOffset, byteLength: buf.length });
  return bufferViews.length - 1;
}

for (const file of parts) {
  const name = path.basename(file, '.obj');
  const { positions, normals, indices } = parseObj(readFileSync(path.join(SRC, file), 'utf8'), SCALE);
  if (positions.length === 0) { console.warn(`  ${name}: no geometry, skipped`); continue; }

  // POSITION accessor (needs min/max).
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]);
      gmin[k] = Math.min(gmin[k], positions[i + k]); gmax[k] = Math.max(gmax[k], positions[i + k]);
    }
  }
  const posBV = addBufferView(positions);
  accessors.push({ bufferView: posBV, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max });
  const posAcc = accessors.length - 1;

  const nrmBV = addBufferView(normals);
  accessors.push({ bufferView: nrmBV, componentType: 5126, count: normals.length / 3, type: 'VEC3' });
  const nrmAcc = accessors.length - 1;

  const idxBV = addBufferView(indices);
  accessors.push({ bufferView: idxBV, componentType: 5125, count: indices.length, type: 'SCALAR' }); // 5125 = UNSIGNED_INT
  const idxAcc = accessors.length - 1;

  meshes.push({ name, primitives: [{ attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc }] });
  nodes.push({ name, mesh: meshes.length - 1 });
}

const gltf = {
  asset: { version: '2.0', generator: 'build-steam-controller-glb.mjs (ceski parts → GLB)' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes,
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

// ── Pack GLB container ──
const binBuffer = Buffer.concat(bin);
const jsonStr = JSON.stringify(gltf);
const jsonBuf = Buffer.from(jsonStr, 'utf8');
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]); // pad with spaces
const binPad = (4 - (binBuffer.length % 4)) % 4;
const binChunk = Buffer.concat([binBuffer, Buffer.alloc(binPad, 0)]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);          // 'glTF'
header.writeUInt32LE(2, 4);                    // version
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);       // 'JSON'
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);        // 'BIN\0'

writeFileSync(OUT, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));

const span = gmax.map((m, k) => (m - gmin[k]).toFixed(3));
console.log(`Wrote ${nodes.length} nodes, ${(byteLength / 1024).toFixed(0)} KB geometry.`);
console.log(`Model bounds (after scale ${SCALE}): ${span.join(' × ')} m  — compare ~0.15 m for a real controller; adjust --scale if off.`);
console.log('Next: visually verify in the overlay; then optionally `npx -y @gltf-transform/cli optimize` for meshopt.');
