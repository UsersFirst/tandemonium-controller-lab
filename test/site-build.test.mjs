// What the Cloudflare site build publishes: the pages and their files at the same paths the
// GitHub Pages build uses, nothing else, and the response headers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { build, buildStamp } = require('../scripts/build-site.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lab-site-'));
const has = (out, name) => fs.existsSync(path.join(out, name));

test('the pages and their files are published at the same paths as before', () => {
  const { out, files } = build({ out: temp() });
  for (const name of [
    'index.html', 'brand/favicon.svg', 'brand/housetandem-controller.svg',
    'overlay/index.html', 'overlay/multi.html', 'overlay/lobby.html', 'overlay/inventory.html', 'overlay/js/app.js',
    'overlay/lib/controller-core/index.js', 'overlay/lib/controller-visualizer/index.js',
    'overlay/lib/ui/index.js', 'overlay/lib/ui/tokens.css',
    'ui/gallery.html', 'ui/src/index.js', 'ui/src/tokens.css',
    'design-system/index.html', 'design-system/inventory.json', '_headers',
  ]) assert.equal(has(out, name), true, name);
  assert.ok(files.some((f) => /^overlay\/assets\/controllers\/.+\.glb$/.test(f)), 'controller models');
});

test('nothing else is published', () => {
  const { out, files } = build({ out: temp() });
  for (const name of ['CNAME', '.nojekyll', 'README.md', 'LICENSE', 'package.json', 'wrangler.jsonc', 'docs', 'tools',
    'scripts', 'test', 'packages', 'apps', 'node_modules', '.github', 'ui/test', 'ui/package.json', 'ui/tsconfig.json',
    'ui/README.md', 'overlay/lib/three']) assert.equal(has(out, name), false, name);
  const top = new Set(files.map((f) => f.split('/')[0]));
  assert.deepEqual([...top].sort(), ['_headers', 'brand', 'design-system', 'index.html', 'overlay', 'ui']);
  assert.deepEqual(files.filter((f) => /(^|\/)\.|\.map$|\.test\.[cm]?js$|(^|\/)package\.json$/.test(f)), []);
  // No audio or video: the host does not answer byte ranges for static files, so adding
  // media would need a small Worker in front of them.
  assert.deepEqual(files.filter((f) => /\.(mp4|webm|mov|m4v|mp3|m4a|ogg|wav)$/i.test(f)), []);
});

test('the overlay gets the packages from packages/, not from a local generated copy', () => {
  const { out } = build({ out: temp() });
  for (const [built, source] of [
    ['overlay/lib/controller-core/index.js', 'packages/core/src/index.js'],
    ['overlay/lib/controller-visualizer/index.js', 'packages/visualizer/src/index.js'],
    ['overlay/lib/ui/index.js', 'packages/ui/src/index.js'],
  ]) assert.deepEqual(fs.readFileSync(path.join(out, built)), fs.readFileSync(path.join(REPO, source)), built);
});

test('every local script, style and image a page names is published', () => {
  const { out, files } = build({ out: temp() });
  const missing = [];
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    for (const m of html.matchAll(/<(?:script|img|link)\b[^>]*?\b(?:src|href)="([^"#?]+)/gi)) {
      const ref = m[1];
      if (/^(https?:|data:|\/\/)/.test(ref)) continue;
      const target = ref.startsWith('/') ? path.join(out, ref) : path.resolve(path.dirname(path.join(out, f)), ref);
      if (!fs.existsSync(target)) missing.push(f + ' -> ' + ref);
    }
  }
  assert.deepEqual(missing, []);
});

test('headers: the security headers everywhere, and only staging is kept out of search', () => {
  const prod = fs.readFileSync(path.join(build({ out: temp() }).out, '_headers'), 'utf8');
  assert.ok(prod.startsWith('/*\n'));
  for (const h of ['Strict-Transport-Security: max-age=', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: SAMEORIGIN',
    'Referrer-Policy: ', 'Permissions-Policy: ', 'Access-Control-Allow-Origin: *']) assert.ok(prod.includes('  ' + h), h);
  assert.ok(!prod.includes('X-Robots-Tag'));
  const staging = fs.readFileSync(path.join(build({ env: 'staging', out: temp() }).out, '_headers'), 'utf8');
  assert.ok(staging.includes('X-Robots-Tag: noindex'));
  assert.throws(() => build({ env: 'other', out: temp() }), /Unknown environment/);
});

test('the build version is stamped into the built pages only', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const source = fs.readFileSync(path.join(REPO, 'web', 'index.html'), 'utf8');
  const { out } = build({ out: temp(), sha, pr: '12' });
  for (const page of ['index.html', 'overlay/index.html']) {
    const html = fs.readFileSync(path.join(out, page), 'utf8');
    assert.ok(html.includes(`/commit/${sha}"`) && html.includes('v.0123456</a>') && html.includes('PR #12 &middot; '), page);
  }
  assert.equal(fs.readFileSync(path.join(REPO, 'web', 'index.html'), 'utf8'), source);
  assert.equal(buildStamp({ sha, now: new Date('2026-01-02T03:04:05Z') }),
    `<a href="https://github.com/UsersFirst/tandemonium-controller-lab/commit/${sha}" target="_blank" rel="noopener">v.0123456</a> &middot; 2026-01-02 03:04 UTC`);
  assert.throws(() => buildStamp({ sha: '"><script>' }), /commit hash/);
  assert.throws(() => buildStamp({ sha, pr: '1;x' }), /number/);
});

test('another checkout is only read: generated copies, dotfiles and links in it are not published', () => {
  const root = temp();
  for (const dir of ['web', 'apps/overlay/src', 'packages/core/src', 'packages/visualizer/src', 'packages/visualizer/assets',
    'packages/ui/src', 'packages/ui/gallery.html', 'design/inventory']) {
    fs.cpSync(path.join(REPO, dir), path.join(root, dir), { recursive: true, filter: (p) => !/[\\/]src[\\/]lib$/.test(p) });
  }
  fs.mkdirSync(path.join(root, 'apps/overlay/src/lib/stale'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/overlay/src/lib/stale/old.js'), '');
  fs.writeFileSync(path.join(root, 'web/brand/.env'), 'x');
  let linked = true;
  try { fs.symlinkSync(path.join(REPO, 'package.json'), path.join(root, 'web/brand/link.json')); } catch { linked = false; }
  const { files } = build({ root, out: temp(), env: 'staging' });
  assert.ok(files.includes('overlay/lib/controller-core/index.js'));
  assert.ok(!files.includes('overlay/lib/stale/old.js'));
  assert.ok(!files.includes('brand/.env'));
  if (linked) assert.ok(!files.includes('brand/link.json'));
});

test('wrangler: staging has its own name and addresses, and never the live address', () => {
  const text = fs.readFileSync(path.join(REPO, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const config = JSON.parse(text);
  assert.equal(config.name, 'controller-lab-site');
  assert.deepEqual(config.routes, [{ pattern: 'lab.housetandem.com', custom_domain: true }]);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.main, undefined);
  const staging = config.env.staging;
  assert.equal(staging.name, 'controller-lab-site-staging');
  assert.deepEqual(staging.routes, []);
  assert.equal(staging.workers_dev, true);
  assert.equal(staging.preview_urls, true);
  for (const c of [config, staging]) assert.deepEqual(c.assets, { directory: './public', html_handling: 'auto-trailing-slash' });
});
