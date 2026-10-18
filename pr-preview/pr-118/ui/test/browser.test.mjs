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
