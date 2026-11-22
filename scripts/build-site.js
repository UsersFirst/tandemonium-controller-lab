#!/usr/bin/env node
// Builds what lab.housetandem.com publishes into public/, for Cloudflare Workers static assets:
// the pages at the paths the site has always had (it was on GitHub Pages before), from a
// list of what is published, plus the response headers (_headers).
//
//   node scripts/build-site.js                      production
//   node scripts/build-site.js --env staging        staging and PR previews: not indexed
//   node scripts/build-site.js --root <checkout>    read the site's files from another checkout
//   node scripts/build-site.js --out <dir>          build somewhere else (tests)
//   node scripts/build-site.js --sha <commit> [--pr <number>]   stamp the build version
//
// It only copies files; it never runs anything from the tree it reads, so the PR preview
// workflow can use main's copy of this script on a branch's files. It also does not need
// copy-workspace.js to have run: the packages are vendored straight from packages/.
const fs = require('fs');
const path = require('path');
const { targets: VENDORED } = require('../apps/overlay/scripts/copy-workspace.js');

const REPO = path.join(__dirname, '..');
const OVERLAY_SRC = 'apps/overlay/src';
const REPO_URL = 'https://github.com/UsersFirst/tandemonium-controller-lab';

// What is published: [source in the repo, path on the site]. A folder is copied whole.
const PUBLISHED = [
  ['web/index.html', 'index.html'],                 // landing page
  ['web/brand', 'brand'],                           // icon and favicons
  [OVERLAY_SRC, 'overlay'],                         // the overlay app
  ['packages/ui/gallery.html', 'ui/gallery.html'],  // UI kit gallery; it imports ./src/
  ['packages/ui/src', 'ui/src'],
  ['design/inventory', 'design-system'],            // design-system inventory report
];
// Generated folders inside the overlay (gitignored). A local copy may be stale or hold
// desktop-only files, so they are skipped and filled from packages/ below.
const GENERATED = ['lib', 'assets/controllers'].map((d) => `${OVERLAY_SRC}/${d}`);
// Never published, wherever they are: dotfiles, source maps, tests, package files.
const NEVER = /^(\..*|.*\.map|.*\.test\.[cm]?js|package(-lock)?\.json|tsconfig\.json|node_modules)$/i;
const MAX_FILE = 25 * 1024 * 1024; // the host's limit for one file
const STAMPED = ['index.html', 'overlay/index.html'];
const STAMP_RE = /(<span id="build-version">)[\s\S]*?(<\/span>)/;

function copyTree(from, to, skip = () => false) {
  const stat = fs.lstatSync(from);
  if (stat.isFile()) {
    if (stat.size > MAX_FILE) throw new Error(`Too large to publish: ${from}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return;
  }
  if (!stat.isDirectory()) return; // links and anything else are not followed
  for (const name of fs.readdirSync(from)) {
    if (NEVER.test(name) || skip(path.join(from, name))) continue;
    copyTree(path.join(from, name), path.join(to, name), skip);
  }
}

function files(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  }).sort();
}

/** The same stamp the Pages build writes: a link to the commit and the build time. */
function buildStamp({ sha, pr, now = new Date() }) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('--sha must be a commit hash');
  if (pr !== undefined && !/^[0-9]{1,6}$/.test(String(pr))) throw new Error('--pr must be a number');
  const when = now.toISOString().slice(0, 16).replace('T', ' ');
  const link = `<a href="${REPO_URL}/commit/${sha}" target="_blank" rel="noopener">v.${sha.slice(0, 7)}</a>`;
  return `${pr !== undefined ? `PR #${pr} &middot; ` : ''}${link} &middot; ${when} UTC`;
}

// No Content-Security-Policy yet: the overlay pages load three.js from a CDN through import
// maps, use inline styles and handlers, and open device and network connections that have not
// been checked page by page in a browser under a policy.
function headersFile(env) {
  const lines = [
    '/*',
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: SAMEORIGIN',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
    // Public files; GitHub Pages sent this on every response, so other origins may rely on it.
    '  Access-Control-Allow-Origin: *',
  ];
  if (env !== 'production') lines.push('  X-Robots-Tag: noindex, nofollow');
  return lines.join('\n') + '\n';
}

function build({ env = 'production', root = REPO, out = path.join(REPO, 'public'), sha, pr } = {}) {
  if (env !== 'production' && env !== 'staging') throw new Error(`Unknown environment: ${env}`);
  const from = (rel) => path.join(root, ...rel.split('/'));
  const generated = new Set(GENERATED.map(from));

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const [src, dest] of PUBLISHED) {
    if (!fs.existsSync(from(src))) throw new Error(`Missing: ${src}`);
    copyTree(from(src), path.join(out, ...dest.split('/')), (p) => generated.has(p));
  }
  for (const t of VENDORED) {
    if (!t.dest.startsWith(OVERLAY_SRC + '/')) throw new Error(`Unexpected vendored path: ${t.dest}`);
    if (!fs.existsSync(from(t.src))) throw new Error(`Missing: ${t.src}`);
    copyTree(from(t.src), path.join(out, 'overlay', ...t.dest.slice(OVERLAY_SRC.length + 1).split('/')));
  }

  if (sha) {
    const stamp = buildStamp({ sha, pr });
    for (const page of STAMPED) {
      const file = path.join(out, ...page.split('/'));
      const before = fs.readFileSync(file, 'utf8');
      const after = before.replace(STAMP_RE, (_, open, close) => open + stamp + close);
      if (after === before) throw new Error(`No build-version placeholder in ${page}`);
      fs.writeFileSync(file, after);
    }
  }

  fs.writeFileSync(path.join(out, '_headers'), headersFile(env));
  const list = files(out);
  return { out, files: list, pages: list.filter((f) => f.endsWith('.html')).length };
}

if (require.main === module) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const r = build({
    env: arg('--env') || 'production',
    root: arg('--root') ? path.resolve(arg('--root')) : undefined,
    out: arg('--out') ? path.resolve(arg('--out')) : undefined,
    sha: arg('--sha'),
    pr: arg('--pr'),
  });
  console.log(`Built ${r.files.length} files (${r.pages} pages) into ${path.relative(REPO, r.out) || r.out}`);
}

module.exports = { build, buildStamp, files };
