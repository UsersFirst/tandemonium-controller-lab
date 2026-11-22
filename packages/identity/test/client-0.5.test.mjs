// IdentityClient 0.5: a sign-in result belongs to the browser that began it, and a session
// here is not replaced by a different account without the player saying so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IdentityClient, takeRedirect } from '../src/client.js';

const NOW = 1_800_000_000_000;
const jwt = (claims) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc({ exp: Math.floor(NOW / 1000) + 3600, ...claims })}.sig`;
};
const store = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const PETE = { id: 7, name: 'Pete', avatar: null, identities: {} };
const SAM = { id: 9, name: 'Sam', avatar: null, identities: {} };

function setup(routes = {}, extra = {}, href = 'https://app.test/play') {
  const u = new URL(href);
  const l = { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assigned: null, assign(x) { this.assigned = x; } };
  const hist = { replaceState(_s, _t, url) { const n = new URL(url, u.origin); l.search = n.search; l.hash = n.hash; } };
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    const r = typeof routes[path] === 'function' ? routes[path](body) : routes[path];
    const status = (r && r.status) || (r ? 200 : 404);
    return { ok: status < 300, status, json: async () => (r && r.json) || {} };
  };
  routes['/auth/discord/begin'] ||= { json: { id: 'req1', url: 'https://api.test/go' } };
  const asked = [];
  const storage = store(), tabStorage = store();
  const c = new IdentityClient({ apiBase: 'https://api.test', fetch, storage, tabStorage, location: l, history: hist, now: () => NOW,
    confirmSwitch: (q) => { asked.push(q); return false; }, ...extra });
  return { c, l, calls, asked, storage, tabStorage };
}
const exchangeAs = (user, extra = {}) => ({ json: { token: jwt({ sub: user.id, lid: 1, via: 'discord:1' }), user, ...extra } });

test('begin sends only the hash of the value it keeps, and the exchange sends the value', async () => {
  const { c, l, calls, tabStorage } = setup({ '/auth/exchange': exchangeAs(PETE) });
  await c.signInRedirect('discord');
  const hash = calls[0].body.nonce_hash;
  assert.ok(!JSON.stringify(calls[0].body).includes(JSON.parse(tabStorage.getItem('ht_signin_pending')).req1.n));
  l.hash = '#ht_result=req1.c0de';
  assert.equal((await c.resume()).signedIn, true);
  const sent = calls.at(-1);
  assert.equal(sent.path, '/auth/exchange');
  assert.equal(sent.body.code, 'c0de');
  assert.equal(createHash('sha256').update(sent.body.nonce).digest('base64url'), hash);
  assert.equal(tabStorage.getItem('ht_signin_pending'), null, 'read once');
});

test('a result this browser did not begin is refused without asking the server', async () => {
  const { c, calls } = setup({ '/auth/exchange': exchangeAs(SAM) }, {}, 'https://app.test/#ht_result=req9.c0de');
  const out = await c.resume();
  assert.equal(out.signedIn, false);
  assert.equal(out.mismatch, true);
  assert.equal(calls.length, 0);
  assert.equal(c.isSignedIn(), false);
});

test('the server refusing the value leaves the session here alone', async () => {
  const { c, l } = setup({ '/auth/exchange': { status: 403, json: { code: 'signin_mismatch', error: 'no' } } });
  c.apply(jwt({ sub: 7 }), PETE);
  const before = c.token;
  await c.begin('discord');
  l.hash = '#ht_result=req1.c0de';
  const out = await c.resume();
  assert.equal(out.mismatch, true);
  assert.equal(c.token, before);
});

test('a different account never replaces the session without a yes', async () => {
  const no = setup({ '/auth/exchange': exchangeAs(SAM) });
  no.c.apply(jwt({ sub: 7 }), PETE);
  const before = no.c.token;
  await no.c.begin('discord');
  no.l.hash = '#ht_result=req1.c0de';
  assert.deepEqual(await no.c.resume(), { signedIn: false, declined: true });
  assert.equal(no.c.token, before);
  assert.deepEqual(no.asked.map((q) => [q.from.name, q.to.name]), [['Pete', 'Sam']]);

  const yes = setup({ '/auth/exchange': exchangeAs(SAM) }, { confirmSwitch: () => true });
  yes.c.apply(jwt({ sub: 7 }), PETE);
  await yes.c.begin('discord');
  yes.l.hash = '#ht_result=req1.c0de';
  assert.equal((await yes.c.resume()).signedIn, true);
  assert.equal(yes.c.user.id, 9);
});

test('the same account, or no working session, signs in without a question', async () => {
  const same = setup({ '/auth/exchange': exchangeAs(PETE) });
  same.c.apply(jwt({ sub: 7 }), PETE);
  await same.c.begin('discord');
  same.l.hash = '#ht_result=req1.c0de';
  assert.equal((await same.c.resume()).signedIn, true);
  assert.equal(same.asked.length, 0);

  const expired = setup({ '/auth/exchange': exchangeAs(SAM) });
  expired.c.apply(jwt({ sub: 7, exp: Math.floor(NOW / 1000) - 5 }), PETE);
  await expired.c.begin('discord');
  expired.l.hash = '#ht_result=req1.c0de';
  assert.equal((await expired.c.resume()).signedIn, true);
  assert.equal(expired.asked.length, 0);
});

test('a hand-off code never silently replaces a working session', async () => {
  const other = setup({ '/auth/handoff/redeem': exchangeAs(SAM) }, {}, 'https://app.test/?ht_code=a.b');
  other.c.apply(jwt({ sub: 7 }), PETE);
  const before = other.c.token;
  assert.deepEqual(await other.c.redeemHandoff(), { signedIn: false, declined: true });
  assert.equal(other.c.token, before);

  const same = setup({ '/auth/handoff/redeem': exchangeAs(PETE) }, {}, 'https://app.test/?ht_code=a.b');
  same.c.apply(jwt({ sub: 7, marker: 1 }), PETE);
  const mine = same.c.token;
  assert.deepEqual(await same.c.redeemHandoff(), { signedIn: true });
  assert.equal(same.c.token, mine, 'the session here stays');
});

test('a device code cannot add a login', async () => {
  const { c } = setup();
  c.apply(jwt({ sub: 7 }), PETE);
  await assert.rejects(c.startDevice({ link: true }), (e) => e.code === 'link_needs_browser');
});

test('a prepared link may come back in another tab of this browser, and only then', async () => {
  const a = setup({ '/auth/exchange': exchangeAs(PETE) });
  await a.c.begin('discord', { anyTab: true });
  const other = new IdentityClient({ apiBase: 'https://api.test', storage: a.storage, tabStorage: store(), now: () => NOW,
    fetch: async () => ({ ok: true, status: 200, json: async () => exchangeAs(PETE).json }),
    location: { origin: 'https://app.test', pathname: '/', search: '', hash: '#ht_result=req1.c0de' }, history: { replaceState() {} } });
  assert.equal((await other.resume()).signedIn, true);
  assert.equal(a.storage.getItem('ht_signin_pending'), null, 'used up everywhere');

  const b = setup();
  await b.c.begin('discord');
  assert.equal(b.storage.getItem('ht_signin_pending'), null, 'an ordinary sign-in stays in its tab');
});

test('sign out everywhere, undo with a new token, delete that needs a recent sign-in, an empty scope list', async () => {
  const everywhere = setup({ '/me/signout-all': { json: { ok: true } } });
  everywhere.c.apply(jwt({ sub: 7 }), PETE);
  assert.deepEqual(await everywhere.c.signOutEverywhere(), { ok: true });
  assert.equal(everywhere.c.isSignedIn(), false);

  const next = jwt({ sub: 7, marker: 2 });
  const undo = setup({ '/me/notices/undo': { json: { undone: true, kind: 'link', signed_out: false, token: next, user: PETE } }, '/me': { json: { user: { id: 7, identities: {} } } } });
  undo.c.apply(jwt({ sub: 7 }), PETE);
  const out = await undo.c.undo(1);
  assert.equal(undo.c.token, next);
  assert.equal(out.token, undefined, 'the token stays inside the client');

  const del = setup({ '/me/delete': { status: 401, json: { code: 'fresh_signin', error: 'Sign in again.' } } });
  del.c.apply(jwt({ sub: 7 }), PETE);
  assert.equal((await del.c.deleteAccount('DELETE')).fresh, true);
  assert.equal(del.c.isSignedIn(), true);

  const scopes = setup();
  await scopes.c.begin('discord', { scopes: [] });
  assert.deepEqual(scopes.calls[0].body.scopes, []);
});

test('takeRedirect reads a result and takes it off the address', () => {
  const l = { pathname: '/p', search: '?x=1', hash: '#ht_result=id.code.more&keep=1' };
  let url = null;
  const back = takeRedirect(l, { replaceState(_s, _t, u) { url = u; } });
  assert.deepEqual(back.result, { id: 'id', code: 'code.more' });
  assert.equal(url, '/p?x=1#keep=1');
});
