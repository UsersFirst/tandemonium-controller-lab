// ============================================================
// GLB FACE PAINTER — assign faces to named regions for mesh splitting
// ============================================================
//
// Standalone tool (no project dependencies) for splitting monolithic
// controller GLBs into per-button meshes. The user loads a GLB, clicks
// on the rendered model to "paint" individual triangles into named
// regions (face_a, dpad_up, stick_left, etc.), and saves the resulting
// face-index → region map as JSON. A separate Node script
// (tools/split-glb.js) consumes the JSON + original GLB and emits a
// new GLB with named per-region meshes the visualizer can animate.
//
// Built around the GLB we already ship (which is meshopt-compressed)
// — registers MeshoptDecoder so loading works. Loaded GLB → first
// mesh is the paint target. Geometry is converted to non-indexed so
// each triangle has its own three vertices, which lets us set per-face
// colors via vertex colors without index gymnastics.
//
// State model: a flat list of regions, each with { name, color, faces:
// Set<faceIndex> }. Active region receives clicks. JSON output is
// regions in declaration order, faces as sorted arrays for stability
// across save / load cycles.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ── DOM refs ──
const glbInput = document.getElementById('glb-input');
const loadInput = document.getElementById('load-input');
const saveBtn = document.getElementById('save-json');
const clearBtn = document.getElementById('clear-all');
const addRegionBtn = document.getElementById('add-region');
const regionsEl = document.getElementById('regions');
const fileNameEl = document.getElementById('file-name');
const statusMeshEl = document.getElementById('status-mesh');
const statusActiveEl = document.getElementById('status-active');
const canvas = document.getElementById('canvas');

// ── Scene ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1014);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Same tone mapping + exposure as the overlay so the rendered surface
// has contrast — without these, the flat-shaded mesh looks washed out
// and surface details (button reliefs, trackpad indentations) are hard
// to make out for region planning.
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
function resize() {
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(0, 0.05, 0.35);
window.addEventListener('resize', resize);

// Mouse mapping: right-button orbits, middle-button pans, left-button
// is unmapped here so painter clicks don't fight OrbitControls. Same
// convention Blender / Maya / Sketchfab use — separates camera from
// content manipulation cleanly without a mode toggle.
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.enablePan = true;

// Studio-style lighting matching the controller overlay so the GLB
// renders with the same surface contrast you see in the main app.
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(2, 3, 2); scene.add(key);
const front = new THREE.DirectionalLight(0xffffff, 0.8); front.position.set(0, 1, 3); scene.add(front);
const fill = new THREE.DirectionalLight(0xb0c4de, 0.5); fill.position.set(-2, 1, -1); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.3); rim.position.set(0, -1, -2); scene.add(rim);

// ── State ──
// Brighter default so the standard lighting actually shows surface
// shading. Dark grays absorb almost all light and produce a featureless
// silhouette, hiding the button reliefs we need to see to paint accurately.
const DEFAULT_COLOR = 0xd0d3da;
const DEFAULT_PALETTE = [
  '#33dd55', '#dd3333', '#3366dd', '#eebb22',
  '#ff8800', '#9966cc', '#22cccc', '#cc66aa',
  '#88dd44', '#ee5533', '#5588ee', '#ffcc44',
];

let targetMesh = null;       // the THREE.Mesh we paint on
let totalFaces = 0;          // number of triangles in the mesh
let faceColors = null;       // Float32Array (3 vertices * 3 channels per face)
let faceRegion = null;       // Int32Array (per-face region index; -1 = unassigned)
let regions = [];            // [{ name, color: '#hex', faces: Set<int> }]
let activeRegionIdx = -1;

// ── Loading ──
glbInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadGlb(file);
});

async function loadGlb(file) {
  const buf = await file.arrayBuffer();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.parse(buf, '', (gltf) => {
    setupMesh(gltf.scene);
    fileNameEl.textContent = file.name;
  }, (err) => {
    console.error(err);
    statusMeshEl.textContent = 'Load failed';
    statusMeshEl.className = 'err';
  });
}

function setupMesh(gltfScene) {
  // Remove any previous mesh
  if (targetMesh) {
    scene.remove(targetMesh);
    targetMesh.geometry?.dispose();
    targetMesh.material?.dispose();
    targetMesh = null;
  }

  // Find first mesh
  let firstMesh = null;
  gltfScene.traverse((c) => { if (c.isMesh && !firstMesh) firstMesh = c; });
  if (!firstMesh) {
    statusMeshEl.textContent = 'No mesh in GLB';
    statusMeshEl.className = 'err';
    return;
  }

  // Convert to non-indexed so each face has its own 3 vertices.
  // Required for per-face vertex coloring without complex index tricks.
  let geo = firstMesh.geometry;
  if (geo.index) geo = geo.toNonIndexed();
  geo.computeVertexNormals();

  totalFaces = geo.attributes.position.count / 3;

  // Per-face region tracking + per-vertex color buffer
  faceRegion = new Int32Array(totalFaces).fill(-1);
  faceColors = new Float32Array(geo.attributes.position.count * 3);
  // Initialize all faces to default color
  for (let f = 0; f < totalFaces; f++) writeFaceColor(f);
  geo.setAttribute('color', new THREE.BufferAttribute(faceColors, 3));

  // Fit & center
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 0.25 / maxDim;
  const center = new THREE.Vector3();
  geo.boundingBox.getCenter(center);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(scale);
  mesh.position.copy(center).multiplyScalar(-scale);
  scene.add(mesh);
  targetMesh = mesh;

  statusMeshEl.textContent = `${totalFaces.toLocaleString()} faces`;
  statusMeshEl.className = 'ok';
  // Frame the camera on the new mesh
  controls.target.set(0, 0, 0);
  camera.position.set(0, 0.05, 0.35);
  controls.update();
  renderRegions();
}

// ── Color buffer helpers ──
// For non-indexed geometry: face `f` covers vertices [3f, 3f+1, 3f+2].
// faceColors has 3 floats per vertex → 9 floats per face.

function colorForFace(f) {
  const rIdx = faceRegion[f];
  if (rIdx < 0) return null;
  return regions[rIdx]?.color || null;
}

function hexToRGB(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

function writeFaceColor(f) {
  const hex = colorForFace(f);
  const [r, g, b] = hex ? hexToRGB(hex) : hexToRGB(`#${DEFAULT_COLOR.toString(16).padStart(6, '0')}`);
  const base = f * 9;
  for (let v = 0; v < 3; v++) {
    faceColors[base + v * 3 + 0] = r;
    faceColors[base + v * 3 + 1] = g;
    faceColors[base + v * 3 + 2] = b;
  }
}

function colorAttrDirty() {
  if (targetMesh) targetMesh.geometry.attributes.color.needsUpdate = true;
}

// ── Region UI ──

function addRegion(opts = {}) {
  const idx = regions.length;
  const color = opts.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];
  const name = opts.name || `region_${idx + 1}`;
  regions.push({ name, color, faces: opts.faces || new Set() });
  if (activeRegionIdx < 0) activeRegionIdx = idx;
  renderRegions();
  return idx;
}

addRegionBtn.addEventListener('click', () => addRegion());

function setActive(idx) {
  activeRegionIdx = idx;
  renderRegions();
}

function deleteRegion(idx) {
  // Un-paint all faces assigned to this region first
  for (const f of regions[idx].faces) {
    faceRegion[f] = -1;
    writeFaceColor(f);
  }
  colorAttrDirty();
  regions.splice(idx, 1);
  if (activeRegionIdx >= regions.length) activeRegionIdx = regions.length - 1;
  renderRegions();
}

function renameRegion(idx) {
  const cur = regions[idx].name;
  const next = prompt('Region name:', cur);
  if (next && next !== cur) {
    regions[idx].name = next;
    renderRegions();
  }
}

function recolorRegion(idx) {
  const cur = regions[idx].color;
  const next = prompt('Region color (#rrggbb):', cur);
  if (next && /^#[0-9a-fA-F]{6}$/.test(next) && next !== cur) {
    regions[idx].color = next;
    for (const f of regions[idx].faces) writeFaceColor(f);
    colorAttrDirty();
    renderRegions();
  }
}

function clearRegionFaces(idx) {
  const r = regions[idx];
  if (r.faces.size === 0) return;
  if (!confirm(`Unpaint all ${r.faces.size} face(s) from "${r.name}"? (keeps the region)`)) return;
  // Record as one undo stroke so Ctrl+Z restores it.
  currentStroke = new Map();
  for (const f of [...r.faces]) {
    assignFaceToRegion(f, -1);
  }
  if (currentStroke.size > 0) {
    undoStack.push({ changes: currentStroke });
    while (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  currentStroke = null;
  colorAttrDirty();
  renderRegions();
}

function renderRegions() {
  regionsEl.innerHTML = '';
  regions.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'region' + (i === activeRegionIdx ? ' active' : '');
    el.innerHTML = `
      <span class="swatch" style="background:${r.color}"></span>
      <span class="name"></span>
      <span class="count">${r.faces.size}</span>
      <span class="actions">
        <button data-act="rename" title="Rename">✎</button>
        <button data-act="color" title="Color">●</button>
        <button data-act="clear" title="Unpaint faces (keep region)">⌫</button>
        <button data-act="delete" title="Delete region">✕</button>
      </span>
    `;
    el.querySelector('.name').textContent = r.name;
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      setActive(i);
    });
    el.querySelector('[data-act=rename]').addEventListener('click', () => renameRegion(i));
    el.querySelector('[data-act=color]').addEventListener('click', () => recolorRegion(i));
    el.querySelector('[data-act=clear]').addEventListener('click', () => clearRegionFaces(i));
    el.querySelector('[data-act=delete]').addEventListener('click', () => {
      if (confirm(`Delete region "${r.name}" and unpaint its ${r.faces.size} face(s)?`)) deleteRegion(i);
    });
    regionsEl.appendChild(el);
  });
  statusActiveEl.textContent = activeRegionIdx >= 0
    ? `active: ${regions[activeRegionIdx].name}`
    : '(no active region — add one to start painting)';
}

// ── Painting + undo ──
//
// Left-click owns paint exclusively (OrbitControls is remapped to right-
// button orbit). Each stroke = one mousedown→mouseup window; all face
// changes within that window go into one undo entry. Ctrl+Z reverts the
// last stroke; we keep a bounded stack (no redo for now — typical paint
// app pattern is "undo until happy then keep going").

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let painting = false;
let paintMode = 'add';        // 'add' | 'remove' (shift held)
const UNDO_LIMIT = 50;
const undoStack = [];          // [{ changes: Map<faceIdx, prevRegionIdx> }, ...]
let currentStroke = null;      // active stroke's change map, or null

function pickFaceFromEvent(ev) {
  if (!targetMesh) return -1;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(targetMesh, false);
  return hits.length > 0 ? hits[0].faceIndex : -1;
}

function assignFaceToRegion(f, targetIdx) {
  // targetIdx === -1 means unpaint.
  const prev = faceRegion[f];
  if (prev === targetIdx) return false;
  // Record original region BEFORE we mutate, but only on the FIRST
  // change to this face in the current stroke — subsequent re-paints
  // of the same face within one stroke shouldn't overwrite the
  // original-state record.
  if (currentStroke && !currentStroke.has(f)) currentStroke.set(f, prev);
  if (prev >= 0) regions[prev].faces.delete(f);
  if (targetIdx >= 0) regions[targetIdx].faces.add(f);
  faceRegion[f] = targetIdx;
  writeFaceColor(f);
  return true;
}

function paintFace(f) {
  if (f < 0) return;
  if (paintMode === 'add') {
    if (activeRegionIdx < 0) return;
    assignFaceToRegion(f, activeRegionIdx);
  } else {
    assignFaceToRegion(f, -1);
  }
}

canvas.addEventListener('mousedown', (ev) => {
  // Left-button only. Right-button is OrbitControls' rotate (see
  // controls.mouseButtons above), middle is pan, scroll is zoom.
  if (ev.button !== 0) return;
  // Open a new undo stroke. Even if no faces end up changing, the
  // stroke just stays empty and we drop it on mouseup.
  painting = true;
  paintMode = ev.shiftKey ? 'remove' : 'add';
  currentStroke = new Map();
  const f = pickFaceFromEvent(ev);
  paintFace(f);
  colorAttrDirty();
  renderRegions();
});
canvas.addEventListener('mousemove', (ev) => {
  if (!painting) return;
  const f = pickFaceFromEvent(ev);
  paintFace(f);
  colorAttrDirty();
});
function finishStroke() {
  if (!painting) return;
  painting = false;
  if (currentStroke && currentStroke.size > 0) {
    undoStack.push({ changes: currentStroke });
    while (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  currentStroke = null;
  renderRegions();
}
canvas.addEventListener('mouseup', finishStroke);
canvas.addEventListener('mouseleave', finishStroke);

// Ctrl+Z (or Cmd+Z) undoes the most recent stroke by replaying its
// per-face previous-region records in reverse.
window.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
    ev.preventDefault();
    undoLastStroke();
  }
});
function undoLastStroke() {
  const stroke = undoStack.pop();
  if (!stroke) return;
  // Restore each face to its prior region (without re-recording into
  // currentStroke — we're rewinding, not tracking a new stroke).
  const saved = currentStroke;
  currentStroke = null;
  for (const [f, prev] of stroke.changes) {
    assignFaceToRegion(f, prev);
  }
  currentStroke = saved;
  colorAttrDirty();
  renderRegions();
}

// ── Save / Load ──

saveBtn.addEventListener('click', () => {
  if (!targetMesh) return alert('Load a GLB first.');
  const payload = {
    schema: 'glb-region-map/v1',
    sourceFile: fileNameEl.textContent,
    totalFaces,
    savedAt: new Date().toISOString(),
    regions: regions.map((r) => ({
      name: r.name,
      color: r.color,
      faces: Array.from(r.faces).sort((a, b) => a - b),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (fileNameEl.textContent || 'regions').replace(/\.(glb|gltf)$/i, '') + '.regions.json';
  a.click();
  URL.revokeObjectURL(url);
});

loadInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return alert('Not valid JSON'); }
  if (data.schema !== 'glb-region-map/v1') {
    return alert(`Expected schema 'glb-region-map/v1', got '${data.schema}'`);
  }
  if (targetMesh && data.totalFaces !== totalFaces) {
    if (!confirm(`Loaded map is for a mesh with ${data.totalFaces} faces; current mesh has ${totalFaces}. Load anyway?`)) return;
  }
  // Clear existing regions
  regions = [];
  if (faceRegion) faceRegion.fill(-1);
  for (const r of data.regions) {
    addRegion({ name: r.name, color: r.color, faces: new Set(r.faces) });
    const idx = regions.length - 1;
    for (const f of r.faces) {
      if (f >= 0 && f < totalFaces) {
        faceRegion[f] = idx;
        writeFaceColor(f);
      }
    }
  }
  colorAttrDirty();
  renderRegions();
});

clearBtn.addEventListener('click', () => {
  if (!regions.length) return;
  if (!confirm(`Clear all ${regions.length} region(s) and unpaint everything?`)) return;
  regions = [];
  activeRegionIdx = -1;
  if (faceRegion) faceRegion.fill(-1);
  if (faceColors) for (let f = 0; f < totalFaces; f++) writeFaceColor(f);
  colorAttrDirty();
  renderRegions();
});

// ── Render loop ──
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
resize();
animate();

// Initial state
renderRegions();
