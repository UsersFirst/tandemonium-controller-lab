#!/usr/bin/env node
// ============================================================
// ui-audit.mjs — inventory the UI surface of one or more repos
// ============================================================
//
// Phase 0 of docs/UI-DESIGN-SYSTEM-PLAN.md. Before deciding tokens or
// components, measure what is actually there: every colour, font size,
// radius, spacing value, CSS custom property, button-ish class, screen /
// overlay id, imperative show/hide site and innerHTML template. The output
// is the evidence the design-system decisions are made against — and the
// number that should fall release over release.
//
//   node tools/ui-audit/ui-audit.mjs                 # both default targets
//   node tools/ui-audit/ui-audit.mjs --target game   # one target
//   node tools/ui-audit/ui-audit.mjs --json          # also print JSON to stdout
//   node tools/ui-audit/ui-audit.mjs --root game=../tandemonium-ui   # audit a worktree instead
//
// Writes design/audit/<target>.md + .json and design/audit/README.md.
// Targets are declared in tools/ui-audit/targets.json (paths relative to the
// lab root; sibling checkouts by default).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(HERE, '..', '..');
const OUT = path.join(LAB, 'design', 'audit');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

const targets = JSON.parse(fs.readFileSync(path.join(HERE, 'targets.json'), 'utf8'));
const only = opt('target');
// --root <target>=<path> audits another checkout of a target (e.g. a worktree with a branch under review).
for (let i = 0; i < args.length; i++) if (args[i] === '--root') { const [t, r] = String(args[i + 1] || '').split('='); if (targets[t] && r) targets[t].root = r; }

// ── tiny glob: supports **, *, and {a,b} ──
function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '{') {
      const j = g.indexOf('}', i);
      re += '(' + g.slice(i + 1, j).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = j;
    } else if ('.+^$()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'out' || e.name === '_site' || e.name === 'lib') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}
function expand(root, globs) {
  const all = walk(root).map((p) => path.relative(root, p).split(path.sep).join('/'));
  const res = globs.map(globToRegex);
  return all.filter((p) => res.some((re) => re.test(p))).sort();
}

// ── counters ──
const tally = (iter) => {
  const m = new Map();
  for (const v of iter) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1] ?? m[0]);

function auditCSS(css) {
  const colours = all(/(#[0-9a-fA-F]{3,8})\b/g, css).map((c) => c.toLowerCase());
  const rgba = all(/(rgba?\([^)]*\))/g, css).map((c) => c.replace(/\s+/g, ''));
  const hsl = all(/(hsla?\([^)]*\))/g, css);
  const fontSizes = all(/font-size:\s*([0-9.]+(?:px|rem|em|vw|vh|vmin|vmax|%))/g, css);
  const fontFamilies = all(/font-family:\s*([^;}]+)/g, css).map((s) => s.trim());
  const radii = all(/border-radius:\s*([^;}]+)/g, css).map((s) => s.trim());
  const spacing = all(/(?:padding|margin|gap|row-gap|column-gap)[a-z-]*:\s*([^;}]+)/g, css).map((s) => s.trim());
  const zIndex = all(/z-index:\s*(-?\d+)/g, css);
  const varsDefined = all(/(--[a-zA-Z0-9_-]+)\s*:/g, css);
  const varsUsed = all(/var\(\s*(--[a-zA-Z0-9_-]+)/g, css);
  const media = all(/@media([^{]+)\{/g, css).map((s) => s.trim());
  const important = (css.match(/!important/g) || []).length;
  const classSelectors = all(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g, css);
  const componentish = classSelectors.filter((c) => /btn|button|card|step|overlay|popup|modal|sheet|hud|chip|badge|toggle|slider|seat|row|panel|hint|prompt|cta/i.test(c));
  const animations = all(/@keyframes\s+([a-zA-Z0-9_-]+)/g, css);
  return {
    lines: css.split('\n').length,
    colours: tally(colours), rgba: tally(rgba), hsl: tally(hsl),
    fontSizes: tally(fontSizes), fontFamilies: tally(fontFamilies), radii: tally(radii),
    spacing: tally(spacing), zIndex: tally(zIndex),
    varsDefined: tally(varsDefined), varsUsed: tally(varsUsed),
    media: tally(media), important, animations: tally(animations),
    classSelectors: new Set(classSelectors).size, componentish: tally(componentish),
  };
}

function auditHTML(html) {
  const styles = all(/<style[^>]*>([\s\S]*?)<\/style>/g, html);
  const body = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  const ids = all(/\sid="([^"]+)"/g, body);
  const screens = ids.filter((id) => /overlay|popup|modal|sheet|step|screen|panel|garage|results|complete|lobby$/i.test(id));
  const buttons = (body.match(/<button\b/g) || []).length;
  const inlineStyle = (body.match(/\sstyle="/g) || []).length;
  const customTags = tally(all(/<([a-z]+-[a-z0-9-]+)[\s>]/g, body));
  const templates = (body.match(/<template\b/g) || []).length;
  return { lines: html.split('\n').length, styleBlocks: styles.length, css: auditCSS(styles.join('\n')), ids: ids.length, screens, buttons, inlineStyle, customTags, templates };
}

function auditJS(js) {
  return {
    lines: js.split('\n').length,
    getById: new Set(all(/getElementById\(\s*['"]([^'"]+)['"]/g, js)).size,
    querySelector: (js.match(/querySelector(All)?\(/g) || []).length,
    innerHTML: (js.match(/\.innerHTML\s*[+]?=/g) || []).length,
    createElement: (js.match(/createElement\(/g) || []).length,
    showHide: (js.match(/\.style\.display\s*=/g) || []).length,
    classToggle: (js.match(/classList\.(add|remove|toggle)\(\s*['"](visible|show|hidden|active|sel|open)['"]/g) || []).length,
    customElements: (js.match(/customElements\.define\(/g) || []).length,
    tsCheck: /@ts-check/.test(js),
    jsdocTypes: (js.match(/@(typedef|param|returns?|type)\b/g) || []).length,
  };
}

function section(title, rows, limit = 20) {
  if (!rows.length) return `### ${title}\n\n_none_\n`;
  const shown = rows.slice(0, limit);
  return `### ${title} (${rows.length} distinct)\n\n| value | uses |\n|---|---:|\n` +
    shown.map(([v, n]) => `| \`${String(v).replace(/\|/g, '\\|')}\` | ${n} |`).join('\n') +
    (rows.length > limit ? `\n| … ${rows.length - limit} more | |` : '') + '\n';
}

function runTarget(name, t) {
  const root = path.resolve(LAB, t.root);
  if (!fs.existsSync(root)) { console.warn(`[ui-audit] skip ${name}: ${root} not found`); return null; }
  const htmlFiles = expand(root, t.html || []);
  const jsFiles = expand(root, t.js || []);
  const html = Object.fromEntries(htmlFiles.map((f) => [f, auditHTML(fs.readFileSync(path.join(root, f), 'utf8'))]));
  const js = Object.fromEntries(jsFiles.map((f) => [f, auditJS(fs.readFileSync(path.join(root, f), 'utf8'))]));
  const cssAll = auditCSS(htmlFiles.map((f) => all(/<style[^>]*>([\s\S]*?)<\/style>/g, fs.readFileSync(path.join(root, f), 'utf8')).join('\n')).join('\n'));
  const sum = (k) => Object.values(js).reduce((a, j) => a + (j[k] || 0), 0);
  const totals = {
    htmlFiles: htmlFiles.length, jsFiles: jsFiles.length,
    cssLines: cssAll.lines, distinctColours: cssAll.colours.length + cssAll.rgba.length + cssAll.hsl.length,
    hexColours: cssAll.colours.length, fontSizes: cssAll.fontSizes.length, radii: cssAll.radii.length,
    varsDefined: cssAll.varsDefined.length, important: cssAll.important,
    screens: Object.values(html).reduce((a, h) => a + h.screens.length, 0),
    buttons: Object.values(html).reduce((a, h) => a + h.buttons, 0),
    inlineStyle: Object.values(html).reduce((a, h) => a + h.inlineStyle, 0),
    customTags: Object.values(html).reduce((a, h) => a + h.customTags.length, 0),
    innerHTML: sum('innerHTML'), showHide: sum('showHide'), classToggle: sum('classToggle'),
    customElements: sum('customElements'), tsCheckFiles: Object.values(js).filter((j) => j.tsCheck).length,
    getById: sum('getById'),
  };
  return { name, root, generated: new Date().toISOString(), totals, css: cssAll, html, js };
}

function renderMarkdown(r) {
  const t = r.totals;
  let md = `# UI audit — ${r.name}\n\n_Generated ${r.generated} from \`${r.root}\`_\n\n`;
  md += `## Totals\n\n| metric | value |\n|---|---:|\n`;
  for (const [k, v] of Object.entries(t)) md += `| ${k} | ${v} |\n`;
  md += `\n## Files\n\n| file | lines | style blocks | css lines | screens/overlays | buttons | inline style= | custom tags |\n|---|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const [f, h] of Object.entries(r.html)) md += `| ${f} | ${h.lines} | ${h.styleBlocks} | ${h.css.lines} | ${h.screens.length} | ${h.buttons} | ${h.inlineStyle} | ${h.customTags.length} |\n`;
  md += `\n| js file | lines | getElementById ids | innerHTML= | createElement | style.display= | class toggles | custom elements | @ts-check | jsdoc tags |\n|---|---:|---:|---:|---:|---:|---:|---:|:---:|---:|\n`;
  for (const [f, j] of Object.entries(r.js)) md += `| ${f} | ${j.lines} | ${j.getById} | ${j.innerHTML} | ${j.createElement} | ${j.showHide} | ${j.classToggle} | ${j.customElements} | ${j.tsCheck ? '✓' : ''} | ${j.jsdocTypes} |\n`;
  md += `\n## Screens / overlays by id\n\n`;
  for (const [f, h] of Object.entries(r.html)) if (h.screens.length) md += `- **${f}**: ${h.screens.map((s) => `\`#${s}\``).join(', ')}\n`;
  md += `\n## Style tokens in the wild\n\n`;
  md += section('Hex colours', r.css.colours, 30);
  md += section('rgba() colours', r.css.rgba, 15);
  md += section('Font sizes', r.css.fontSizes, 30);
  md += section('Font families', r.css.fontFamilies);
  md += section('Border radii', r.css.radii, 15);
  md += section('Spacing values (padding/margin/gap)', r.css.spacing, 25);
  md += section('z-index', r.css.zIndex, 15);
  md += section('CSS custom properties defined', r.css.varsDefined);
  md += section('CSS custom properties used', r.css.varsUsed);
  md += section('Media queries', r.css.media);
  md += section('Component-ish class selectors', r.css.componentish, 60);
  md += section('Keyframes', r.css.animations);
  return md;
}

fs.mkdirSync(OUT, { recursive: true });
const results = [];
for (const [name, t] of Object.entries(targets)) {
  if (only && only !== name) continue;
  const r = runTarget(name, t);
  if (!r) continue;
  results.push(r);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(OUT, `${name}.md`), renderMarkdown(r));
  console.log(`[ui-audit] ${name}: ${r.totals.hexColours} hex colours, ${r.totals.fontSizes} font sizes, ${r.totals.varsDefined} css vars, ${r.totals.screens} screens, ${r.totals.showHide} style.display sites, ${r.totals.customElements} custom elements`);
}

// Cross-target summary: what is shared vs. divergent between the game and the lab.
if (results.length) {
  const keys = ['htmlFiles', 'jsFiles', 'cssLines', 'hexColours', 'fontSizes', 'radii', 'varsDefined', 'important', 'screens', 'buttons', 'inlineStyle', 'innerHTML', 'showHide', 'classToggle', 'customElements', 'tsCheckFiles'];
  let md = `# UI audit summary\n\n_Generated ${new Date().toISOString()}. Re-run with \`npm run ui:audit\`. Per-target detail: ${results.map((r) => `[${r.name}](${r.name}.md)`).join(', ')}_\n\n`;
  md += `| metric | ${results.map((r) => r.name).join(' | ')} |\n|---|${results.map(() => '---:').join('|')}|\n`;
  for (const k of keys) md += `| ${k} | ${results.map((r) => r.totals[k]).join(' | ')} |\n`;
  if (results.length > 1) {
    const sets = results.map((r) => new Set(r.css.colours.map(([c]) => c)));
    const shared = [...sets[0]].filter((c) => sets.slice(1).every((s) => s.has(c)));
    md += `\n## Colours shared by every target (${shared.length})\n\n${shared.map((c) => `\`${c}\``).join(' ') || '_none_'}\n`;
    const fam = results.map((r) => r.css.fontFamilies.slice(0, 3).map(([f]) => `\`${f}\``).join(', '));
    md += `\n## Dominant font stacks\n\n${results.map((r, i) => `- **${r.name}**: ${fam[i]}`).join('\n')}\n`;
  }
  md += `\n## How to read this\n\n- **hexColours / fontSizes / radii** — distinct literal values. A design system with tokens should drive each toward ≤ 12 / ≤ 8 / ≤ 5.\n- **varsDefined** — CSS custom properties. Tokens live here; this number should grow as the literals shrink.\n- **showHide / classToggle / innerHTML** — imperative DOM sites. Each one is a place a screen's state lives in JS rather than in a component. Should fall as screens become elements.\n- **customElements / tsCheckFiles** — adoption of the typed Web Component pattern (packages/ui). Should rise.\n`;
  fs.writeFileSync(path.join(OUT, 'README.md'), md);
  if (flag('json')) console.log(JSON.stringify(results.map((r) => ({ name: r.name, totals: r.totals })), null, 2));
  console.log(`[ui-audit] wrote ${path.relative(LAB, OUT)}/README.md`);
}
