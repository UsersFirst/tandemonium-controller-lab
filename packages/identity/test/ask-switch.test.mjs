import test from 'node:test';
import assert from 'node:assert/strict';
import { askInPage, askMarkup } from '../src/elements/ask-switch.js';

test('askMarkup: names the account, warns, and Cancel comes first', () => {
  const html = askMarkup({ from: null, to: { name: 'Pete <b>', avatar: 'https://cdn.test/a.png' } });
  assert.ok(html.includes('Continue as Pete &lt;b&gt;?'));
  assert.ok(html.includes('Only continue if you opened this yourself.'));
  assert.ok(html.includes('src="https://cdn.test/a.png"'));
  assert.ok(html.indexOf('data-part="no"') < html.indexOf('data-part="yes"'));
});

test('askMarkup: a different account signed in here is named; a picture that is not https is left out', () => {
  const html = askMarkup({ from: { name: 'Sam' }, to: { name: 'Pete', avatar: 'javascript:alert(1)' } });
  assert.ok(html.includes('You are signed in here as Sam.'));
  assert.ok(!html.includes('<img'));
});

test('askInPage: with no page and no confirm the answer is no; with confirm it is asked there', async () => {
  const real = globalThis.confirm;
  try {
    globalThis.confirm = undefined;
    assert.equal(await askInPage({ from: null, to: { name: 'Pete' } }), false);
    let said = '';
    globalThis.confirm = (m) => { said = m; return true; };
    assert.equal(await askInPage({ from: null, to: { name: 'Pete' } }), true);
    assert.ok(said.startsWith('Continue as Pete?'));
  } finally { globalThis.confirm = real; }
});
