// The demo page in a real browser (headless): node packages/identity/tools/demo-check.mjs [screenshot dir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolvePuppeteer } from '../../../tools/_lib/resolve-puppeteer.mjs';
// Puppeteer comes from the lab's node_modules, or a sibling game checkout (the same
// resolver the UI kit's browser tests use). Optional argument: where to put screenshots.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = process.argv[2] || path.join(os.tmpdir(), 'identity-demo-shots');
const puppeteer = await resolvePuppeteer(root);
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (extra ? '  ' + extra : '')); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => errors.push('failed ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: 1100, height: 1400 });
await page.goto(`http://127.0.0.1:${port}/packages/identity/demo.html`);
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 }).catch(async () => { console.log("NOT READY", errors.join(" | ")); await browser.close(); server.close(); process.exit(1); });

let s = await page.evaluate(() => ({
  code: document.querySelector('uf-device-signin .uf-id-code')?.textContent,
  qr: !!document.querySelector('uf-device-signin uf-qr svg, uf-device-signin uf-qr canvas, uf-device-signin uf-qr'),
  steps: [...document.querySelectorAll('uf-device-signin li')].map((li) => li.textContent.trim().replace(/\s+/g, ' ')),
  open: !!document.querySelector('uf-device-signin button[data-act="open"]'),
  notice: document.querySelector('uf-account-notice .uf-id-text')?.textContent,
  noticeBtns: [...document.querySelectorAll('uf-account-notice button')].map((b) => b.textContent),
  combineTitle: document.querySelector('uf-combine-accounts h2')?.textContent,
  combineCards: [...document.querySelectorAll('uf-combine-accounts .uf-id-acct')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  combineBtns: [...document.querySelectorAll('uf-combine-accounts button')].map((b) => b.textContent),
}));
check(s.code === 'K7QF' && s.qr, 'device sign-in shows the QR and the code', JSON.stringify({ code: s.code, qr: s.qr }));
check(s.steps.length === 3 && /^Type this code on your phone K7QF$/.test(s.steps[2]), 'three steps; the last says to type the code', s.steps[2]);
check(s.open, 'OPEN ON THIS COMPUTER is offered when asked for');
check(/^The Discord account “petegordon” was linked to this account on .+\. Not you\? You can undo it until .+\.$/.test(s.notice || ''), 'the notice names the provider and the undo date', s.notice);
check(s.noticeBtns.join('|') === 'Not me, remove it|OK, that was me', 'undo comes first', s.noticeBtns.join('|'));
check(/This Steam account already has its own House Tandem account/.test(s.combineTitle || ''), 'combine: the title names the provider');
check(s.combineCards.length === 2 && /Old Steam Pete Steam 210 rides · 89 badges in Tandemonium ?Also: Carnival Dozer \(12 badges\), 7, 11, Doubles/.test(s.combineCards[0]), 'combine: both accounts, with the other games', s.combineCards[0]);
check(s.combineBtns.join('|') === 'Cancel|Combine', 'Cancel first, then Combine');
const first = await page.evaluate(() => ({
  signin: [...document.querySelectorAll('uf-signin .uf-id-provider')].map((b) => b.tagName + ':' + b.textContent.trim()),
  rows: [...document.querySelectorAll('uf-profile-card li')].map((li) => li.dataset.provider + ':' + li.dataset.linked + ':' + li.textContent.trim()),
  out: !!document.querySelector('uf-profile-card button[data-act="signout"]'),
}));
check(first.signin.join('|') === 'A:Sign in with Discord|BUTTON:Sign in with Steam', 'sign-in: Discord is its own link, Steam a button', first.signin.join('|'));
check(first.rows.join('|') === 'discord:true:petegordon|steam:false:Link Steam', 'profile: Discord by name, Steam as a Link button', first.rows.join('|'));
check(first.out, 'profile: Sign out is offered when asked for');
await page.screenshot({ path: path.join(outDir, 'identity-desktop.png'), fullPage: true });
await page.click('uf-signin [data-provider="steam"]');
check(await page.evaluate(() => document.getElementById('signin-log').textContent === 'sign in with steam'), 'a sign-in button emits uf-signin with its provider');
await page.click('uf-signin [data-provider="discord"]');
check(await page.evaluate(() => document.getElementById('signin-log').textContent === 'sign in with discord (its own link)'), 'the Discord link says it is direct');
await page.click('uf-profile-card button[data-act="link"]');
await new Promise((r) => setTimeout(r, 50));
check(await page.evaluate(() => document.getElementById('profile-log').textContent === 'link steam' && document.querySelectorAll('uf-profile-card li[data-linked="true"]').length === 2), 'Link Steam emits uf-profile-link; linked, both lines show a name');

// the device flow moves on: confirming, then linked
await page.waitForFunction(() => /Type the code on your phone…/.test(document.querySelector('uf-device-signin .uf-id-status')?.textContent || ''), { timeout: 15000 }).catch(() => {});
check(await page.evaluate(() => /Type the code on your phone…/.test(document.querySelector('uf-device-signin .uf-id-status').textContent)), 'status: "Type the code on your phone…" while they are on the phone');
await page.waitForFunction(() => /^linked:/.test(document.getElementById('device-log').textContent), { timeout: 20000 }).catch(() => {});
check(await page.evaluate(() => document.getElementById('device-log').textContent === 'linked: steam + discord'), 'the link completes: one account with Steam and Discord');

// buttons
await page.click('uf-combine-accounts button[data-act="no"]');
check(await page.evaluate(() => /Cancel: nothing changes/.test(document.getElementById('combine-log').textContent)), 'Cancel emits uf-combine { ok: false }');
await page.click('uf-combine-accounts button[data-act="yes"]');
check(await page.evaluate(() => /chose Combine/.test(document.getElementById('combine-log').textContent)), 'Combine emits uf-combine { ok: true }');
await page.click('uf-account-notice button[data-act="undo"]');
await page.waitForFunction(() => document.getElementById('notice-log').textContent === 'undone', { timeout: 5000 }).catch(() => {});
check(await page.evaluate(() => document.getElementById('notice-log').textContent === 'undone' && document.getElementById('notice').hidden), 'undo asks the server and the notice goes');

// TV and phone layouts: nothing overflows its section
for (const [mode, w, h] of [['tv', 1920, 1080], ['phone', 390, 844]]) {
  await page.setViewport({ width: w, height: h });
  await page.evaluate((m) => { document.querySelector(`.modes button[data-mode="${m}"]`).click(); document.getElementById('notice').hidden = false; }, mode);
  await new Promise((r) => setTimeout(r, 200));
  const over = await page.evaluate(() => [...document.querySelectorAll('section')].filter((sec) => sec.scrollWidth > sec.clientWidth + 1).map((sec) => sec.id));
  check(over.length === 0, `${mode}: nothing overflows`, over.join(','));
  if (mode === 'tv') {
    const px = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('uf-device-signin li')).fontSize));
    check(px >= 22, 'tv: the steps are readable from the couch (' + px + 'px)');
  }
  await page.screenshot({ path: path.join(outDir, `identity-${mode}.png`), fullPage: true });
}
const real = errors.filter((e) => !/favicon/.test(e) && !/status of 404/.test(e));
check(real.length === 0, 'no page errors', real.join(' | ').slice(0, 300));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed · screenshots: ${outDir}`);
process.exit(fail ? 1 : 0);
