#!/usr/bin/env node
// Inject the CI build stamp (commit SHA + UTC build time) into the
// `<span id="build-version">` placeholder of one or more HTML files.
//
// Usage:
//   BUILD_STAMP='<a href="…/commit/…">v.abc1234</a> &middot; 2026-06-12 16:30 UTC' \
//     node scripts/stamp-build-version.js apps/overlay/src/index.html [more.html …]
//
// Run by the "Stamp build version" steps in:
//   • build-desktop.yml — bakes the stamp into the packaged Windows .exe and
//     macOS .app (apps/overlay/src/index.html is the app UI).
//   • deploy-pages.yml  — stamps the web overlay AND the landing page so you
//     can confirm build freshness before downloading.
//
// With no BUILD_STAMP set (e.g. a local build) the file is left at its
// checked-in "dev build" text, so the repo never carries a baked stamp.

const fs = require('fs');

const stamp = process.env.BUILD_STAMP;
if (!stamp) {
  console.error('stamp-build-version: BUILD_STAMP env not set — skipping.');
  process.exit(0);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('stamp-build-version: no target files given.');
  process.exit(1);
}

// Match the placeholder span and replace only its inner content.
const RE = /(<span id="build-version">)[\s\S]*?(<\/span>)/;

let failed = false;
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  // Function replacement so any $-sequences or & in the stamp (e.g. URLs,
  // &middot;) are inserted literally rather than treated as replacement refs.
  const after = before.replace(RE, (_, open, close) => open + stamp + close);
  if (after === before) {
    console.error(`stamp-build-version: <span id="build-version"> not found in ${file}`);
    failed = true;
    continue;
  }
  fs.writeFileSync(file, after);
  console.log(`stamp-build-version: stamped ${file}`);
}

process.exit(failed ? 1 : 0);
