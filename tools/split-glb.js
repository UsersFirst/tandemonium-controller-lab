#!/usr/bin/env node
// ============================================================
// SPLIT GLB — apply a face-region map to split a monolithic mesh
// ============================================================
//
// Consumes a JSON region map produced by tools/face-painter/ and a
// source GLB, and writes a new GLB where each named region is its own
// glTF Node + Mesh (so Three.js loads them as separate scene children
// with .name set to the region name — exactly what
// controller-profiles.js's buttonMap / triggerMap / stickMap expect).
// Unassigned faces become a 'body' mesh.
//
// Implementation walks the source mesh's triangle list, buckets each
// triangle's three vertices into the region the painter assigned to
// that face index, and rebuilds per-region primitives with their own
// (deduplicated) position / normal / index buffers. UV / vertex-color
// attributes are dropped — controller GLBs use solid materials and
// the visualizer animates per-mesh emissive separately.
//
// Usage:
//   node tools/split-glb.js <source.glb> <regions.json> [out.glb]
//
// Default out.glb path: <source-basename>-split.glb in the same
// directory as the source.
//
// Notes on face-index correspondence: the painter converts the
// source mesh to non-indexed (one set of 3 vertices per triangle)
// before assigning face indices. To stay consistent we do the same
// here — load the source, un-index if needed, then bucket triangles.

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup } from '@gltf-transform/functions';
// meshoptimizer is published as CJS — import as default and destructure
import meshoptimizer from 'meshoptimizer';
const { MeshoptDecoder, MeshoptEncoder } = meshoptimizer;
import { readFileSync } from 'node:fs';
import { resolve, basename, dirname, extname, join } from 'node:path';
import { argv, exit } from 'node:process';

const [, , srcArg, regionsArg, outArg] = argv;
if (!srcArg || !regionsArg) {
  console.error('Usage: node tools/split-glb.js <source.glb> <regions.json> [out.glb]');
  exit(1);
}

const srcPath = resolve(srcArg);
const regionsPath = resolve(regionsArg);
const outPath = outArg
  ? resolve(outArg)
  : join(dirname(srcPath), basename(srcPath, extname(srcPath)) + '-split.glb');

const regionMap = JSON.parse(readFileSync(regionsPath, 'utf8'));
if (regionMap.schema !== 'glb-region-map/v1') {
  console.error(`Unknown schema: ${regionMap.schema}`);
  exit(1);
}

// Register meshopt so the input GLB (which we ship meshopt-compressed
// via gltf-transform optimize in the visualizer pipeline) actually
// decodes. Output is written uncompressed — the visualizer's Three.js
// loader handles either form; re-compress as a separate step if size
// matters.
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
const doc = await io.read(srcPath);
const root = doc.getRoot();

// Find the first mesh + primitive (assumes single-primitive monolithic
// GLBs, which is the case for our Steam Controller + Super Nova).
const sourceMesh = root.listMeshes()[0];
const sourcePrim = sourceMesh.listPrimitives()[0];

const indices = sourcePrim.getIndices();
const positionAttr = sourcePrim.getAttribute('POSITION');
const normalAttr = sourcePrim.getAttribute('NORMAL');
const positions = positionAttr.getArray();
const normals = normalAttr ? normalAttr.getArray() : null;
const indexCount = indices ? indices.getCount() : positionAttr.getCount();
const triCount = indexCount / 3;

console.log(`source: ${triCount.toLocaleString()} triangles`);
if (triCount !== regionMap.totalFaces) {
  console.warn(`⚠  region map has ${regionMap.totalFaces} faces, source has ${triCount}. Mismatch will likely produce garbage.`);
}

// Build face-index → region-name lookup
const faceToRegion = new Array(triCount).fill(null);
for (const region of regionMap.regions) {
  for (const f of region.faces) {
    if (f >= 0 && f < triCount) faceToRegion[f] = region.name;
  }
}

// Bucket triangles by region (faces not assigned go to 'body')
const buckets = new Map();
function bucketFor(name) {
  if (!buckets.has(name)) buckets.set(name, { positions: [], normals: [] });
  return buckets.get(name);
}

function getIndex(faceIdx, vertexOffset) {
  const i = faceIdx * 3 + vertexOffset;
  return indices ? indices.getArray()[i] : i;
}

for (let f = 0; f < triCount; f++) {
  const name = faceToRegion[f] || 'body';
  const bucket = bucketFor(name);
  for (let v = 0; v < 3; v++) {
    const vi = getIndex(f, v);
    bucket.positions.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
    if (normals) {
      bucket.normals.push(normals[vi * 3], normals[vi * 3 + 1], normals[vi * 3 + 2]);
    }
  }
}

// Build a fresh, empty document for the output. We don't clone the
// source because the source carries EXT_meshopt_compression extension
// declarations that would mismatch our uncompressed output.
const outDoc = new Document();
const buffer = outDoc.createBuffer();
const outScene = outDoc.createScene('scene');
outDoc.getRoot().setDefaultScene(outScene);

// Recreate the source material (PBR with default values) so meshes
// have something to render against. Skip texture/UV plumbing — our
// controller GLBs are solid-color and the visualizer overrides
// materials per-mesh anyway.
const srcMat = doc.getRoot().listMaterials()[0];
const material = outDoc.createMaterial('material')
  .setBaseColorFactor(srcMat ? srcMat.getBaseColorFactor() : [0.85, 0.85, 0.87, 1])
  .setRoughnessFactor(srcMat ? srcMat.getRoughnessFactor() : 0.6)
  .setMetallicFactor(srcMat ? srcMat.getMetallicFactor() : 0.1);

console.log(`writing ${buckets.size} region mesh(es):`);
for (const [name, bucket] of buckets) {
  console.log(`  ${name}: ${(bucket.positions.length / 9).toLocaleString()} triangles`);
  const posAttr = outDoc.createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(bucket.positions))
    .setBuffer(buffer);
  const prim = outDoc.createPrimitive()
    .setAttribute('POSITION', posAttr);
  if (bucket.normals.length) {
    const nrmAttr = outDoc.createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(bucket.normals))
      .setBuffer(buffer);
    prim.setAttribute('NORMAL', nrmAttr);
  }
  if (material) prim.setMaterial(material);
  const mesh = outDoc.createMesh(name).addPrimitive(prim);
  const node = outDoc.createNode(name).setMesh(mesh);
  outScene.addChild(node);
}

// Dedup + write
await outDoc.transform(dedup());
await io.write(outPath, outDoc);
console.log(`wrote ${outPath}`);
