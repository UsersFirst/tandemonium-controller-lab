// IdentityClient against a fake of the House Tandem account API. The fake follows the real
// server's rules (Tandemonium worker/accounts/): a link needs a fresh sign-in, only the tab
// that began a link can finish it, a login with its own account asks before combining.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityClient, takeRedirect, decodeToken, loginPictures } from '../src/client.js';

const jwt = (claims) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}.sig`;
};
const store = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const loc = (href) => {
  const u = new URL(href);
  const l = { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assigned: null, assign(x) { this.assigned = x; } };
  const hist = { replaced: null, replaceState(_s, _t, url) { this.replaced = url; l.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } };
  return { l, hist };
};

/** A fake API. `state` is what a test steers. */
function fakeApi(state = {}) {
  const s = { calls: [], fresh: true, hasAccount: false, polls: 0, account: { id: 7, name: 'Pete', logins: { discord: { name: 'Pete', avatar: 'd.png' } } }, notices: [], ...state };
  const user = () => ({ id: s.account.id, name: s.account.name, avatar: null, identities: s.account.logins });
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    const authed = !!(init.headers && init.headers.Authorization);
    s.calls.push({ path, body, authed });
    if (path === '/auth/discord/begin' || path === '/auth/steam/begin') {
      if (authed && !s.fresh) return json(401, { error: 'For your safety, sign in again before linking another account.', code: 'fresh_signin' });
      return json(200, { id: 'req1', secret: 'tab-secret', code: body.mode === 'device' ? 'K7QF' : null, url: 'https://api.test/auth/go?r=req1', expires_in: 600 });
    }
    if (path === '/auth/poll') {
      s.polls++;
      if (s.pollAnswer) return json(200, s.pollAnswer(s.polls));
      if (s.polls < 2) return json(200, { status: 'pending' });
      if (s.polls < 3) return json(200, { status: 'confirming' });
      return json(200, { status: 'done', token: jwt({ sub: 7, lid: 1 }), user: user(), linked: !!s.linkedDevice, merged: false });
    }
    if (path === '/auth/link/complete') {
      if (body.secret !== 'tab-secret' || !authed) return json(410, { error: 'This link has expired or was started somewhere else.', code: 'link_gone' });
      if (s.hasAccount) {
        return json(200, { status: 'combine', provider: 'steam', into: { name: 'Pete', logins: [{ provider: 'discord' }], rides: 2, badges: 3 },
          other: { name: 'pete_steam', logins: [{ provider: 'steam' }], rides: 10, badges: 5, games: [{ game: 'coins', title: 'Carnival Dozer', badges: 1 }] } });
      }
      s.account.logins.steam = { name: 'pete_steam', avatar: 's.png' };
      return json(200, { status: 'linked', token: jwt({ sub: 7, lid: 1 }), user: user() });
    }
    if (path === '/auth/link/combine') {
      if (body.secret !== 'tab-secret') return json(410, { error: 'gone' });
      if (!body.ok) return json(200, { status: 'cancelled' });
      s.account.logins.steam = { name: 'pete_steam', avatar: 's.png' };
      return json(200, { status: 'combined', token: jwt({ sub: 7, lid: 1 }), user: user() });
    }
    if (path === '/auth/steam') {
      s.fresh = true;
      return json(200, { token: jwt({ sub: 9, lid: 2 }), user: { id: 9, name: 'pete_steam', avatar: 's.png', identities: { steam: { name: 'pete_steam', avatar: 's.png' } } } });
    }
    if (path === '/me') {
      if (!authed) return json(401, { error: 'Unauthorized' });
      if (s.gone) return json(401, { error: 'Account not found', code: 'account_gone' });
      return json(200, { user: { id: s.account.id, display_name: s.account.name, avatar_url: null, identities: s.account.logins }, achievements: [] });
    }
    if (path === '/me/notices') return json(200, { notices: s.notices });
    if (path === '/me/notices/seen') { s.notices = s.notices.map((n) => (n.id === body.id ? { ...n, seen: true } : n)); return json(200, { ok: true }); }
    if (path === '/me/notices/undo') {
      const n = s.notices.find((x) => x.id === body.id);
      if (!n) return json(410, { error: 'This can no longer be undone.' });
      s.notices = s.notices.filter((x) => x.id !== body.id);
      delete s.account.logins.steam;
      return json(200, { undone: true, kind: n.kind, signed_out: !!s.undoSignsOut });
    }
    return json(404, {});
  };
  return { s, fetch };
}

function client(api, extra = {}) {
  const storage = store(), tab = store();
  const c = new IdentityClient({ apiBase: 'https://api.test/', fetch: api.fetch, storage, tabStorage: tab, deviceId: () => 'device-1', ...extra });
  return { c, storage, tab };
}
const timers = () => {
  const real = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const list = [];
  globalThis.setTimeout = (fn) => { const t = { fn, done: false }; list.push(t); return t; };
  globalThis.clearTimeout = (t) => { if (t) t.done = true; };
  return { restore() { globalThis.setTimeout = real; globalThis.clearTimeout = realClear; }, async run() { for (const t of list.splice(0)) if (!t.done) { t.done = true; await t.fn(); } } };
};

test('takeRedirect reads the sign-in or the link, and cleans the URL; decodeToken reads claims', () => {
  const a = loc('https://game.test/play?x=1#ht_auth=' + encodeURIComponent(jwt({ sub: 7 })) + '&ht_server=joined&keep=me');
  const back = takeRedirect(a.l, a.hist);
  assert.equal(decodeToken(back.token).sub, 7);
  assert.equal(back.server, 'joined');
  assert.equal(a.hist.replaced, '/play?x=1#keep=me');
  const b = loc('https://site.test/account.html#ht_link=req1.code.with.dots&ht_steam=has_account');
  assert.deepEqual(takeRedirect(b.l, b.hist), { link: { id: 'req1', code: 'code.with.dots' }, steam: 'has_account' });
  assert.equal(takeRedirect(loc('https://site.test/#other=1').l, {}), null);
  assert.equal(decodeToken('junk'), null);
  assert.deepEqual(loginPictures({ identities: { steam: { avatar: 's' }, discord: { avatar: 'd' } } }).map((p) => p.provider), ['discord', 'steam']);
});

test('redirect sign-in: begins without a session, goes to the provider, and resume() signs in', async () => {
  const api = fakeApi();
  const { l, hist } = loc('https://game.test/play');
  const { c, storage } = client(api, { location: l, history: hist });
  const seen = [];
  c.onChange((u, why) => seen.push([u && u.id, why]));
  await c.signInRedirect('discord', { joinServer: true, scopes: ['email'] });
  assert.equal(l.assigned, 'https://api.test/auth/go?r=req1');
  assert.deepEqual(api.s.calls[0], { path: '/auth/discord/begin', authed: false,
    body: { device_id: 'device-1', mode: 'redirect', join_server: true, scopes: ['email'], return_to: 'https://game.test/play' } });

  l.hash = '#ht_auth=' + encodeURIComponent(jwt({ sub: 7, lid: 1, via: 'discord:80' }));
  assert.deepEqual(await c.resume(), { signedIn: true, server: undefined, steam: undefined });
  assert.equal(c.isSignedIn(), true);
  assert.equal(c.user.id, 7);
  assert.equal(c.user.provider, 'discord');
  assert.equal(c.claims().lid, 1, 'the session is a login');
  assert.deepEqual(seen, [[7, 'signin']]);
  assert.ok(storage.m.get('ht_auth_token'));
  assert.equal(await c.resume(), null, 'nothing left in the URL');

  // A new page load finds the stored session.
  const again = new IdentityClient({ apiBase: 'https://api.test', fetch: api.fetch, storage, tabStorage: store() });
  assert.equal(again.isSignedIn(), true);
  assert.equal(again.hasLogin('discord'), true);
  assert.equal(again.tokenExpired(), false);
});

test('linking: only the tab that began it can finish; the session is the same player afterwards', async () => {
  const api = fakeApi();
  const { l, hist } = loc('https://site.test/account.html');
  const { c, tab } = client(api, { location: l, history: hist });
  c.apply(jwt({ sub: 7, lid: 1 }), { id: 7, name: 'Pete', identities: { discord: { name: 'Pete' } } }, { provider: 'discord', favourite: 'goose' });
  await c.linkRedirect('steam');
  assert.equal(api.s.calls.at(-1).authed, true, 'a link begins with the session');
  assert.ok(tab.m.get('ht_link_pending').includes('tab-secret'));

  // Another tab (no secret) coming back with the same link gets nowhere.
  const other = client(api, { location: loc('https://site.test/account.html#ht_link=req1.c0de').l, history: {} });
  other.c.apply(jwt({ sub: 7, lid: 1 }), { id: 7, name: 'Pete', identities: {} });
  assert.equal((await other.c.resume()).link, 'failed');
  assert.ok(!api.s.calls.some((x) => x.path === '/auth/link/complete'), 'it never even asks the server');

  l.hash = '#ht_link=req1.c0de';
  const res = await c.resume();
  assert.equal(res.link, 'linked');
  assert.deepEqual(api.s.calls.at(-1).body, { id: 'req1', code: 'c0de', secret: 'tab-secret' });
  assert.equal(c.hasLogin('steam'), true);
  assert.equal(c.user.favourite, 'goose', 'what the game stored about the player stays');
  assert.equal(tab.m.has('ht_link_pending'), false);
});

test('a link needs a fresh sign-in: reauth is tried once; without it the error says so', async () => {
  const api = fakeApi({ fresh: false });
  const { l } = loc('https://site.test/account.html');
  const web = client(api, { location: l }).c;
  web.apply(jwt({ sub: 7 }), { id: 7, name: 'Pete', identities: {} });
  await assert.rejects(web.linkRedirect('steam'), (e) => e.fresh === true && e.code === 'fresh_signin');
  assert.equal(l.assigned, null, 'it did not leave the page');

  // The Steam build signs in again by ticket, quietly, and the link begins.
  const api2 = fakeApi({ fresh: false });
  const changes = [];
  const game = client(api2, { reauth: () => game.signInWith('/auth/steam', { steamId: '76', ticket: 't' }, { provider: 'steam', quiet: true }) }).c;
  game.apply(jwt({ sub: 9 }), { id: 9, name: 'pete_steam', identities: {} }, { provider: 'steam', tuning: 1 });
  game.onChange((_u, why) => changes.push(why));
  const t = timers();
  try {
    const dev = await game.startDevice({ link: true });
    assert.equal(dev.code, 'K7QF');
    assert.deepEqual(api2.s.calls.map((x) => x.path), ['/auth/discord/begin', '/auth/steam', '/auth/discord/begin']);
    assert.deepEqual(changes, ['fresh'], 'a quiet re-sign-in is not a new sign-in');
    assert.equal(game.user.tuning, 1);
    game.cancelDevice();
  } finally { t.restore(); }
});

test('the combine question: both accounts come back; nothing combines until yes', async () => {
  const api = fakeApi({ hasAccount: true });
  const { l, hist } = loc('https://site.test/account.html');
  const { c } = client(api, { location: l, history: hist });
  c.apply(jwt({ sub: 7 }), { id: 7, name: 'Pete', identities: { discord: {} } });
  await c.linkRedirect('steam');
  l.hash = '#ht_link=req1.c0de';
  const q = await c.resume();
  assert.equal(q.link, 'combine');
  assert.equal(q.other.name, 'pete_steam');
  assert.equal(q.into.name, 'Pete');
  assert.equal(c.hasLogin('steam'), false);
  assert.deepEqual(await c.combine(q.id, true), { status: 'combined' });
  assert.equal(c.hasLogin('steam'), true);
  assert.ok((await c.combine(q.id, true)).error, 'single use');

  const api2 = fakeApi({ hasAccount: true });
  const b = loc('https://site.test/account.html');
  const no = client(api2, { location: b.l, history: b.hist }).c;
  no.apply(jwt({ sub: 7 }), { id: 7, name: 'Pete', identities: { discord: {} } });
  await no.linkRedirect('steam');
  b.l.hash = '#ht_link=req1.c0de';
  const q2 = await no.resume();
  assert.deepEqual(await no.combine(q2.id, false), { status: 'cancelled' });
  assert.equal(no.hasLogin('steam'), false);
});

test('device sign-in: QR and code, "confirming" while they type it, then signed in', async () => {
  const api = fakeApi();
  const { c } = client(api);
  const t = timers();
  try {
    const statuses = [];
    let done = null;
    const handlers = { onStatus: (s) => statuses.push(s), onDone: (u, info) => { done = { u, info }; } };
    const dev = await c.startDevice(handlers);
    assert.equal(dev.url, 'https://api.test/auth/go?r=req1');
    assert.equal(dev.code, 'K7QF');
    assert.equal(api.s.calls[0].authed, false);
    assert.equal(await c.startDevice(handlers), dev, 'one at a time: the same code while it is live');
    assert.equal(api.s.calls.length, 1, 'no second request');
    await t.run(); await t.run(); await t.run();
    assert.deepEqual(statuses, ['pending', 'confirming']);
    assert.equal(done.u.id, 7);
    assert.deepEqual(done.info, { linked: false, merged: false });
    assert.equal(c.user.provider, 'discord');
    assert.ok(!api.s.calls.find((x) => x.path === '/auth/poll').authed, 'the poll carries only the request secret');
  } finally { t.restore(); }
});

test('device sign-in ends with the reason: cancelled, expired, or the Discord has its own account', async () => {
  for (const [answer, error] of [[{ status: 'error', error: 'cancelled' }, 'cancelled'], [{ status: 'expired' }, 'expired'], [{ status: 'error', error: 'has_account' }, 'has_account']]) {
    const api = fakeApi({ pollAnswer: () => answer });
    const { c } = client(api);
    const t = timers();
    try {
      let done = null;
      await c.startDevice({ onDone: (u, info) => { done = { u, info }; } });
      await t.run();
      assert.deepEqual(done, { u: null, info: { error } });
      assert.equal(c.isSignedIn(), false);
    } finally { t.restore(); }
  }
});

test('notices: read, "that was me", undo; an undo that takes the session’s own login says so', async () => {
  const notice = { id: 5, kind: 'link', provider: 'steam', login_name: 'pete_steam', from_name: null, created_at: 1794700000, undo_until: 1795300000, seen: false };
  const api = fakeApi({ notices: [notice] });
  const { c } = client(api);
  assert.deepEqual(await c.notices(), [], 'signed out: none');
  c.apply(jwt({ sub: 7, lid: 1 }), { id: 7, name: 'Pete', identities: { discord: {}, steam: {} } });
  api.s.account.logins.steam = { name: 'pete_steam' };
  assert.equal((await c.notices())[0].id, 5);
  await c.seen(5);
  assert.equal((await c.notices())[0].seen, true);
  const out = await c.undo(5);
  assert.equal(out.undone, true);
  assert.equal(c.hasLogin('steam'), false, 'the account is re-read after an undo');
  assert.ok((await c.undo(5)).error);

  const api2 = fakeApi({ notices: [{ ...notice, kind: 'combine' }], undoSignsOut: true });
  const two = client(api2).c;
  two.apply(jwt({ sub: 7, lid: 2 }), { id: 7, name: 'Pete', identities: { steam: {} } });
  const calls = api2.s.calls.length;
  assert.equal((await two.undo(5)).signed_out, true);
  assert.equal(api2.s.calls.length, calls + 1, 'no re-read: the game signs in again instead');
});

test('an account that is gone: the token is dropped; signOut clears everything', async () => {
  const api = fakeApi({ gone: true });
  const { c, storage } = client(api);
  const why = [];
  c.onChange((_u, r) => why.push(r));
  c.apply(jwt({ sub: 7 }), { id: 7, name: 'Pete', identities: {} });
  assert.equal(await c.refresh(), null);
  assert.equal(c.token, null);
  assert.ok(c.user, 'the profile stays, for signing in again as the same player');
  assert.deepEqual(why, ['signin', 'gone']);
  c.signOut();
  assert.equal(c.user, null);
  assert.equal(storage.m.size, 0);
  assert.throws(() => new IdentityClient({}), /apiBase/);
});
