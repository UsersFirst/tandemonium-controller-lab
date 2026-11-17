// The flow's wording, and what the elements render (their html is a pure function of their
// data, so it can be checked without a browser; demo.html shows them live).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeText, summaryLines, providerName, TEXT } from '../src/text.js';
import { UfAccountNotice } from '../src/elements/uf-account-notice.js';
import { UfCombineAccounts } from '../src/elements/uf-combine-accounts.js';
import { UfDeviceSignin } from '../src/elements/uf-device-signin.js';
import { esc } from '../src/elements/base.js';

const notice = { id: 5, kind: 'link', provider: 'discord', login_name: 'petegordon', from_name: null, created_at: 1794700800, undo_until: 1795305600, seen: false };

test('a notice always names the provider, and says until when it can be undone', () => {
  const link = noticeText(notice, { locale: 'en-US' });
  assert.match(link.text, /^The Discord account “petegordon” was linked to this account on Nov \d+\. Not you\? You can undo it until Nov \d+\.$/);
  assert.equal(link.undo, 'Not me, remove it');
  assert.equal(link.ok, 'OK, that was me');
  const combine = noticeText({ ...notice, kind: 'combine', provider: 'steam', from_name: 'Old Steam Pete' }, { locale: 'en-US' });
  assert.match(combine.text, /^The Steam account “Old Steam Pete” was combined into this one on /);
  assert.equal(combine.undo, 'Separate them');
  assert.equal(providerName('google'), 'Google');
  assert.equal(providerName('whatever'), 'sign-in');
});

test('an account’s numbers: plurals, and the other games a combine would move', () => {
  assert.deepEqual(summaryLines({ rides: 1, badges: 0 }), ['1 ride · 0 badges in Tandemonium']);
  assert.deepEqual(summaryLines({ rides: 12, badges: 30, games: [{ game: 'coins', title: 'Carnival Dozer', badges: 1 }, { game: 'dice', title: '7, 11, Doubles', badges: 0 }] }),
    ['12 rides · 30 badges in Tandemonium', 'Also: Carnival Dozer (1 badge), 7, 11, Doubles']);
  assert.equal(TEXT.deviceSteps[2], 'Type this code on your phone');
  assert.match(TEXT.combineAsk('Pete'), /every House Tandem game/);
});

test('<uf-account-notice> renders the text and the undo first; text is escaped', () => {
  const el = new UfAccountNotice();
  assert.equal(el.render(), '', 'nothing without a notice');
  el._notice = { ...notice, login_name: '<img src=x onerror=alert(1)>' };
  const html = el.render();
  assert.ok(!html.includes('<img'), 'a name can’t inject markup');
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.indexOf('data-act="undo"') < html.indexOf('data-act="ok"'));
  el._busy = true;
  assert.equal((el.render().match(/ disabled/g) || []).length, 2);
  assert.equal(esc(`<a href="x">'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;');
});

test('<uf-combine-accounts> shows both accounts and every game; Cancel comes first', () => {
  const el = new UfCombineAccounts();
  el._q = { provider: 'steam',
    other: { name: 'pete_steam', avatar: 'https://x/s.png', logins: [{ provider: 'steam' }], rides: 10, badges: 5, games: [{ game: 'coins', title: 'Carnival Dozer', badges: 1 }] },
    into: { name: 'Pete', avatar: null, logins: [{ provider: 'discord' }, { provider: 'google' }], rides: 2, badges: 3 } };
  const html = el.render();
  assert.match(html, /This Steam account already has its own House Tandem account/);
  assert.match(html, /pete_steam[\s\S]*10 rides · 5 badges in Tandemonium[\s\S]*Also: Carnival Dozer \(1 badge\)/);
  assert.match(html, /Discord \+ Google/);
  assert.match(html, /Combine it into Pete\?/);
  assert.ok(html.indexOf('data-act="no"') < html.indexOf('data-act="yes"'), 'the safe choice first');
});

test('<uf-device-signin> shows the code and the steps, never the address as a link', () => {
  const el = new UfDeviceSignin();
  el._url = 'https://api.test/auth/discord/go?r=abc';
  el._code = 'K7QF';
  let html = el.render();
  assert.match(html, /Type this code on your phone/);
  assert.match(html, /K7QF/);
  assert.match(html, /Getting a sign-in code…/);
  assert.ok(!html.includes('<a '), 'nothing to click through to on a TV');
  assert.ok(!html.includes('data-act="open"'));
  el._status = 'confirming';
  assert.match(el.render(), /Type the code on your phone…/);
  el.hasAttribute = (n) => n === 'open-here';
  assert.match(el.render(), /Open on this computer/);
});
