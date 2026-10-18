#!/usr/bin/env node
// ============================================================
// screenboard.mjs — capture every screen of an app at every viewport
// ============================================================
//
// Visual regression harness for the UI-kit migration (docs/UI-DESIGN-SYSTEM-PLAN.md).
// A manifest lists each screen and the DOM operations that reach it;
// this drives headless Chrome through the list at phone / desktop / TV sizes
// and writes:
//
//   design/screenboard/<manifest>/<screen>.<viewport>.png   one shot each
//   design/screenboard/<manifest>/run.json                  what was captured,
//                                                           plus the visible
//                                                           ids/classes per screen
//   design/screenboard/<manifest>/index.html                contact sheet
//
// Capture before a migration, capture after, open the two contact sheets side
// by side. run.json records the visible ids/classes per screen so a change can
// also be read without the pictures. --root overrides the manifest root (e.g.
// to capture a worktree).
//
//   node tools/screenboard/screenboard.mjs --manifest tandemonium
//   node tools/screenboard/screenboard.mjs --manifest lab-overlay --screens lobby-mode,lobby-seats
//   node tools/screenboard/screenboard.mjs --manifest tandemonium --viewports phone
//
// Manifest format: see tools/screenboard/manifests/*.json. Each screen has
// `ops`, run in order inside the page:
//   { "eval": "js expression or statements" }
//   { "show": "#sel", "display": "flex" }      remove [hidden], style.display=…
//   { "hide": ".sel" }                          style.display='none' on each match
//   { "class": "#sel", "add": "visible" }      / "remove": "…"
//   { "text": "#sel", "value": "…" }
//   { "html": "#sel", "value": "<b>…</b>" }
//   { "wait": 400 }                             ms
// A screen may set `"entry": "other.html"` to capture a different page of the same root.
// The `root` capture region defaults to the viewport; a screen can set
// `"clip": "#sel"` to capture just one element.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePuppeteer } from '../_lib/resolve-puppeteer.mjs';
import { serveStatic, interceptForCapture } from '../_lib/static-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(HERE, '..', '..');

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('manifest', 'tandemonium');
const onlyScreens = opt('screens') ? opt('screens').split(',') : null;
const onlyViewports = opt('viewports') ? opt('viewports').split(',') : null;
const PORT = Number(opt('port', 8946));
const DEBUG = args.includes('--debug');   // log page console output

const manifestPath = path.join(HERE, 'manifests', `${name}.json`);
if (!fs.existsSync(manifestPath)) { console.error(`no manifest: ${manifestPath}`); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const root = path.resolve(LAB, opt("root", manifest.root));
if (!fs.existsSync(path.join(root, manifest.entry))) { console.error(`entry not found: ${path.join(root, manifest.entry)}`); process.exit(2); }

// `three` CDN requests are answered from the first of these with node_modules/three
// (the served root for the game, the lab root for the overlay pages).
const THREE_ROOT = [root, path.resolve(LAB, manifest.root), LAB].find((d) => fs.existsSync(path.join(d, 'node_modules', 'three'))) || root;
const outDir = path.join(LAB, 'design', 'screenboard', name);
fs.mkdirSync(outDir, { recursive: true });

const viewports = Object.entries(manifest.viewports).filter(([v]) => !onlyViewports || onlyViewports.includes(v));
const screens = manifest.screens.filter((s) => !onlyScreens || onlyScreens.includes(s.id));

const puppeteer = await resolvePuppeteer(LAB);
const { origin, close } = await serveStatic(root, PORT);
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const allow = (manifest.allow || []).map((s) => new RegExp(s, 'i'));
const run = { manifest: name, root, entry: manifest.entry, generated: new Date().toISOString(), viewports: Object.fromEntries(viewports), screens: [] };
let failures = 0;

// Run one screen's ops in the page, then report what is on screen so the
// intake tool can say which components a markup touches.
async function applyOps(page, ops) {
  for (const op of ops || []) {
    if (op.wait) { await new Promise((r) => setTimeout(r, op.wait)); continue; }
    await page.evaluate((o) => {
      const q = (s) => Array.from(document.querySelectorAll(s));
      if (o.eval) { (0, eval)(o.eval); }
      if (o.show) for (const el of q(o.show)) { el.hidden = false; el.style.display = o.display ?? ''; }
      if (o.hide) for (const el of q(o.hide)) el.style.display = 'none';
      if (o.class) for (const el of q(o.class)) { if (o.add) el.classList.add(...o.add.split(' ')); if (o.remove) el.classList.remove(...o.remove.split(' ')); }
      if (o.text) for (const el of q(o.text)) el.textContent = o.value;
      if (o.html) for (const el of q(o.html)) el.innerHTML = o.value;
    }, op);
  }
}
async function inventory(page, clipSel) {
  return page.evaluate((sel) => {
    const rootEl = sel ? document.querySelector(sel) : document.body;
    if (!rootEl) return { ids: [], classes: [], buttons: 0 };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
    const ids = [], classes = new Set(); let buttons = 0;
    for (const el of rootEl.querySelectorAll('*')) {
      if (!vis(el)) continue;
      if (el.id) ids.push(el.id);
      for (const c of el.classList) classes.add(c);
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') buttons++;
    }
    return { ids: ids.slice(0, 200), classes: [...classes].sort(), buttons };
  }, clipSel || null);
}

for (const [vpName, vp] of viewports) {
  for (const s of screens) {
    const file = `${s.id}.${vpName}.png`;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    if (DEBUG) page.on('console', (m) => console.log(`[page:${m.type()}] ${m.text()}`));
    if (DEBUG) page.on('requestfailed', (r) => console.log(`[page:requestfailed] ${r.url()} ${(r.failure() || {}).errorText || ''}`));
    if (DEBUG) page.on('response', (r) => { if (r.status() >= 400) console.log(`[page:${r.status()}] ${r.url()}`); });
    try {
      await page.setViewport(vp);
      await interceptForCapture(page, { origin, threeRoot: THREE_ROOT, allow });
      await page.goto(`${origin}/${s.entry || manifest.entry}`, { waitUntil: 'domcontentloaded' });   // a screen may name its own page
      // waitFor is a function SOURCE ("() => …"); passing the string straight to
      // waitForFunction would evaluate it as an expression (a truthy function value)
      // and never wait. Evaluate the source, then call it, until it returns truthy.
      if (manifest.waitFor) {
        try { await page.waitForFunction((src) => (0, eval)(src)(), { timeout: 30000 }, manifest.waitFor); }
        catch (e) {
          // Say what the page looked like when the wait gave up — the usual cause is a
          // module that failed to load, which the page reports as a console error.
          const probe = await page.evaluate((src) => { try { return { ready: document.readyState, value: (0, eval)(src)() }; } catch (err) { return { ready: document.readyState, threw: String(err) }; } }, manifest.waitFor).catch((err) => ({ evaluateFailed: String(err) }));
          throw new Error(`waitFor never became true (${JSON.stringify(probe)}); page errors: ${errors.join(' | ') || 'none'}`);
        }
      }
      await applyOps(page, manifest.setup);
      await applyOps(page, s.ops);
      await new Promise((r) => setTimeout(r, manifest.settleMs ?? 400));
      const inv = await inventory(page, s.clip);
      if (s.clip) {
        const el = await page.$(s.clip);
        if (!el) throw new Error(`clip selector not found: ${s.clip}`);
        await el.screenshot({ path: path.join(outDir, file) });
      } else {
        await page.screenshot({ path: path.join(outDir, file) });
      }
      run.screens.push({ id: s.id, title: s.title || s.id, viewport: vpName, file, ids: inv.ids, classes: inv.classes, buttons: inv.buttons, errors });
      console.log(`[screenboard] ${vpName.padEnd(8)} ${s.id.padEnd(28)} ok${errors.length ? `  (${errors.length} page errors)` : ''}`);
    } catch (e) {
      failures++;
      run.screens.push({ id: s.id, title: s.title || s.id, viewport: vpName, file: null, error: String(e.message || e), errors });
      console.log(`[screenboard] ${vpName.padEnd(8)} ${s.id.padEnd(28)} FAIL ${e.message}`);
    } finally {
      await page.close();
    }
  }
}

await browser.close();
await close();

fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(run, null, 2));

// ── contact sheet ──
const byScreen = new Map();
for (const r of run.screens) { if (!byScreen.has(r.id)) byScreen.set(r.id, { title: r.title, shots: {} }); byScreen.get(r.id).shots[r.viewport] = r; }
const vpNames = viewports.map(([v]) => v);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Screenboard · ${name}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{--bg:#0d0f14;--fg:#e7ecf5;--mut:#8a93a6;--line:rgba(255,255,255,.12)}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif}
  header{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}
  header h1{font-size:16px;margin:0}header small{color:var(--mut)}
  .row{display:grid;grid-template-columns:200px repeat(${vpNames.length},1fr);gap:12px;padding:12px 18px;border-bottom:1px solid var(--line);align-items:start}
  .row h2{font-size:13px;margin:0 0 4px}.row code{font-size:11px;color:var(--mut)}
  .shot{display:block;max-width:100%;height:auto;max-height:420px;object-fit:contain;background:#000;border:1px solid var(--line);border-radius:6px}
  .fail{color:#ff6b7d;font-size:12px}.cap{font-size:11px;color:var(--mut);margin-top:4px}
  a.mark{font-size:11px;color:#7ae09a;text-decoration:none}
  @media(max-width:900px){.row{grid-template-columns:1fr}}
</style></head><body>
<header><h1>Screenboard · ${name}</h1><small>${run.generated} · ${run.screens.length} shots · ${failures} failed</small><small>columns: ${vpNames.join(' · ')}</small></header>
${[...byScreen.entries()].map(([id, s]) => `<div class="row"><div><h2>${s.title}</h2><code>${id}</code></div>${vpNames.map((v) => {
  const r = s.shots[v];
  if (!r) return '<div class="fail">—</div>';
  if (!r.file) return `<div class="fail">FAIL<br>${r.error}</div>`;
  return `<div><img class="shot" src="${r.file}" loading="lazy"><div class="cap">${v} ${run.viewports[v].width}×${run.viewports[v].height}${r.errors?.length ? ` · ${r.errors.length} js errors` : ''}</div></div>`;
}).join('')}</div>`).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`[screenboard] ${run.screens.length - failures}/${run.screens.length} captured → ${path.relative(LAB, outDir)}/index.html`);
process.exit(failures ? 1 : 0);
