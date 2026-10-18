// ============================================================
// static-server.mjs — serve a repo root for headless capture
// ============================================================
//
// Minimal static file server (no deps) plus the request-interception rules
// the game's smoke scripts already use: `three` is served from the target
// repo's node_modules instead of the CDN, and every other off-origin request
// is aborted so a capture never depends on the network (sign-in widgets,
// PeerJS, analytics, fonts).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.txt': 'text/plain', '.md': 'text/markdown', '.pdf': 'application/pdf',
};

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** Serve `root` on 127.0.0.1:port. Resolves to { server, origin, close }. */
export async function serveStatic(root, port, { host = '127.0.0.1', onRequest } = {}) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    if (onRequest && onRequest(req, res) === true) return;
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(root, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      fs.stat(file, (err2, st2) => {
        if (err2 || !st2.isFile()) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': mimeFor(file), 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
      });
    });
  });
  await new Promise((r) => server.listen(port, host, r));
  const origin = `http://${host}:${port}`;
  return { server, origin, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Install request interception on a puppeteer page: same-origin passes,
 * `three` CDN URLs are answered from <threeRoot>/node_modules/three, and
 * everything else is aborted (unless it matches an `allow` regex).
 */
export async function interceptForCapture(page, { origin, threeRoot, allow = [] }) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    if (allow.some((re) => re.test(u))) return req.continue();
    let m = u.match(/three@[^/]+\/build\/three\.module\.js/);
    if (m && threeRoot) {
      const f = path.join(threeRoot, 'node_modules/three/build/three.module.js');
      if (fs.existsSync(f)) return req.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(f) });
    }
    m = u.match(/three@[^/]+\/examples\/jsm\/(.+)$/);
    if (m && threeRoot) {
      const f = path.join(threeRoot, 'node_modules/three/examples/jsm/' + m[1]);
      if (fs.existsSync(f)) return req.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(f) });
    }
    return req.abort();
  });
}

/** IPv4 addresses other devices on the LAN can reach us at. */
export async function lanAddresses() {
  const os = await import('node:os');
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}
