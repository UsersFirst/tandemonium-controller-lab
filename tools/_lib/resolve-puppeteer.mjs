// ============================================================
// resolve-puppeteer.mjs — find a puppeteer install without adding one here
// ============================================================
//
// The lab keeps its dependency list tiny. Puppeteer (plus its Chromium
// download) already lives in the sibling game checkout, so the UI tools
// borrow it instead of installing a second copy. Resolution order:
//   1. `puppeteer` resolvable from this repo (if someone did install it)
//   2. $PUPPETEER_DIR — explicit path to a node_modules/puppeteer directory
//   3. sibling checkouts: ../tandemonium, ../tandemonium-lab
// Throws a readable error listing what was tried.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

export async function resolvePuppeteer(labRoot) {
  const tried = [];
  try {
    tried.push('puppeteer (from lab node_modules)');
    return (await import('puppeteer')).default;
  } catch (_) { /* fall through */ }

  const candidates = [];
  if (process.env.PUPPETEER_DIR) candidates.push(process.env.PUPPETEER_DIR);
  for (const sib of ['tandemonium', 'tandemonium-lab', 'tandemonium-studio']) {
    candidates.push(path.join(labRoot, '..', sib, 'node_modules', 'puppeteer'));
  }
  for (const dir of candidates) {
    tried.push(dir);
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(pkg)) continue;
    const entry = require(pkg).main || 'lib/cjs/puppeteer/puppeteer.js';
    const mod = await import(pathToFileURL(path.join(dir, entry)).href);
    return mod.default || mod;
  }
  throw new Error(
    'puppeteer not found. Tried:\n  ' + tried.join('\n  ') +
    '\nInstall it in a sibling repo (the game already has it) or set PUPPETEER_DIR.'
  );
}
