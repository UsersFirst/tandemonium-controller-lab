// Pure-logic tests for the typed element base. No DOM: the class itself is
// exercised in the browser via gallery.html (captured by the screenboard
// `ui-gallery` manifest); what runs here is the coercion contract every
// attribute/property goes through, plus the static plumbing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerce, prop, kebab, esc, UfElement } from '../src/uf-element.js';

test('boolean props: presence is true, "false" is false, absence is false', () => {
  const b = prop.boolean(false);
  assert.equal(coerce(b, ''), true);
  assert.equal(coerce(b, 'disabled'), true);
  assert.equal(coerce(b, 'false'), false);
  assert.equal(coerce(b, null), false);
  assert.equal(coerce(b, 1), true);
});

test('number props: numeric strings parse, junk falls back to default', () => {
  const n = prop.number(3);
  assert.equal(coerce(n, '12'), 12);
  assert.equal(coerce(n, 0), 0);
  assert.equal(coerce(n, 'abc'), 3);
  assert.equal(coerce(n, null), 3);
});

test('enum props: invalid values fall back to the default instead of throwing', () => {
  const e = prop.enum(/** @type {const} */ (['primary', 'ghost']), 'primary');
  const warn = console.warn; let warned = '';
  console.warn = (m) => { warned = String(m); };
  try {
    assert.equal(coerce(e, 'ghost'), 'ghost');
    assert.equal(coerce(e, 'nope', 'uf-x.variant'), 'primary');
    assert.match(warned, /uf-x\.variant/);
  } finally { console.warn = warn; }
});

test('string props: null → default, everything else stringified', () => {
  const s = prop.string('hi');
  assert.equal(coerce(s, null), 'hi');
  assert.equal(coerce(s, 42), '42');
});

test('observedAttributes derive from props, kebab-cased, honouring attribute overrides', () => {
  class X extends UfElement {
    static tag = 'uf-x';
    static props = { fooBar: prop.string(''), hidden2: prop.boolean(false, { attribute: false }), v: prop.number(0, { attribute: 'val' }) };
  }
  assert.deepEqual(X.observedAttributes, ['foo-bar', 'val']);
  assert.equal(kebab('fooBarBaz'), 'foo-bar-baz');
});

test('esc neutralises markup', () => {
  assert.equal(esc('<b a="1">&</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&lt;/b&gt;');
  assert.equal(esc(null), '');
});
