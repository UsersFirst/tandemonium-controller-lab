#!/usr/bin/env node
// ============================================================
// ui-inventory.mjs — inventory the design system itself
// ============================================================
//
// ui-audit measures what is in the wild (literal colours, ad-hoc buttons).
// This reads the SYSTEM: every token in packages/ui/src/tokens.css, every
// uf-* element with its typed props / events / methods / tokens used /
// gallery states, and where each one is used across the lab and the game.
// It also lists what is still outside the system in each repo (raw
// <button>s, literal font stacks, literal colours) so adoption is one table.
//
//   node tools/ui-inventory/ui-inventory.mjs                         # default targets
//   node tools/ui-inventory/ui-inventory.mjs --root game=../tandemonium-ui
//
// Writes design/inventory/index.html (self-contained report; swatches render
// the real token values), inventory.json and README.md. Targets come from
// tools/ui-audit/targets.json so both tools agree on what "the game" is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(HERE, '..', '..');
const UI = path.join(LAB, 'packages', 'ui');
const OUT = path.join(LAB, 'design', 'inventory');
const args = process.argv.slice(2);
const targets = JSON.parse(fs.readFileSync(path.join(LAB, 'tools', 'ui-audit', 'targets.json'), 'utf8'));
for (let i = 0; i < args.length; i++) if (args[i] === '--root') { const [t, r] = String(args[i + 1] || '').split('='); if (targets[t] && r) targets[t].root = r; }

const read = (p) => fs.readFileSync(p, 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

// ── files ──
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'out', '_site', 'lib', 'backup-game', 'shared'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}
function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; } else re += '[^/]*'; }
    else if (c === '{') { const j = g.indexOf('}', i); re += '(' + g.slice(i + 1, j).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = j; }
    else if ('.+^$()|[]\\'.includes(c)) re += '\\' + c; else re += c;
  }
  return new RegExp('^' + re + '$');
}
function expand(root, globs) {
  const all = walk(root).map((p) => path.relative(root, p).split(path.sep).join('/'));
  const res = globs.map(globToRegex);
  return all.filter((p) => res.some((re) => re.test(p))).sort();
}

// ── tokens ──
function parseTokens(css) {
  const tokens = [];
  const overrides = [];
  // :root blocks, in order; the first is the base, later ones (inside @media) are overrides.
  const blockRe = /(@media[^{]*\{\s*)?:root\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(css))) {
    const media = m[1] ? m[1].replace(/\{\s*$/, '').trim() : null;
    for (const line of m[2].split('\n')) {
      const d = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?/i);
      if (!d) continue;
      const [, name, value, note] = d;
      const group = name.replace(/^--uf-/, '').split('-')[0];
      if (media) overrides.push({ name, value: value.trim(), media });
      else tokens.push({ name, value: value.trim(), note: note || '', group });
    }
  }
  // Section comments inside the base block become sub-groups ("colour · surfaces").
  const base = css.match(/:root\s*\{([^}]*)\}/)[1];
  let section = '';
  const sectionOf = {};
  for (const line of base.split('\n')) {
    const s = line.match(/^\s*\/\*\s*(.*?)\s*\*\/\s*$/);
    if (s) { section = s[1]; continue; }
    const d = line.match(/^\s*(--[a-z0-9-]+)\s*:/i);
    if (d) sectionOf[d[1]] = section;
  }
  for (const t of tokens) t.section = sectionOf[t.name] || t.group;
  return { tokens, overrides };
}

// ── elements ──
function parseElement(file) {
  const src = read(file);
  const tag = (src.match(/static tag = '([^']+)'/) || [])[1] || path.basename(file, '.js');
  const className = (src.match(/export class (\w+)/) || [])[1] || '';
  const desc = (src.match(/^\/\/ <[^>]+> — (.*)$/m) || [])[1] || '';
  const propsBlock = (src.match(/static props = \{([\s\S]*?)\n  \};/) || [])[1] || '';
  const props = [];
  for (const line of propsBlock.split('\n')) {
    let p;
    if ((p = line.match(/^\s*(\w+):\s*prop\.enum\(\/\*\* @type \{const\} \*\/ \(\[([^\]]*)\]\),\s*'([^']*)'/))) {
      props.push({ name: p[1], attribute: kebab(p[1]), type: 'enum', values: p[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean), default: p[3] });
    } else if ((p = line.match(/^\s*(\w+):\s*prop\.(string|number|boolean)\(([^)]*)\)/))) {
      let def = p[3].split(',')[0].trim().replace(/^'|'$/g, '');
      props.push({ name: p[1], attribute: kebab(p[1]), type: p[2], default: def === '' ? (p[2] === 'string' ? '""' : '') : def });
    }
  }
  const styles = (src.match(/static styles = `([\s\S]*?)`;/) || [])[1] || '';
  const tokensUsed = [...new Set([...styles.matchAll(/var\((--uf-[a-z0-9-]+)/g)].map((m) => m[1]))].sort();
  const literalColours = [...new Set([...styles.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map((m) => m[0]))];
  const events = [...new Set([...src.matchAll(/emit\('([^']+)'/g)].map((m) => m[1]))];
  const lifecycle = new Set(['constructor', 'render', 'update', 'afterRender', 'onConnect', 'onDisconnect', 'get', 'set', 'emit', 'requestUpdate', 'attributeChangedCallback', 'connectedCallback', 'disconnectedCallback']);
  const methods = [...new Set([...src.matchAll(/^  (?:async )?([a-z]\w*)\(([^)]*)\)\s*\{/gm).map((m) => m[1] + '(' + m[2].replace(/\s+/g, ' ') + ')')])].filter((s) => !lifecycle.has(s.split('(')[0]) && !/^(get|set) /.test(s));
  const dataAttrs = [...new Set([...src.matchAll(/\[data-([a-z-]+)\]/g)].map((m) => 'data-' + m[1]))];
  const ownsDom = /render\(\)\s*\{[^}]*return\s+(?!null)/.test(src) && !/render\(\) \{ return null; \}/.test(src);
  return { tag, className, file: path.relative(LAB, file).split(path.sep).join('/'), desc, props, events, methods, dataAttrs, tokensUsed, literalColours, styleLines: styles.trim().split('\n').length, ownsDom, lines: src.split('\n').length };
}

// ── usage ──
function usage(elements, name, t) {
  const root = path.resolve(LAB, t.root);
  if (!fs.existsSync(root)) return null;
  const html = expand(root, t.html || []);
  const js = expand(root, t.js || []);
  const per = {};
  for (const el of elements) per[el.tag] = { html: 0, js: 0, files: new Set() };
  const htmlText = {}, jsText = {};
  for (const f of html) htmlText[f] = read(path.join(root, f));
  for (const f of js) jsText[f] = read(path.join(root, f));
  for (const el of elements) {
    const re = new RegExp('<' + el.tag + '(?![a-z-])', 'g');
    for (const [f, s] of Object.entries(htmlText)) { const n = (s.match(re) || []).length; if (n) { per[el.tag].html += n; per[el.tag].files.add(f); } }
    const reJs = new RegExp("(['\"`<])" + el.tag + '(?![a-z-])', 'g');
    for (const [f, s] of Object.entries(jsText)) { const n = (s.match(reJs) || []).length; if (n) { per[el.tag].js += n; per[el.tag].files.add(f); } }
  }
  for (const k of Object.keys(per)) per[k].files = [...per[k].files];
  // Still outside the system
  const bodies = Object.values(htmlText).map((s) => s.replace(/<script[\s\S]*?<\/script>/g, ''));
  const styles = Object.values(htmlText).map((s) => [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')).join('\n');
  const rawButtons = bodies.reduce((a, s) => a + (s.match(/<button\b/g) || []).length, 0);
  const rawButtonsJs = Object.values(jsText).reduce((a, s) => a + (s.match(/createElement\('button'\)|el\('button'/g) || []).length, 0);
  const fontsLiteral = [...new Set([...styles.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/var\(--uf-font/.test(v) && v !== 'inherit'))];
  const hex = [...styles.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
  const tokenRefs = (styles.match(/var\(--uf-/g) || []).length;
  const tokensLinked = Object.values(htmlText).some((s) => /tokens\.css/.test(s));
  const kitLoaded = Object.values(htmlText).some((s) => /ui\/index\.js|@usersfirst\/ui/.test(s)) || Object.values(jsText).some((s) => /@usersfirst\/ui/.test(s));
  return { root, htmlFiles: html.length, jsFiles: js.length, per, rawButtons, rawButtonsJs, fontsLiteral, hexDistinct: new Set(hex).size, hexTotal: hex.length, tokenRefs, tokensLinked, kitLoaded };
}

// ── gallery states ──
function galleryStates(tag) {
  const g = read(path.join(UI, 'gallery.html'));
  const sec = g.match(new RegExp('<section id="' + tag + '">([\\s\\S]*?)</section>'));
  if (!sec) return 0;
  return (sec[1].match(/<small>/g) || []).length || (sec[1].match(new RegExp('<' + tag + '\\b', 'g')) || []).length;
}

// ── build ──
const tokensCss = read(path.join(UI, 'src', 'tokens.css'));
const { tokens, overrides } = parseTokens(tokensCss);
const elements = fs.readdirSync(path.join(UI, 'src', 'elements')).filter((f) => f.endsWith('.js')).sort().map((f) => parseElement(path.join(UI, 'src', 'elements', f)));
for (const el of elements) el.galleryStates = galleryStates(el.tag);
const pkg = JSON.parse(read(path.join(UI, 'package.json')));
const use = {};
for (const [name, t] of Object.entries(targets)) { const u = usage(elements, name, t); if (u) use[name] = u; }
const tokenUseCount = {};
for (const t of tokens) tokenUseCount[t.name] = elements.reduce((a, el) => a + (el.tokensUsed.includes(t.name) ? 1 : 0), 0);
const unusedTokens = tokens.filter((t) => !tokenUseCount[t.name]).map((t) => t.name);
const inv = { package: pkg.name, version: pkg.version, generated: new Date().toISOString(), tokens, overrides, elements, usage: use, unusedTokens };

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(inv, null, 2));

// ── markdown ──
const tnames = Object.keys(use);
let md = `# Design system inventory — ${pkg.name} ${pkg.version}\n\n_Generated ${inv.generated}. Re-run: \`npm run ui:inventory\`. Report page: [index.html](index.html)._\n\n`;
md += `## Tokens (${tokens.length})\n\n`;
const sections = [...new Set(tokens.map((t) => t.section))];
for (const s of sections) {
  md += `### ${s}\n\n| token | value | used by elements | note |\n|---|---|---:|---|\n`;
  for (const t of tokens.filter((t) => t.section === s)) md += `| \`${t.name}\` | \`${t.value}\` | ${tokenUseCount[t.name]} | ${t.note} |\n`;
  md += '\n';
}
if (overrides.length) { md += `### Overrides\n\n| token | value | when |\n|---|---|---|\n`; for (const o of overrides) md += `| \`${o.name}\` | \`${o.value}\` | \`${o.media}\` |\n`; md += '\n'; }
md += `## Controls (${elements.length})\n\n`;
for (const el of elements) {
  md += `### \`<${el.tag}>\` — ${el.desc}\n\n_${el.className} · ${el.file} · ${el.lines} lines · ${el.ownsDom ? 'owns its DOM' : 'keeps authored children'} · ${el.galleryStates} gallery states_\n\n`;
  md += `| prop | attribute | type | default |\n|---|---|---|---|\n`;
  for (const p of el.props) md += `| \`${p.name}\` | \`${p.attribute}\` | ${p.type === 'enum' ? p.values.map((v) => `\`${v}\``).join(' \\| ') : p.type} | \`${p.default}\` |\n`;
  md += `\n- events: ${el.events.map((e) => `\`${e}\``).join(', ') || '—'}\n- methods: ${el.methods.map((m) => `\`${m}\``).join(', ') || '—'}\n- data attributes: ${el.dataAttrs.map((d) => `\`${d}\``).join(', ') || '—'}\n- tokens used: ${el.tokensUsed.length} · literal colours in styles: ${el.literalColours.length ? el.literalColours.map((c) => `\`${c}\``).join(', ') : 'none'}\n`;
  md += `- usage: ${tnames.map((n) => `${n} ${use[n].per[el.tag].html} in HTML + ${use[n].per[el.tag].js} in JS`).join(' · ')}\n\n`;
}
md += `## Adoption\n\n| | ${tnames.join(' | ')} |\n|---|${tnames.map(() => '---').join('|')}|\n`;
const row = (k, f) => { md += `| ${k} | ${tnames.map((n) => f(use[n])).join(' | ')} |\n`; };
row('tokens.css linked', (u) => u.tokensLinked ? '✓' : '✗');
row('kit loaded', (u) => u.kitLoaded ? '✓' : '✗');
row('uf-* elements in HTML', (u) => Object.values(u.per).reduce((a, p) => a + p.html, 0));
row('uf-* created in JS', (u) => Object.values(u.per).reduce((a, p) => a + p.js, 0));
row('raw <button> in HTML', (u) => u.rawButtons);
row('raw buttons created in JS', (u) => u.rawButtonsJs);
row('var(--uf-*) references in page CSS', (u) => u.tokenRefs);
row('literal hex colours in page CSS (distinct / total)', (u) => `${u.hexDistinct} / ${u.hexTotal}`);
row('literal font stacks in page CSS', (u) => u.fontsLiteral.length ? u.fontsLiteral.map((f) => `\`${f}\``).join('<br>') : 'none');
md += `\n## Unused tokens (${unusedTokens.length})\n\n${unusedTokens.map((t) => `\`${t}\``).join(' ') || '_none_'}\n\n_Unused by elements is fine for page-level tokens (z-index, scrim); it is a smell for colours._\n`;
fs.writeFileSync(path.join(OUT, 'README.md'), md);

// ── html report (self-contained: tokens.css inlined so swatches are live) ──
const swatch = (t) => {
  const isColour = t.group === 'color';
  const isSize = t.group === 'size' || t.group === 'space' || t.group === 'radius';
  let demo = '';
  if (isColour) demo = `<span class="sw" style="background:var(${t.name})"></span>`;
  else if (t.group === 'size') demo = `<span class="demo" style="font-size:var(${t.name})">Ag</span>`;
  else if (t.group === 'space') demo = `<span class="bar" style="width:var(${t.name})"></span>`;
  else if (t.group === 'radius') demo = `<span class="rad" style="border-radius:var(${t.name})"></span>`;
  else if (t.group === 'font') demo = `<span class="demo" style="font-family:var(${t.name})">Tandemonium Ride Together</span>`;
  else if (t.group === 'shadow' || t.group === 'glow' || t.group === 'focus') demo = `<span class="rad" style="box-shadow:var(${t.name})"></span>`;
  return `<tr><td>${demo}</td><td><code>${esc(t.name)}</code></td><td><code>${esc(t.value)}</code></td><td class="n">${tokenUseCount[t.name]}</td><td class="note">${esc(t.note)}</td></tr>`;
};
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design system inventory · ${esc(pkg.name)}</title>
<style>${tokensCss}</style>
<style>
  body { margin: 0; background: var(--uf-color-bg); color: var(--uf-color-fg); font: var(--uf-size-md)/1.45 var(--uf-font-ui); padding: var(--uf-space-5) var(--uf-space-4); }
  h1 { font-size: var(--uf-size-xl); margin: 0 0 4px; } h1 small { color: var(--uf-color-fg-muted); font-weight: 400; font-size: var(--uf-size-sm); }
  h2 { font-size: var(--uf-size-sm); letter-spacing: 1.5px; text-transform: uppercase; color: var(--uf-color-fg-muted); margin: var(--uf-space-6) 0 var(--uf-space-3); }
  h3 { font-size: var(--uf-size-md); margin: var(--uf-space-4) 0 var(--uf-space-2); } h3 code { color: var(--uf-color-accent); }
  table { border-collapse: collapse; width: 100%; font-size: var(--uf-size-sm); } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--uf-color-line-soft); vertical-align: middle; } th { color: var(--uf-color-fg-muted); font-weight: 600; }
  td.n { text-align: right; font-family: var(--uf-font-mono); } td.note { color: var(--uf-color-fg-muted); }
  code { font: var(--uf-size-xs)/1.4 var(--uf-font-mono); color: var(--uf-color-info-fg); }
  .sw { display: inline-block; width: 44px; height: 24px; border-radius: var(--uf-radius-sm); border: 1px solid var(--uf-color-line-soft); }
  .bar { display: inline-block; height: 10px; background: var(--uf-color-accent); border-radius: 2px; } .rad { display: inline-block; width: 44px; height: 24px; background: var(--uf-color-surface-2); border: 1px solid var(--uf-color-line); }
  .demo { white-space: nowrap; }
  .card { border: 1px solid var(--uf-color-line-soft); border-radius: var(--uf-radius-lg); padding: var(--uf-space-4); margin-bottom: var(--uf-space-3); background: var(--uf-color-surface-3); }
  .meta { color: var(--uf-color-fg-muted); font-size: var(--uf-size-xs); font-family: var(--uf-font-mono); margin-bottom: var(--uf-space-2); }
  .pill { display: inline-block; font: 700 var(--uf-size-xs)/1 var(--uf-font-mono); padding: 3px 7px; border-radius: var(--uf-radius-sm); background: var(--uf-color-surface-2); margin: 0 4px 4px 0; }
  .ok { color: var(--uf-color-accent); } .bad { color: var(--uf-color-danger); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--uf-space-3); }
  @media (max-width: 700px) { td.note { display: none; } }
</style></head><body>
<h1>Design system inventory <small>${esc(pkg.name)} ${esc(pkg.version)} · ${esc(inv.generated.slice(0, 16).replace('T', ' '))} · <a href="README.md" style="color:var(--uf-color-info-fg)">markdown</a></small></h1>
<p style="color:var(--uf-color-fg-muted);font-size:var(--uf-size-sm)">${tokens.length} tokens · ${elements.length} controls · targets: ${tnames.map((n) => `<b>${esc(n)}</b> (${esc(path.relative(LAB, use[n].root) || '.')})`).join(', ')}</p>

<h2>Adoption</h2>
<table><tr><th></th>${tnames.map((n) => `<th>${esc(n)}</th>`).join('')}</tr>
${[['tokens.css linked', (u) => u.tokensLinked ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'],
   ['kit loaded', (u) => u.kitLoaded ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'],
   ['uf-* elements in HTML', (u) => Object.values(u.per).reduce((a, p) => a + p.html, 0)],
   ['uf-* created in JS', (u) => Object.values(u.per).reduce((a, p) => a + p.js, 0)],
   ['raw &lt;button&gt; still in HTML', (u) => u.rawButtons],
   ['raw buttons still created in JS', (u) => u.rawButtonsJs],
   ['var(--uf-*) references in page CSS', (u) => u.tokenRefs],
   ['literal hex colours in page CSS (distinct / total)', (u) => `${u.hexDistinct} / ${u.hexTotal}`],
   ['literal font stacks in page CSS', (u) => u.fontsLiteral.length ? u.fontsLiteral.map((f) => `<code>${esc(f)}</code>`).join('<br>') : '<span class="ok">none</span>']]
  .map(([k, f]) => `<tr><td>${k}</td>${tnames.map((n) => `<td class="n">${f(use[n])}</td>`).join('')}</tr>`).join('\n')}
</table>

<h2>Tokens (${tokens.length})</h2>
${sections.map((s) => `<h3>${esc(s)}</h3><table><tr><th></th><th>token</th><th>value</th><th>used by</th><th>note</th></tr>${tokens.filter((t) => t.section === s).map(swatch).join('')}</table>`).join('')}
${overrides.length ? `<h3>Overrides</h3><table><tr><th>token</th><th>value</th><th>when</th></tr>${overrides.map((o) => `<tr><td><code>${esc(o.name)}</code></td><td><code>${esc(o.value)}</code></td><td><code>${esc(o.media)}</code></td></tr>`).join('')}</table>` : ''}
${unusedTokens.length ? `<p class="meta">unused by any element: ${unusedTokens.map((t) => `<code>${esc(t)}</code>`).join(' ')}</p>` : ''}

<h2>Controls (${elements.length})</h2>
<div class="grid">
${elements.map((el) => `<div class="card"><h3 style="margin-top:0"><code>&lt;${esc(el.tag)}&gt;</code> ${esc(el.desc)}</h3>
<div class="meta">${esc(el.className)} · ${esc(el.file)} · ${el.lines} lines · ${el.ownsDom ? 'owns its DOM' : 'keeps authored children'} · ${el.galleryStates} gallery states · ${el.tokensUsed.length} tokens${el.literalColours.length ? ` · <span class="bad">${el.literalColours.length} literal colours</span>` : ''}</div>
<table><tr><th>prop</th><th>attribute</th><th>type</th><th>default</th></tr>${el.props.map((p) => `<tr><td><code>${esc(p.name)}</code></td><td><code>${esc(p.attribute)}</code></td><td>${p.type === 'enum' ? p.values.map((v) => `<span class="pill">${esc(v)}</span>`).join('') : esc(p.type)}</td><td><code>${esc(p.default)}</code></td></tr>`).join('')}</table>
<p class="meta">events: ${el.events.map((e) => `<code>${esc(e)}</code>`).join(' ') || '—'}<br>methods: ${el.methods.map((m) => `<code>${esc(m)}</code>`).join(' ') || '—'}<br>data attributes: ${el.dataAttrs.map((d) => `<code>${esc(d)}</code>`).join(' ') || '—'}</p>
<p class="meta">usage: ${tnames.map((n) => `<b>${esc(n)}</b> ${use[n].per[el.tag].html} html + ${use[n].per[el.tag].js} js${use[n].per[el.tag].files.length ? ` <span title="${esc(use[n].per[el.tag].files.join(', '))}">(${use[n].per[el.tag].files.length} files)</span>` : ''}`).join(' · ')}</p>
</div>`).join('\n')}
</div>
<p class="meta" style="margin-top:var(--uf-space-6)">Generated by tools/ui-inventory/ui-inventory.mjs. Literal colours in the wild are measured by <code>npm run ui:audit</code>; the gallery of live states is packages/ui/gallery.html.</p>
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);

console.log(`[ui-inventory] ${tokens.length} tokens (${unusedTokens.length} unused by elements), ${elements.length} controls`);
for (const el of elements) console.log(`  <${el.tag}>  ${el.props.length} props · ${el.events.length} events · ${el.methods.length} methods · ${tnames.map((n) => `${n}: ${use[n].per[el.tag].html}h/${use[n].per[el.tag].js}j`).join(' · ')}`);
for (const n of tnames) console.log(`  ${n}: raw <button> ${use[n].rawButtons} html + ${use[n].rawButtonsJs} js · literal hex ${use[n].hexDistinct} distinct · fonts ${use[n].fontsLiteral.length} literal · tokens linked ${use[n].tokensLinked}`);
console.log(`[ui-inventory] wrote ${path.relative(LAB, OUT)}/{index.html,README.md,inventory.json}`);
