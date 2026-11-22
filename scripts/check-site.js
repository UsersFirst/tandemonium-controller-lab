#!/usr/bin/env node
// After a deploy: the pages answer, the headers are there, and unpublished files are not.
//   node scripts/check-site.js https://lab.housetandem.com
//   node scripts/check-site.js <https address> --wait 180   keep trying for up to 180 s
const base = (process.argv[2] || '').replace(/\/$/, '');
const waitArg = process.argv.indexOf('--wait');
const waitS = waitArg > 0 ? Number(process.argv[waitArg + 1]) || 0 : 0;
const OK = ['/', '/overlay/', '/overlay/multi', '/overlay/lobby', '/overlay/js/app.js',
  '/overlay/lib/controller-core/index.js', '/overlay/lib/controller-visualizer/index.js', '/overlay/lib/ui/index.js',
  '/ui/gallery', '/ui/src/index.js', '/ui/src/tokens.css', '/design-system/', '/design-system/inventory.json',
  '/brand/favicon.svg'];
const GONE = ['/package.json', '/README.md', '/wrangler.jsonc', '/CNAME', '/ui/package.json', '/ui/test/uf-element.test.js', '/scripts/build-site.js'];
const HEADERS = ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security', 'access-control-allow-origin'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p) {
  for (let i = 0; ; i++) {
    try { return await fetch(base + p, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
    catch (e) { if (i >= 2) throw e; await sleep(3000); }
  }
}

async function problems() {
  const bad = [];
  try {
    for (const p of OK) { const r = await get(p); if (r.status !== 200) bad.push(`${p}: ${r.status}`); }
    for (const p of GONE) { const r = await get(p); if (r.status !== 404) bad.push(`${p} should be 404: ${r.status}`); }
    const home = await get('/');
    for (const h of HEADERS) if (!home.headers.get(h)) bad.push(`missing header: ${h}`);
  } catch (e) {
    bad.push(`no answer: ${(e.cause && e.cause.code) || e.message}`);
  }
  return bad;
}

(async () => {
  if (!/^https?:\/\//.test(base)) throw new Error('Usage: node scripts/check-site.js <address> [--wait seconds]');
  const deadline = Date.now() + waitS * 1000;
  let bad = await problems();
  while (bad.length && Date.now() < deadline) {
    console.log(`Not ready yet (${bad.length}): ${bad[0]}`);
    await sleep(15000);
    bad = await problems();
  }
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log(`${base}: ${OK.length} paths, ${GONE.length} unpublished paths and ${HEADERS.length} headers OK`);
})().catch((e) => { console.error(e); process.exit(1); });
