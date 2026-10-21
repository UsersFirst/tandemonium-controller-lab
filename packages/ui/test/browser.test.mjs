// ============================================================
// browser.test.mjs — the elements in a real DOM (headless Chrome)
// ============================================================
//
// uf-element.test.js covers the coercion contract in plain Node. This loads
// packages/ui/gallery.html in headless Chrome and asserts the behaviour that
// only a DOM can show: attribute ↔ property reflection, enum fallback,
// uf-button disabled + keyboard activation + click suppression, uf-flow
// go/back/history + the change event + data-flow-* wiring, uf-step
// focusables(), and FocusController driving a flow from a ManualInput.
//
// Puppeteer is resolved from this repo if installed (CI installs it), else
// from a sibling checkout (tools/_lib/resolve-puppeteer.mjs); with neither,
// the suite is skipped so `npm test` stays dependency-free.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(HERE, '..', '..', '..');

let puppeteer = null, browser = null, page = null, close = null;
try {
  const { resolvePuppeteer } = await import('../../../tools/_lib/resolve-puppeteer.mjs');
  puppeteer = await resolvePuppeteer(LAB);
} catch (e) { console.log('[browser.test] skipped — no puppeteer:', String(e.message).split('\n')[0]); }

before(async () => {
  if (!puppeteer) return;
  const { serveStatic } = await import('../../../tools/_lib/static-server.mjs');
  const srv = await serveStatic(LAB, 8970 + Math.floor(Math.random() * 20));
  close = srv.close;
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(`${srv.origin}/packages/ui/gallery.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!customElements.get('uf-flow') && !!document.getElementById('demo-flow')?.go);
  assert.deepEqual(errors, [], 'gallery loads without page errors');
});
after(async () => { if (browser) await browser.close(); if (close) await close(); });

const skip = { skip: !puppeteer && 'puppeteer not available' };
const ev = (fn, ...args) => page.evaluate(fn, ...args);

test('uf-button: attribute ↔ property reflection and enum fallback', skip, async () => {
  const r = await ev(() => {
    const b = document.createElement('uf-button');
    b.textContent = 'X'; document.body.appendChild(b);
    const out = {};
    b.variant = 'accent'; out.attrAfterProp = b.getAttribute('variant');
    b.setAttribute('variant', 'ghost'); out.propAfterAttr = b.variant;
    const warn = console.warn; let warned = ''; console.warn = (m) => { warned = String(m); };
    b.setAttribute('variant', 'nope'); out.fallback = b.variant; out.warned = warned; console.warn = warn;
    b.disabled = true; out.disabledAttr = b.hasAttribute('disabled'); out.ariaDisabled = b.getAttribute('aria-disabled'); out.tabindex = b.getAttribute('tabindex');
    b.removeAttribute('disabled'); out.enabledAgain = b.disabled === false && b.getAttribute('tabindex') === '0';
    out.role = b.getAttribute('role');
    b.remove(); return out;
  });
  assert.equal(r.attrAfterProp, 'accent');
  assert.equal(r.propAfterAttr, 'ghost');
  assert.equal(r.fallback, 'primary');
  assert.match(r.warned, /uf-button\.variant/);
  assert.equal(r.disabledAttr, true); assert.equal(r.ariaDisabled, 'true'); assert.equal(r.tabindex, '-1');
  assert.equal(r.enabledAgain, true); assert.equal(r.role, 'button');
});

test('uf-button: click listeners fire on click/Enter/Space and never while disabled', skip, async () => {
  const r = await ev(async () => {
    const b = document.createElement('uf-button'); b.textContent = 'Go'; document.body.appendChild(b);
    let n = 0; b.addEventListener('click', () => n++);
    b.click();
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const after3 = n;
    b.disabled = true; await new Promise((r) => queueMicrotask(r));
    b.click(); b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterDisabled = n;
    b.label = 'Changed'; await new Promise((r) => queueMicrotask(r));
    const text = b.textContent;
    b.remove(); return { after3, afterDisabled, text };
  });
  assert.equal(r.after3, 3);
  assert.equal(r.afterDisabled, 3);
  assert.equal(r.text, 'Changed');
});

test('uf-flow: go/back/history, change event, data-flow wiring, current attribute', skip, async () => {
  const r = await ev(async () => {
    const f = document.getElementById('demo-flow');
    const events = [];
    f.addEventListener('uf-flow:change', (e) => events.push(e.detail));
    const active = () => Array.from(f.querySelectorAll('uf-step')).filter((s) => s.hasAttribute('active')).map((s) => s.id);
    const out = { start: f.current, startActive: active() };
    f.go('two'); out.afterGo = [f.current, f.history.slice(), active()];
    f.querySelector('#two [data-flow-go="three"]').click(); out.afterClick = [f.current, f.history.slice()];
    out.back1 = f.back(); out.afterBack = [f.current, f.history.slice()];
    f.querySelector('#two [data-flow-back]').click(); out.afterBackClick = [f.current, f.history.slice()];
    out.back0 = f.back();
    f.setAttribute('current', 'three'); await new Promise((r) => queueMicrotask(r)); out.viaAttr = [f.current, f.history.slice()];
    out.missing = f.go('nope');
    f.reset(); f.go('one'); f.reset();
    out.events = events.map((e) => `${e.from}>${e.to}${e.back ? '<' : ''}`);
    return out;
  });
  assert.equal(r.start, 'one'); assert.deepEqual(r.startActive, ['one']);
  assert.deepEqual(r.afterGo, ['two', ['one'], ['two']]);
  assert.deepEqual(r.afterClick, ['three', ['one', 'two']]);
  assert.equal(r.back1, true); assert.deepEqual(r.afterBack, ['two', ['one']]);
  assert.deepEqual(r.afterBackClick, ['one', []]);
  assert.equal(r.back0, false);
  assert.deepEqual(r.viaAttr, ['three', []], 'setting the attribute navigates without stacking');
  assert.equal(r.missing, false);
  assert.deepEqual(r.events.slice(0, 5), ['one>two', 'two>three', 'three>two<', 'two>one<', 'one>three']);
});

test('uf-step: focusables() skips disabled and hidden items; FocusController + ManualInput drive a flow', skip, async () => {
  const r = await ev(async () => {
    const { FocusController, ManualInput } = await import('./src/index.js');
    const host = document.createElement('div');
    host.innerHTML = `<uf-flow id="t-flow" current="a">
      <uf-step id="a" prompt="A"><uf-button id="a1">1</uf-button><uf-button id="a2" disabled>2</uf-button><uf-button id="a3" data-flow-go="b">3</uf-button></uf-step>
      <uf-step id="b" prompt="B"><uf-button id="b1" data-flow-back>back</uf-button><uf-button id="b2" style="display:none">hidden</uf-button></uf-step>
    </uf-flow>`;
    document.body.appendChild(host);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const flow = document.getElementById('t-flow');
    const out = {};
    out.focA = flow.step('a').focusables().map((e) => e.id);
    out.focBInactive = flow.step('b').focusables().map((e) => e.id);   // hidden step → nothing is visible
    const input = new ManualInput();
    const fc = new FocusController({ input, onBack: () => flow.back() });
    flow.attachFocus(fc);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    fc.poll();                                    // primes edges (nothing pressed)
    out.focused0 = fc.focused && fc.focused.id;
    input.press('down'); fc.poll(); input.release('down'); fc.poll();
    out.focused1 = fc.focused && fc.focused.id;   // a2 is disabled → skipped → a3
    input.press('a'); fc.poll(); input.release('a'); fc.poll();   // confirm a3 → go('b')
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.afterConfirm = flow.current;
    out.focB = flow.step('b').focusables().map((e) => e.id);   // now visible; b2 is display:none
    out.focusedB = fc.focused && fc.focused.id;
    input.press('b'); fc.poll(); input.release('b'); fc.poll();   // B → back
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.afterBack = flow.current;
    host.remove(); return out;
  });
  assert.deepEqual(r.focA, ['a1', 'a3']);
  assert.deepEqual(r.focBInactive, []);
  assert.deepEqual(r.focB, ['b1']);
  assert.equal(r.focused0, 'a1');
  assert.equal(r.focused1, 'a3');
  assert.equal(r.afterConfirm, 'b');
  assert.equal(r.focusedB, 'b1');
  assert.equal(r.afterBack, 'a');
});

// ── kit 0.3: TV lobby components (docs/UI-KIT-TV-COMPONENTS.md) ──
const tick = () => new Promise((r) => setTimeout(r, 0));

test('uf-controller-glyph: roles map to the printed label per family; swap; page default', skip, async () => {
  const r = await ev(async () => {
    const { resolveGlyph, UfControllerGlyph } = await import('./src/index.js');
    const out = {
      ps: resolveGlyph('confirm', 'playstation').text, psBack: resolveGlyph('back', 'playstation').text,
      xb: resolveGlyph('confirm', 'xbox').text, nin: resolveGlyph('confirm', 'nintendo').text,
      ninSwap: resolveGlyph('confirm', 'nintendo', true).text, steam: resolveGlyph('alt', 'steam').text,
      kb: resolveGlyph('confirm', 'keyboard').text, lb: resolveGlyph('lb', 'playstation').text, zr: resolveGlyph('rt', 'nintendo').text,
      generic: resolveGlyph('confirm', 'generic').shape,
    };
    const g = document.createElement('uf-controller-glyph'); g.button = 'confirm'; document.body.appendChild(g);
    await new Promise((r) => setTimeout(r, 0));
    UfControllerGlyph.setDefault({ family: 'xbox' });
    await new Promise((r) => setTimeout(r, 0));
    out.autoText = g.textContent; out.autoLabel = g.getAttribute('aria-label');
    UfControllerGlyph.setDefault({ family: 'generic', swap: false });
    g.remove(); return out;
  });
  assert.deepEqual([r.ps, r.psBack, r.xb, r.nin, r.ninSwap, r.steam, r.kb, r.lb, r.zr, r.generic],
    ['✕', '◯', 'A', 'B', 'A', 'X', 'Enter', 'L1', 'ZR', 'diamond']);
  assert.equal(r.autoText, 'A', 'family=auto follows setDefault');
  assert.equal(r.autoLabel, 'A button');
});

test('uf-button: sub renders a trailing line that survives a label change', skip, async () => {
  const r = await ev(async () => {
    const b = document.getElementById('demo-sub');
    const out = { sub0: b.querySelector('.uf-button__sub')?.textContent };
    b.label = 'RIDE ALONE'; await new Promise((r) => setTimeout(r, 0));
    out.text = b.firstChild.textContent; out.sub1 = b.querySelector('.uf-button__sub')?.textContent;
    b.sub = ''; await new Promise((r) => setTimeout(r, 0));
    out.gone = !b.querySelector('.uf-button__sub');
    b.label = ''; b.sub = 'Couch co-op, online or versus';
    return out;
  });
  assert.equal(r.sub0, 'Couch co-op, online or versus');
  assert.equal(r.text, 'RIDE ALONE');
  assert.equal(r.sub1, 'Couch co-op, online or versus');
  assert.equal(r.gone, true);
});

test('uf-seat + uf-team: open/candidate seats focusable; team title survives a seat rewrite', skip, async () => {
  const r = await ev(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<uf-team id="t-team" tone="team-a" heading="Team blue"><uf-seat id="s1" state="joined" who="DualSense"></uf-seat><uf-seat id="s2" state="candidate" who="Switch Pro"></uf-seat></uf-team>';
    document.body.appendChild(host);
    await new Promise((r) => setTimeout(r, 0));
    const team = document.getElementById('t-team');
    const out = { title: team.querySelector('.uf-team__title')?.textContent, f1: document.getElementById('s1').hasAttribute('data-focusable'), f2: document.getElementById('s2').hasAttribute('data-focusable') };
    team.querySelectorAll('uf-seat').forEach((s) => s.remove());
    team.insertAdjacentHTML('beforeend', '<uf-seat state="open"></uf-seat>');
    await new Promise((r) => setTimeout(r, 0));
    out.titleAfter = team.querySelector(':scope > .uf-team__title')?.textContent;
    out.seats = team.seats().length;
    host.remove(); return out;
  });
  assert.equal(r.title, 'Team blue');
  assert.equal(r.f1, false, 'joined seats are read-only');
  assert.equal(r.f2, true, 'candidate seats take focus');
  assert.equal(r.titleAfter, 'Team blue');
  assert.equal(r.seats, 1);
});

test('uf-controller-roster: strip badges use the app label; full means seats full; dots patch without re-render', skip, async () => {
  const r = await ev(async () => {
    const el = document.createElement('uf-controller-roster'); el.capacity = 1; document.body.appendChild(el);
    const rows = [
      { key: 'a', shortName: 'DualSense', state: 'seated', player: 1, seat: { team: 'red', role: 'player', label: 'Driver', tone: 'team-b' }, glyphFamily: 'playstation', active: false },
      { key: 'b', shortName: 'Xbox', state: 'connected', glyphFamily: 'xbox', active: false },
    ];
    el.rows = rows; await new Promise((r) => setTimeout(r, 0));
    const out = { chips: el.querySelectorAll('.ucr-chip').length, badge: el.querySelector('.ucr-badge')?.textContent, tone: el.querySelector('.ucr-chip')?.dataset.tone,
      full: el.full, spare: el.querySelectorAll('.ucr-chip')[1].textContent.includes('seats full'), head: el.querySelector('.ucr-head span')?.textContent };
    const chip = el.querySelector('.ucr-chip');
    el.rows = rows.map((x) => (x.key === 'b' ? { ...x, active: true } : x)); await new Promise((r) => setTimeout(r, 0));
    out.sameNode = el.querySelector('.ucr-chip') === chip;
    out.dotOn = el.querySelector('.ucr-dot[data-key="b"]').classList.contains('on');
    el.variant = 'list'; el.selectable = true; await new Promise((r) => setTimeout(r, 0));
    let picked = null; el.addEventListener('uf-controller-roster:select', (e) => { picked = e.detail.key; });
    el.querySelector('.ucr-row[data-key="b"]').click();
    out.picked = picked; out.focusables = el.focusables().length;
    el.remove(); return out;
  });
  assert.equal(r.chips, 2);
  assert.equal(r.badge, 'Driver', 'the badge prints the label the app supplies');
  assert.equal(r.tone, 'team-b');
  assert.equal(r.full, true);
  assert.equal(r.spare, true);
  assert.equal(r.head, '1 of 1 seats taken');
  assert.equal(r.sameNode, true, 'an active-only change does not re-render');
  assert.equal(r.dotOn, true);
  assert.equal(r.picked, 'b');
  assert.equal(r.focusables, 2);
});

test('uf-sheet: children move into the card; Esc closes with a reason; attachFocus scopes and restores', skip, async () => {
  const r = await ev(async () => {
    const { FocusController, ManualInput } = await import('./src/index.js');
    const host = document.createElement('div');
    host.innerHTML = '<uf-button id="outside">outside</uf-button>' +
      '<uf-sheet id="t-sheet" heading="Test"><p id="t-body">hi</p><uf-button id="t-in">inside</uf-button><div slot="actions"><uf-button id="t-done">done</uf-button></div></uf-sheet>';
    document.body.appendChild(host);
    await new Promise((r) => setTimeout(r, 0));
    const sheet = document.getElementById('t-sheet');
    const out = { inBody: !!sheet.querySelector('.uf-sheet__body #t-body'), inActions: !!sheet.querySelector('.uf-sheet__actions #t-done') };
    const events = [];
    sheet.addEventListener('uf-sheet:open', () => events.push('open'));
    sheet.addEventListener('uf-sheet:close', (e) => events.push('close:' + e.detail.reason));
    const input = new ManualInput();
    const fc = new FocusController({ input });
    fc.setSpatial([document.getElementById('outside')]);
    sheet.attachFocus(fc);
    sheet.show();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.scope = fc.items.map((e) => e.id || e.className);
    out.first = fc.focused && fc.focused.id;
    fc.poll(); input.press('b'); fc.poll(); input.release('b'); fc.poll();
    await new Promise((r) => setTimeout(r, 0));
    out.openAfterB = sheet.open; out.restored = fc.items.map((e) => e.id);
    sheet.show(); await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise((r) => setTimeout(r, 0));
    out.events = events;
    sheet.attachFocus(null); host.remove(); return out;
  });
  assert.equal(r.inBody, true);
  assert.equal(r.inActions, true);
  assert.ok(r.scope.includes('t-in') && r.scope.includes('t-done'), 'the open sheet is the focus scope: ' + r.scope.join(','));
  assert.equal(r.first, 't-in', 'focus starts in the body, not on Close');
  assert.equal(r.openAfterB, false, 'B closes it');
  assert.deepEqual(r.restored, ['outside'], 'the previous scope returns');
  assert.deepEqual(r.events, ['open', 'close:back', 'open', 'close:escape']);
});

test('uf-setting: click toggles and emits change; a click in the detail row does not', skip, async () => {
  const r = await ev(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<uf-setting id="t-set" label="Gyro" checked><div slot="detail"><uf-button id="t-recal" size="sm">Recalibrate</uf-button></div></uf-setting>';
    document.body.appendChild(host);
    await new Promise((r) => setTimeout(r, 0));
    const s = document.getElementById('t-set');
    const changes = []; s.addEventListener('change', (e) => changes.push(e.detail.checked));
    document.getElementById('t-recal').click();
    s.click(); await new Promise((r) => setTimeout(r, 0));
    const out = { changes, checked: s.checked, aria: s.getAttribute('aria-checked'), focusable: s.hasAttribute('data-focusable'), detailHidden: getComputedStyle(s.querySelector('.uf-setting__detail')).display === 'none' };
    host.remove(); return out;
  });
  assert.deepEqual(r.changes, [false]);
  assert.equal(r.checked, false);
  assert.equal(r.aria, 'false');
  assert.equal(r.focusable, true);
  assert.equal(r.detailHidden, true, 'an unchecked toggle hides its detail row (no kind attribute needed)');
});

test('uf-card: locked swallows clicks; selected sets aria-pressed', skip, async () => {
  const r = await ev(async () => {
    const c = document.createElement('uf-card'); c.heading = 'X'; c.locked = true; document.body.appendChild(c);
    let clicks = 0; c.addEventListener('click', () => clicks++);
    await new Promise((r) => setTimeout(r, 0));
    c.click(); c.locked = false; c.selected = true; await new Promise((r) => setTimeout(r, 0)); c.click();
    const out = { clicks, pressed: c.getAttribute('aria-pressed'), title: c.querySelector('[role=heading]')?.textContent };
    c.remove(); return out;
  });
  assert.equal(r.clicks, 1);
  assert.equal(r.pressed, 'true');
  assert.equal(r.title, 'X');
});

test('uf-join-code + uf-keypad: keys type, alphabet filters, Done waits for a full code', skip, async () => {
  const r = await ev(async () => {
    const code = document.getElementById('demo-code'); const pad = document.getElementById('demo-keypad');
    code.clear(); await new Promise((r) => setTimeout(r, 0));
    let submitted = null; code.addEventListener('submit', (e) => { submitted = e.detail.code; });
    const out = { keys: pad.querySelectorAll('.ukp-key').length, emptySlots: code.querySelectorAll('.ujc-slot').length, typedO: code.type('O') };
    pad.press('K'); pad.press('9');
    await new Promise((r) => setTimeout(r, 0));
    out.partial = code.code; out.doneDisabled = pad.querySelector('uf-button[data-key="Done"]').disabled;
    pad.press('N'); pad.press('E'); pad.press('Z');
    await new Promise((r) => setTimeout(r, 0));
    out.full = code.code; out.doneEnabled = !pad.querySelector('uf-button[data-key="Done"]').disabled;
    pad.press('Done'); out.submitted = submitted;
    pad.press('Delete'); out.afterDelete = code.code;
    code.clear(); return out;
  });
  assert.equal(r.keys, 32, 'the room-code alphabet');
  assert.equal(r.emptySlots, 4);
  assert.equal(r.typedO, false, 'O is not in the room-code alphabet');
  assert.equal(r.partial, 'K9');
  assert.equal(r.doneDisabled, true);
  assert.equal(r.full, 'K9NE', 'a fifth key is ignored');
  assert.equal(r.doneEnabled, true);
  assert.equal(r.submitted, 'K9NE');
  assert.equal(r.afterDelete, 'K9N');
});

test('uf-qr: draws an svg from value; reveal shows the full link on demand', skip, async () => {
  const r = await ev(() => {
    const q = document.getElementById('demo-qr');
    const out = { svg: !!q.querySelector('.uqr-code svg'), fullBefore: !!q.querySelector('.uqr-full') };
    q.querySelector('.uqr-reveal').click();
    return out;
  });
  await page.waitForFunction(() => !!document.querySelector('#demo-qr .uqr-full'));
  r.fullAfter = await ev(() => {
    const q = document.getElementById('demo-qr');
    const t = q.querySelector('.uqr-full').textContent;
    q.querySelector('.uqr-reveal').click();
    return t;
  });
  assert.equal(r.svg, true);
  assert.equal(r.fullBefore, false, 'the secret-bearing link is not printed by default');
  assert.ok(r.fullAfter.includes('#k=secret'));
});

test('uf-system-bar: Back follows the flow; the flow focus scope includes the bar', skip, async () => {
  const r = await ev(async () => {
    const { FocusController, ManualInput } = await import('./src/index.js');
    const host = document.createElement('div');
    host.innerHTML = '<uf-flow id="bar-flow" current="a"><uf-step id="a"><uf-button id="ba" data-flow-go="b">go</uf-button></uf-step><uf-step id="b"><uf-button id="bb">b</uf-button></uf-step></uf-flow>' +
      '<uf-system-bar id="t-bar" flow="bar-flow"><uf-button size="pill" id="p-help" slot="start">Help</uf-button><uf-button size="pill" id="p-music" slot="end">Music</uf-button></uf-system-bar>';
    document.body.appendChild(host);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const bar = document.getElementById('t-bar'); const flow = document.getElementById('bar-flow');
    const back = bar.querySelector('.uf-bar__back');
    const out = { backHidden0: back.hidden };
    flow.go('b'); await new Promise((r) => setTimeout(r, 0));
    out.backHidden1 = back.hidden;
    await new Promise((r) => setTimeout(r, 0));
    out.backText = back.querySelector(':scope > span').textContent; out.glyphIntact = !!back.querySelector('uf-controller-glyph .ufg');
    const fc = new FocusController({ input: new ManualInput() });
    flow.attachFocus(fc);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.scope = fc.items.map((e) => e.id);
    back.click(); await new Promise((r) => setTimeout(r, 0));
    out.afterBack = flow.current;
    flow.attachFocus(null); host.remove(); return out;
  });
  assert.equal(r.backHidden0, true, 'no history, no Back');
  assert.equal(r.backHidden1, false);
  assert.equal(r.backText, 'Back');
  assert.equal(r.glyphIntact, true, 'the label never overwrites the glyph');
  assert.deepEqual(r.scope, ['bb', 'p-help', 'p-music']);
  assert.equal(r.afterBack, 'a');
});

// ── kit 0.4: room, garage and end-of-ride pieces ──

test('uf-stat + uf-ledger: values render; ledger totals items unless total is set; balance line', skip, async () => {
  const r = await ev(async () => {
    const l = document.createElement('uf-ledger'); l.heading = 'Coins'; l.unit = 'c'; document.body.appendChild(l);
    l.items = [{ label: 'A', amount: 8 }, { label: 'B', amount: 5 }, { label: 'Multiplier', display: '×1.25' }]; l.balance = 13;
    await new Promise((res) => setTimeout(res, 0));
    const out = { head: l.querySelector('.ul-head').textContent, total: l.querySelector('.ul-total b').textContent, bal: l.querySelector('.ul-balance').textContent, mult: l.querySelectorAll('.ul-row b')[2].textContent };
    l.total = 20; await new Promise((res) => setTimeout(res, 0)); out.head2 = l.querySelector('.ul-head').textContent;
    const s = document.createElement('uf-stat'); s.value = '18s'; s.label = 'Time'; document.body.appendChild(s);
    await new Promise((res) => setTimeout(res, 0));
    out.stat = s.querySelector('.ust-value').textContent; out.aria = s.getAttribute('aria-label');
    l.remove(); s.remove(); return out;
  });
  assert.equal(r.head, '+13 c Coins');
  assert.equal(r.total, '13 c');
  assert.equal(r.bal, 'Wallet: 13 c');
  assert.equal(r.mult, '×1.25', 'a display row shows its text and is not summed');
  assert.equal(r.head2, '+20 c Coins');
  assert.equal(r.stat, '18s');
  assert.equal(r.aria, 'Time: 18s');
});

test('uf-achievement: new shows Unlocked!, progress draws a bar, locked is announced', skip, async () => {
  const r = await ev(async () => {
    const mk = (state, extra = {}) => { const a = document.createElement('uf-achievement'); Object.assign(a, { name: 'X', description: 'D', state, ...extra }); document.body.appendChild(a); return a; };
    const n = mk('new'), p = mk('progress', { progress: 0.4 }), l = mk('locked');
    await new Promise((res) => setTimeout(res, 0));
    const out = { newText: n.querySelector('.ua-new')?.textContent, bar: p.querySelector('.ua-bar i')?.style.width, locked: l.getAttribute('aria-label') };
    [n, p, l].forEach((e) => e.remove()); return out;
  });
  assert.equal(r.newText, 'Unlocked!');
  assert.equal(r.bar, '40%');
  assert.equal(r.locked, 'X (locked)');
});

test('uf-player-card: initials without avatar, stats, kept children; waiting state', skip, async () => {
  const r = await ev(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<uf-player-card id="t-pc" name="Pete Gordon" subtitle="Captain" badge="P1"><uf-achievement id="t-pc-a" name="A"></uf-achievement></uf-player-card>';
    document.body.appendChild(host);
    const c = document.getElementById('t-pc'); c.stats = [{ value: 42, label: 'Rides' }];
    await new Promise((res) => setTimeout(res, 0));
    const out = { initials: c.querySelector('.upc-av').textContent, stat: c.querySelector('.upc-stat b').textContent, kept: !!c.querySelector('.upc-extra #t-pc-a'), badge: c.querySelector('.upc-badge').textContent };
    c.state = 'waiting'; await new Promise((res) => setTimeout(res, 0)); out.waitingAv = c.querySelector('.upc-av').textContent;
    host.remove(); return out;
  });
  assert.equal(r.initials, 'PG');
  assert.equal(r.stat, '42');
  assert.equal(r.kept, true, 'authored children survive as extra content');
  assert.equal(r.badge, 'P1');
  assert.equal(r.waitingAv, '?');
});

test('uf-card row + uf-pips: meta and level pips render; pips announce value of max', skip, async () => {
  const r = await ev(async () => {
    const c = document.getElementById('demo-upgrade');
    const pips = c.querySelector('uf-pips');
    await new Promise((res) => setTimeout(res, 0));
    return { meta: c.querySelector('.uf-card__meta').textContent, on: pips.querySelectorAll('i.on').length, all: pips.querySelectorAll('i').length, aria: pips.getAttribute('aria-label') };
  });
  assert.equal(r.meta, '🪙 40+42 m');
  assert.equal(r.on, 3);
  assert.equal(r.all, 10);
  assert.equal(r.aria, '3 of 10');
});

test('uf-sheet headline + tone: title in the tone, centred headline', skip, async () => {
  const r = await ev(async () => {
    const s = document.getElementById('demo-result'); s.show();
    await new Promise((res) => setTimeout(res, 50));
    const t = s.querySelector('.uf-sheet__title');
    const out = { text: t.textContent, upper: getComputedStyle(t).textTransform, color: getComputedStyle(t).color, accent: getComputedStyle(document.documentElement).getPropertyValue('--uf-color-accent').trim() };
    s.close(); return out;
  });
  assert.equal(r.text, 'You made it!');
  assert.equal(r.upper, 'uppercase');
  assert.equal(r.color, 'rgb(68, 255, 102)', 'accent tone (#44ff66)');
});

test('uf-sheet: a tall body scrolls inside the card; the card never runs off the screen', skip, async () => {
  const r = await ev(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<uf-sheet id="t-tall" heading="Tall" open dismissible="false"><div style="height:3000px">x</div><div slot="actions"><uf-button id="t-tall-ok">OK</uf-button></div></uf-sheet>';
    document.body.appendChild(host);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const card = document.querySelector('#t-tall .uf-sheet__card').getBoundingClientRect();
    const ok = document.getElementById('t-tall-ok').getBoundingClientRect();
    const out = { cardBottom: card.bottom, okBottom: ok.bottom, vh: innerHeight };
    host.remove(); return out;
  });
  assert.ok(r.cardBottom <= r.vh, `card bottom ${r.cardBottom} within ${r.vh}`);
  assert.ok(r.okBottom <= r.vh, 'the action row stays on screen');
});
