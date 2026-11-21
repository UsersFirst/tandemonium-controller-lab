// IdentityClient 0.4 — what the Discord Activities each had to do for themselves (lab #155):
// redeeming a hand-off code, refusing an expired token on the way back, ending the session on
// any 401 when asked to, and a stored token with no stored profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityClient } from '../src/client.js';

const NOW = 1_800_000_000_000;
const jwt = (claims) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc({ exp: Math.floor(NOW / 1000) + 3600, ...claims })}.sig`;
};
const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const loc = (href) => {
  const u = new URL(href);
  const l = { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash };
  const hist = { replaced: null, replaceState(_s, _t, url) { this.replaced = url; const n = new URL(url, u.origin); l.search = n.search; l.hash = n.hash; } };
  return { l, hist };
};
/** A fake API from a table of path → { status?, json } (or a function of the request). */
function api(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const call = { path, body: init.body ? JSON.parse(init.body) : undefined, authed: !!(init.headers && init.headers.Authorization) };
    calls.push(call);
    const r = typeof routes[path] === 'function' ? routes[path](call) : routes[path];
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    if (r.offline) throw new Error('offline');
    const status = r.status || 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.json || {} };
  };
  return { calls, fetch };
}
const ME = { json: { user: { id: 7, display_name: 'Account Name', avatar_url: 'a.png', identities: { discord: { name: 'pete' } } } } };
function client(href, routes, stored = {}, extra = {}) {
  const { l, hist } = loc(href);
  const a = api(routes);
  const storage = store(stored);
  const c = new IdentityClient({ apiBase: 'https://api.test', fetch: a.fetch, storage, tabStorage: store(), location: l, history: hist, now: () => NOW,
    keys: { user: 'app.ht_user', token: 'app.ht_token' }, ...extra });
  return { c, a, storage, l, hist };
}

test('redeemHandoff: ?ht_code is taken off the address and swapped for a session, without sending the old one', async () => {
  const token = jwt({ sub: 7, lid: 1, via: 'discord:web' });
  const { c, a, storage, hist } = client('https://app.test/play?room=ABCD&ht_code=id.secret#top',
    { '/auth/handoff/redeem': { json: { token, user: { id: 7, name: 'Account Name', avatar: null, identities: {} } } } });
  assert.deepEqual(await c.redeemHandoff(), { signedIn: true });
  assert.equal(hist.replaced, '/play?room=ABCD#top', 'the code is gone, the rest of the address stays');
  assert.deepEqual(a.calls, [{ path: '/auth/handoff/redeem', body: { code: 'id.secret' }, authed: false }]);
  assert.equal(c.isSignedIn(), true);
  assert.equal(c.user.name, 'Account Name');
  assert.equal(storage.getItem('app.ht_token'), token);
  assert.equal(await c.redeemHandoff(), null, 'nothing left to redeem');
});

test('redeemHandoff: no code is null and makes no call', async () => {
  const { c, a } = client('https://app.test/play?room=ABCD', {});
  assert.equal(await c.redeemHandoff(), null);
  assert.equal(a.calls.length, 0);
});

test('redeemHandoff: a refused, expired or unreachable code leaves the session already here alone', async () => {
  const stored = jwt({ sub: 3, name: 'Stored' });
  for (const [route, error] of [
    [{ status: 410, json: { error: 'This sign-in link has expired' } }, 'This sign-in link has expired'],
    [{ json: { token: jwt({ sub: 7, exp: Math.floor(NOW / 1000) - 5 }) } }, 'This sign-in link has expired'],
    [{ json: {} }, 'This sign-in link has expired'],
    [{ offline: true }, 'offline'],
  ]) {
    const { c, storage, hist } = client('https://app.test/?ht_code=old.code', { '/auth/handoff/redeem': route }, { 'app.ht_token': stored });
    assert.deepEqual(await c.redeemHandoff(), { signedIn: false, error });
    assert.equal(hist.replaced, '/', 'the code still comes off the address');
    assert.equal(c.token, stored);
    assert.equal(storage.getItem('app.ht_token'), stored);
  }
});

test('resume(): an expired token in the address is refused and the stored session stays', async () => {
  const stored = jwt({ sub: 3, name: 'Stored' });
  const old = jwt({ sub: 7, exp: Math.floor(NOW / 1000) - 60 });
  const { c, a, storage, hist } = client('https://app.test/#ht_auth=' + old, { '/me': ME }, { 'app.ht_token': stored });
  assert.deepEqual(await c.resume(), { signedIn: false, expired: true });
  assert.equal(hist.replaced, '/', 'the token comes off the address');
  assert.equal(c.token, stored);
  assert.equal(storage.getItem('app.ht_token'), stored);
  assert.equal(a.calls.length, 0, 'the server is not asked about an expired token');
  // one that is still good signs in as before
  const good = jwt({ sub: 7, lid: 1 });
  const g = client('https://app.test/#ht_auth=' + good, { '/me': ME });
  assert.equal((await g.c.resume()).signedIn, true);
  assert.equal(g.c.user.name, 'Account Name');
});

test('a stored token with no stored profile is a session: the token names the player until refresh() reads the account', async () => {
  const token = jwt({ sub: 7, name: 'Token Name', picture: 'p.png', via: 'discord:web' });
  const { c, storage } = client('https://app.test/', { '/me': ME }, { 'app.ht_token': token });
  assert.equal(c.isSignedIn(), true);
  assert.equal(c.user.id, 7);
  assert.equal(c.user.name, 'Token Name');
  assert.equal(storage.getItem('app.ht_user'), null, 'nothing is written before the account is read');
  const u = await c.refresh();
  assert.equal(u.name, 'Account Name');
  assert.deepEqual(u.identities, { discord: { name: 'pete' } });
  assert.equal(JSON.parse(storage.getItem('app.ht_user')).name, 'Account Name');
  assert.equal(storage.getItem('app.ht_token'), token);
  // a second visit reads both
  const again = new IdentityClient({ apiBase: 'https://api.test', fetch: async () => { throw new Error('offline'); }, storage, tabStorage: store(), now: () => NOW, keys: { user: 'app.ht_user', token: 'app.ht_token' } });
  assert.equal(again.isSignedIn(), true);
  assert.equal(again.user.name, 'Account Name');
});

test('a stored token that cannot be read is not a session', () => {
  const { c } = client('https://app.test/', {}, { 'app.ht_token': 'not-a-token' });
  assert.equal(c.isSignedIn(), false);
  assert.equal(c.user, null);
});

test('forgetOn401: a token the server no longer takes ends the session; without the option it is kept', async () => {
  const token = jwt({ sub: 7, name: 'Pete' });
  const refused = { '/me': { status: 401, json: { error: 'Unauthorized' } } };
  const strict = client('https://app.test/', refused, { 'app.ht_token': token }, { forgetOn401: true });
  const reasons = [];
  strict.c.onChange((u, why) => reasons.push(why));
  assert.equal(await strict.c.refresh(), null);
  assert.equal(strict.c.meStatus, 401);
  assert.equal(strict.c.isSignedIn(), false);
  assert.equal(strict.storage.getItem('app.ht_token'), null);
  assert.equal(strict.storage.getItem('app.ht_user'), null);
  assert.ok(reasons.length >= 1, 'listeners hear the sign-out');

  const lenient = client('https://app.test/', refused, { 'app.ht_token': token });
  assert.equal(await lenient.c.refresh(), null);
  assert.equal(lenient.c.meStatus, 401);
  assert.equal(lenient.c.token, token, 'kept: the host decides');

  // offline and a server error never end a session, with the option or not
  for (const route of [{ offline: true }, { status: 500, json: {} }]) {
    const x = client('https://app.test/', { '/me': route }, { 'app.ht_token': token }, { forgetOn401: true });
    await x.c.refresh();
    assert.equal(x.c.token, token);
  }
});
