// Each socket has a frame size limit and a message budget, the room's expiry is written at
// most once a minute, and a rider's frame can never read as one of the relay's control frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, relayFrame } from '../src/relay.js';

function room() {
  const socks = [];
  let alarms = 0;
  const state = {
    getWebSockets: (tag) => socks.filter((s) => !tag || s.tag === tag),
    getTags: (ws) => [ws.tag],
    storage: { setAlarm: async () => { alarms++; } },
  };
  const r = new Room(state, {});
  const add = (tag) => { const s = { tag, readyState: 1, sent: [], send(m) { this.sent.push(m); } }; socks.push(s); return s; };
  return { r, add, alarms: () => alarms };
}

function withClock(fn) {
  const real = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  const advance = (ms) => { t += ms; };
  return Promise.resolve(fn(advance)).finally(() => { Date.now = real; });
}

test('game frames are forwarded unchanged', async () => {
  const { r, add } = room();
  const cap = add('captain'), sto = add('stoker');
  const frame = new Uint8Array([3, 1, 2]);
  await r.webSocketMessage(cap, frame);
  assert.equal(sto.sent[0], frame);
  assert.equal(cap.sent.length, 0, 'not echoed');
});

test('a frame over 64 KB is dropped; one at the limit passes', async () => {
  const { r, add } = room();
  const cap = add('captain'), sto = add('stoker');
  await r.webSocketMessage(cap, new Uint8Array(64 * 1024 + 1));
  assert.equal(sto.sent.length, 0);
  await r.webSocketMessage(cap, new Uint8Array(64 * 1024));
  assert.equal(sto.sent.length, 1);
  await r.webSocketMessage(cap, new Uint8Array(0));
  assert.equal(sto.sent.length, 1, 'an empty frame carries nothing');
});

test("a rider's text cannot pose as the relay's control frames", async () => {
  const { r, add } = room();
  const cap = add('captain'), sto = add('stoker');
  for (const m of [
    '{"type":"disconnect","role":"captain"}',
    '{"type":"partner-ready","role":"captain","pair":"x","p2p":"y"}',
    '{"type":"waiting","fresh":true}',
    '{"type":"room-full"}',
    'not json', 'null', '7',
    '{"type":"relay","data":99999999}',
    '{"type":"relay","data":{"length":99999999}}',
  ]) await r.webSocketMessage(cap, m);
  assert.deepEqual(sto.sent, []);
});

test('the one text form riders used still passes, rebuilt with nothing extra', async () => {
  const { r, add } = room();
  const cap = add('captain'), sto = add('stoker');
  await r.webSocketMessage(cap, '{"type":"relay","data":[3,1,2],"pair":"extra"}');
  assert.deepEqual(JSON.parse(sto.sent[0]), { type: 'relay', data: [3, 1, 2] });
  assert.equal(relayFrame('{"type":"relay","data":[' + '1,'.repeat(40000) + '1]}'), null, 'text has the size limit too');
});

test('a socket over its message budget is dropped; a real ride is not', () => withClock(async (advance) => {
  const { r, add } = room();
  const cap = add('captain'), sto = add('stoker');
  for (let i = 0; i < 1000; i++) await r.webSocketMessage(cap, new Uint8Array([1]));
  assert.equal(sto.sent.length, 480, 'the burst, then nothing');

  const other = add('stoker');
  for (let i = 0; i < 480; i++) await r.webSocketMessage(other, new Uint8Array([1]));
  assert.equal(cap.sent.length, 480, 'each socket has its own budget');

  // A busy ride: a hundred frames a second for a minute.
  const a = room();
  const rider = a.add('captain'), partner = a.add('stoker');
  let sent = 0;
  for (let ms = 0; ms < 60_000; ms += 10) {
    advance(10);
    await a.r.webSocketMessage(rider, new Uint8Array([1])); sent++;
  }
  assert.equal(partner.sent.length, sent, 'a hundred frames a second all get through');
}));

test('the expiry is refreshed at most once a minute', () => withClock(async (advance) => {
  const { r, add, alarms } = room();
  const cap = add('captain');
  add('stoker');
  for (let i = 0; i < 100; i++) { await r.webSocketMessage(cap, new Uint8Array([1])); advance(100); }
  assert.equal(alarms(), 1, 'ten seconds of traffic: one write');
  advance(60_000);
  await r.webSocketMessage(cap, new Uint8Array([1]));
  assert.equal(alarms(), 2);
}));
