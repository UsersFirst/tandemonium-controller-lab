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
  signin: [...document.querySelectorAll('#signin .uf-id-provider')].map((b) => b.tagName + ':' + b.textContent.trim()),
  rows: [...document.querySelectorAll('#profile li')].map((li) => li.dataset.provider + ':' + li.dataset.linked + ':' + li.textContent.trim()),
  out: !!document.querySelector('#profile button[data-act="signout"]'),
}));
check(first.signin.join('|') === 'A:Sign in with Discord|BUTTON:Sign in with Steam', 'sign-in: Discord is its own link, Steam a button', first.signin.join('|'));
check(first.rows.join('|') === 'discord:true:petegordon|steam:false:Link Steam', 'profile: Discord by name, Steam as a Link button', first.rows.join('|'));
check(first.out, 'profile: Sign out is offered when asked for');
await page.screenshot({ path: path.join(outDir, 'identity-desktop.png'), fullPage: true });
await page.click('#signin [data-provider="steam"]');
check(await page.evaluate(() => document.getElementById('signin-log').textContent === 'sign in with steam'), 'a sign-in button emits uf-signin with its provider');
await page.click('#signin [data-provider="discord"]');
check(await page.evaluate(() => document.getElementById('signin-log').textContent === 'sign in with discord (its own link)'), 'the Discord link says it is direct');
await page.click('#profile button[data-act="link"]');
await new Promise((r) => setTimeout(r, 50));
check(await page.evaluate(() => document.getElementById('profile-log').textContent === 'link steam' && document.querySelectorAll('#profile li[data-linked="true"]').length === 2), 'Link Steam emits uf-profile-link; linked, both lines show a name');

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

// ── lab #152: sizes, updates that keep focus, and reaching the buttons ──
const sizes = await page.evaluate(() => {
  const px = (el, prop) => parseFloat(getComputedStyle(el)[prop]);
  const big = document.querySelector('#signin [data-part="signin-steam"]');
  const small = document.querySelector('#signin-sm [data-part="signin-steam"]');
  const box = document.getElementById('narrow').getBoundingClientRect().width;
  return {
    bigFont: px(big, 'fontSize'), bigMin: px(big, 'minWidth'), bigIcon: big.querySelector('svg').getBoundingClientRect().width,
    smallFont: px(small, 'fontSize'), smallW: small.getBoundingClientRect().width, smallIcon: small.querySelector('svg').getBoundingClientRect().width, box,
    cardFont: px(document.querySelector('#profile li'), 'fontSize'), cardPic: document.querySelector('#profile .uf-id-login-pic').getBoundingClientRect().width,
    smCardFont: px(document.querySelector('#profile-sm li'), 'fontSize'), smCardPic: document.querySelector('#profile-sm .uf-id-login-pic').getBoundingClientRect().width,
    smUl: document.querySelector('#profile-sm ul').getBoundingClientRect().width,
    outColor: getComputedStyle(document.querySelector('#profile-sm [data-part="signout"]')).color,
    outColorPlain: getComputedStyle(document.querySelector('#profile [data-part="signout"]')).color,
  };
});
// (the default follows the host's --uf-size-md token; at 16px that is the old 248px buttons, 22px marks, 44px pictures)
const f = sizes.bigFont;
check(f >= 16 && f < 18 && Math.abs(sizes.bigMin - 15.5 * f) < 0.5 && Math.abs(sizes.bigIcon - 1.375 * f) < 0.5 && sizes.cardFont === f && Math.abs(sizes.cardPic - 2.75 * f) < 0.5,
  'default size: the medium token, with buttons 15.5em wide, marks 1.375em, pictures 2.75em', JSON.stringify(sizes));
check(sizes.smallFont === 13 && Math.abs(sizes.smallIcon - 13 * 1.375) < 0.5 && sizes.smCardFont === 13 && Math.abs(sizes.smCardPic - 13 * 2.75) < 0.5,
  'size="sm": text, marks and pictures all scale together', JSON.stringify(sizes));
check(Math.abs(sizes.smallW - sizes.box) < 1 && Math.abs(sizes.smUl - sizes.box) < 1, 'block: buttons and lines fill the box', sizes.smallW + ' / ' + sizes.smUl + ' of ' + sizes.box);
check(sizes.outColor !== sizes.outColorPlain, 'signout="danger" colours Sign out', sizes.outColor);
const anySize = await page.evaluate(() => {
  const el = document.getElementById('signin-sm');
  el.style.fontSize = '30px';
  const b = el.querySelector('[data-part="signin-steam"]');
  const r = { font: parseFloat(getComputedStyle(b).fontSize), icon: b.querySelector('svg').getBoundingClientRect().width };
  el.style.fontSize = '';
  return r;
});
check(anySize.font === 30 && Math.abs(anySize.icon - 30 * 1.375) < 0.5, 'any other size: one font-size on the element', JSON.stringify(anySize));

const reach = await page.evaluate(() => {
  const s = document.getElementById('signin-sm'), c = document.getElementById('profile-sm');
  return {
    signin: s.buttons().map((b) => b.dataset.part), steam: s.button('steam') === s.querySelector('[data-provider="steam"]'), none: s.button('google'),
    card: c.buttons().map((b) => b.dataset.part), link: c.button('link', 'steam')?.textContent, out: c.button('signout')?.textContent, linkNone: c.button('link', 'discord'),
    parts: ['login-discord', 'login-steam', 'pic-discord'].map((n) => !!c.named(n)),
  };
});
check(reach.signin.join('|') === 'signin-steam|signin-discord' && reach.steam && reach.none === null, 'uf-signin: buttons() in order, button(provider)', JSON.stringify(reach.signin));
check(reach.card.join('|') === 'link-steam|signout' && reach.link === 'Link Steam' && reach.out === 'Sign out' && reach.linkNone === null && reach.parts.every(Boolean),
  'uf-profile-card: buttons() in order, button("link", p), button("signout"), named parts', JSON.stringify(reach));

// focus and the classes a host adds survive every property set
const keep = await page.evaluate(async () => {
  const c = document.getElementById('profile-sm');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const link = c.button('link', 'steam'), out = c.button('signout'), pic = c.named('pic-discord');
  link.focus(); link.classList.add('host-focus');
  const here = () => document.activeElement === link && c.button('link', 'steam') === link && link.classList.contains('host-focus');
  const r = {};
  c.busy = 'steam'; await tick();
  r.busy = here() && link.getAttribute('aria-disabled') === 'true' && link.getAttribute('aria-busy') === 'true' && !link.disabled;
  let emitted = 0; const on = () => emitted++; c.addEventListener('uf-profile-link', on);
  link.click(); r.busyClickIgnored = emitted === 0;
  c.error = 'Steam is not answering'; await tick();
  r.error = here() && c.named('error')?.textContent === 'Steam is not answering' && !link.hasAttribute('aria-disabled') && c.button('signout') === out;
  c.note = 'A note under the logins.'; await tick();
  r.note = here() && c.named('note')?.textContent === 'A note under the logins.' && c.button('signout') === out;
  c.error = ''; c.note = ''; await tick();
  r.cleared = here() && !c.named('error') && !c.named('note') && c.button('signout') === out;
  // the host swaps a picture for a cached copy; the same user again must not undo that
  const cached = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  pic.src = cached;
  c.user = { ...c.user }; await tick();
  r.picKept = c.named('pic-discord') === pic && pic.src === cached && here();
  c.user = { ...c.user, identities: { discord: { name: 'pete2', avatar: 'https://cdn.discordapp.com/embed/avatars/1.png' } } }; await tick();
  r.picChanged = c.named('pic-discord') === pic && pic.src.endsWith('/1.png') && c.querySelector('.uf-id-login-name').textContent === 'pete2' && here();
  // renderNow(): no waiting
  c.busy = 'steam'; c.renderNow();
  r.now = link.getAttribute('aria-disabled') === 'true'; c.busy = ''; c.renderNow();
  // Sign out keeps its focus when the Link button above it goes (Steam gets linked)
  out.focus();
  c.user = { ...c.user, identities: { ...c.user.identities, steam: { name: 'pete_steam', avatar: null } } }; await tick();
  r.linked = !c.button('link', 'steam') && c.button('signout') === out && document.activeElement === out && c.querySelectorAll('li[data-linked="true"]').length === 2;
  c.removeEventListener('uf-profile-link', on);
  return r;
});
check(Object.values(keep).every(Boolean), 'uf-profile-card: busy, error, note and user keep the same nodes, the focus and the host class', JSON.stringify(keep));

const keep2 = await page.evaluate(async () => {
  const s = document.getElementById('signin-sm');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const steam = s.button('steam'), discord = s.button('discord');
  steam.focus(); steam.classList.add('host-focus');
  const here = () => document.activeElement === steam && s.button('steam') === steam && steam.classList.contains('host-focus') && s.button('discord') === discord;
  const r = {};
  s.busy = 'steam'; await tick();
  r.busy = here() && steam.getAttribute('aria-busy') === 'true' && discord.getAttribute('aria-disabled') === 'true';
  s.error = 'Steam sign-in is unavailable right now'; await tick();
  r.error = here() && s.named('error')?.textContent === 'Steam sign-in is unavailable right now' && !steam.hasAttribute('aria-busy');
  s.error = ''; await tick();
  r.cleared = here() && !s.named('error');
  // a prepared link turns Discord's button into a link (a different tag: that one is replaced); Steam stays
  s.links = { discord: 'https://discord.com/oauth2/authorize?client_id=demo' }; await tick();
  r.links = document.activeElement === steam && s.button('steam') === steam && s.button('discord').tagName === 'A';
  s.links = {}; await tick();
  r.back = document.activeElement === steam && s.button('discord').tagName === 'BUTTON';
  return r;
});
check(Object.values(keep2).every(Boolean), 'uf-signin: busy, error and links keep the focused button', JSON.stringify(keep2));

// the other elements share the base: an error on the notice keeps its focused button
const keep3 = await page.evaluate(async () => {
  const n = document.getElementById('notice');
  const wasHidden = n.hidden; n.hidden = false;
  if (!n.named('undo')) { n.hidden = wasHidden; return { skipped: true, ok: false }; }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const undo = n.named('undo');
  undo.focus();
  n.error = 'Could not undo that'; await tick();
  const ok = document.activeElement === undo && n.named('undo') === undo && /Could not undo that/.test(n.textContent);
  n.error = ''; await tick();
  const after = document.activeElement === undo;
  n.hidden = wasHidden;
  return { ok: ok && after };
});
check(keep3.ok, 'uf-account-notice: an error keeps the focused button' + (keep3.skipped ? ' (the notice has no undo button)' : ''));

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
