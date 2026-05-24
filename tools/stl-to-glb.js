#!/usr/bin/env node
// ============================================================
// stl-to-glb.js — convert a binary STL file to a minimal GLB
// ============================================================
//
// One-shot conversion utility for ingesting CAD-exported STL meshes
// (Valve's Steam Controller 2026 source files, vendor reference CAD,
// etc.) into the visualizer's GLB pipeline. STL stores naked triangles
// with no vertex sharing — this converter dedups vertices via a hash
// keyed on quantized position, building an indexed mesh that's
// typically 4-6× smaller than the raw STL.
//
// Output is a minimal GLB: one mesh, one primitive, POSITION + NORMAL
// + indices, no textures, no materials. Feed it through
// `gltf-transform optimize` afterwards for decimation + compression.
//
// Usage:
//   node tools/stl-to-glb.js input.stl output.glb [scale]
//
// Optional `scale` arg (default 1.0): multiplied into vertex positions
// at conversion time. CAD files often come in millimetres while the
// overlay expects ~0.1-0.3 units total controller width — try `0.01`
// (mm→cm) or `0.001` (mm→m) if the imported model is the wrong size.

const fs = require('fs');

const [, , inputPath, outputPath, scaleArg] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node tools/stl-to-glb.js <input.stl> <output.glb> [scale]');
  process.exit(1);
}
const scale = scaleArg ? Number(scaleArg) : 1.0;
if (!Number.isFinite(scale)) {
  console.error('Invalid scale:', scaleArg);
  process.exit(1);
}

// ── 1. Parse binary STL ────────────────────────────────────────
const stl = fs.readFileSync(inputPath);
if (stl.length < 84) { console.error('STL too small'); process.exit(1); }
const triCount = stl.readUInt32LE(80);
const expectedSize = 84 + 50 * triCount;
if (expectedSize !== stl.length) {
  console.error(`STL size mismatch — header says ${triCount} tris (${expectedSize} bytes), file is ${stl.length}. Is this an ASCII STL?`);
  process.exit(1);
}
console.log(`Input: ${inputPath} — ${triCount.toLocaleString()} tris, ${(stl.length / 1e6).toFixed(1)} MB`);

// ── 2. Dedup vertices ──────────────────────────────────────────
// Quantize to micrometer precision (6 decimals) for the dedup key.
// CAD exports often have tiny float noise that prevents naive dedup.
const positions = [];   // flat [x,y,z, x,y,z, ...]
const normals   = [];   // flat [nx,ny,nz, ...]
const indices   = [];   // flat [a,b,c, a,b,c, ...]
const seen      = new Map(); // key → vertex index

function vertexIndex(x, y, z, nx, ny, nz) {
  const key = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
  const existing = seen.get(key);
  if (existing !== undefined) return existing;
  const idx = positions.length / 3;
  positions.push(x, y, z);
  normals.push(nx, ny, nz);
  seen.set(key, idx);
  return idx;
}

let offset = 84;
for (let i = 0; i < triCount; i++, offset += 50) {
  const nx = stl.readFloatLE(offset +  0);
  const ny = stl.readFloatLE(offset +  4);
  const nz = stl.readFloatLE(offset +  8);
  const ax = stl.readFloatLE(offset + 12) * scale;
  const ay = stl.readFloatLE(offset + 16) * scale;
  const az = stl.readFloatLE(offset + 20) * scale;
  const bx = stl.readFloatLE(offset + 24) * scale;
  const by = stl.readFloatLE(offset + 28) * scale;
  const bz = stl.readFloatLE(offset + 32) * scale;
  const cx = stl.readFloatLE(offset + 36) * scale;
  const cy = stl.readFloatLE(offset + 40) * scale;
  const cz = stl.readFloatLE(offset + 44) * scale;
  // STL face normals attach to all three vertices; this loses smooth
  // shading at shared edges but matches what STL conceptually carries.
  // Re-running through `gltf-transform weld` (part of `optimize`) and
  // letting it recompute normals downstream usually gives better results
  // than carrying these STL-flat normals forward.
  indices.push(
    vertexIndex(ax, ay, az, nx, ny, nz),
    vertexIndex(bx, by, bz, nx, ny, nz),
    vertexIndex(cx, cy, cz, nx, ny, nz),
  );
}

console.log(`Deduped: ${(positions.length / 3).toLocaleString()} unique vertices (from ${(triCount * 3).toLocaleString()} raw), ${indices.length / 3} indexed tris`);

// ── 3. Compute bounding box for accessor min/max ──────────────
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < positions.length; i += 3) {
  const x = positions[i], y = positions[i + 1], z = positions[i + 2];
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (y < minY) minY = y; if (y > maxY) maxY = y;
  if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
}
console.log(`Bounding box: [${minX.toFixed(2)} .. ${maxX.toFixed(2)}, ${minY.toFixed(2)} .. ${maxY.toFixed(2)}, ${minZ.toFixed(2)} .. ${maxZ.toFixed(2)}]`);

// ── 4. Assemble binary buffer (positions, then normals, then indices) ──
// glTF requires 4-byte alignment per bufferView; floats are 4 bytes,
// uint32 indices are 4 bytes, so positions/normals/indices stay aligned.
const useUint32 = positions.length / 3 > 65535;
const indexBytes = useUint32 ? 4 : 2;
const indexType = useUint32 ? 5125 /* UNSIGNED_INT */ : 5123 /* UNSIGNED_SHORT */;

const positionBytes = positions.length * 4;
const normalBytes   = normals.length * 4;
const rawIndexBytes = indices.length * indexBytes;
// Pad index section to 4-byte alignment for the chunk boundary.
const paddedIndexBytes = (rawIndexBytes + 3) & ~3;

const binBuffer = Buffer.alloc(positionBytes + normalBytes + paddedIndexBytes);
let p = 0;
for (const v of positions) { binBuffer.writeFloatLE(v, p); p += 4; }
for (const v of normals)   { binBuffer.writeFloatLE(v, p); p += 4; }
for (const v of indices) {
  if (useUint32) binBuffer.writeUInt32LE(v, p);
  else           binBuffer.writeUInt16LE(v, p);
  p += indexBytes;
}

// ── 5. Build glTF JSON ─────────────────────────────────────────
const gltf = {
  asset: { version: '2.0', generator: 'stl-to-glb.js (tandemonium-controller-lab)' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'node_0', mesh: 0 }],
  meshes: [{
    name: 'node_0',
    primitives: [{
      attributes: { POSITION: 0, NORMAL: 1 },
      indices: 2,
    }],
  }],
  accessors: [
    { bufferView: 0, componentType: 5126 /* FLOAT */, count: positions.length / 3, type: 'VEC3',
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { bufferView: 1, componentType: 5126 /* FLOAT */, count: normals.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: indexType, count: indices.length, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 /* ARRAY_BUFFER */ },
    { buffer: 0, byteOffset: positionBytes, byteLength: normalBytes, target: 34962 },
    { buffer: 0, byteOffset: positionBytes + normalBytes, byteLength: rawIndexBytes, target: 34963 /* ELEMENT_ARRAY_BUFFER */ },
  ],
  buffers: [{ byteLength: binBuffer.length }],
};

// ── 6. Pack as GLB ─────────────────────────────────────────────
const jsonStr = JSON.stringify(gltf);
// Pad JSON to 4-byte alignment with spaces (must be valid JSON whitespace).
const paddedJsonLen = (jsonStr.length + 3) & ~3;
const jsonChunk = Buffer.alloc(paddedJsonLen, 0x20);  // 0x20 = space
jsonChunk.write(jsonStr, 0, jsonStr.length, 'utf8');

const totalLen = 12 /* header */ + 8 /* JSON chunk header */ + paddedJsonLen + 8 /* BIN chunk header */ + binBuffer.length;
const glb = Buffer.alloc(totalLen);
let cursor = 0;
// GLB header
glb.write('glTF', cursor); cursor += 4;
glb.writeUInt32LE(2, cursor); cursor += 4;             // version
glb.writeUInt32LE(totalLen, cursor); cursor += 4;      // total length
// JSON chunk
glb.writeUInt32LE(paddedJsonLen, cursor); cursor += 4;
glb.write('JSON', cursor); cursor += 4;
jsonChunk.copy(glb, cursor); cursor += paddedJsonLen;
// BIN chunk
glb.writeUInt32LE(binBuffer.length, cursor); cursor += 4;
glb.write('BIN\0', cursor); cursor += 4;
binBuffer.copy(glb, cursor); cursor += binBuffer.length;

fs.writeFileSync(outputPath, glb);
console.log(`Wrote: ${outputPath} — ${(glb.length / 1e6).toFixed(2)} MB`);
console.log('Run `npx -y @gltf-transform/cli optimize` next to decimate + compress.');
