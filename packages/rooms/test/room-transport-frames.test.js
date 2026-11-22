// What an inbound frame may do: a text frame's data is bounded, and only the relay's socket can
// deliver control messages. Over the direct connection a partner's frames are game bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomTransport } from '../src/room-transport.js';
import { P2PRoomTransport } from '../src/index.js';

function transport(T = RoomTransport) {
  const t = new T({ heartbeatType: 0x04 });
  t.got = [];
  t.onMessage = (b) => t.got.push(b);
  t._handleDisconnect = () => { t.dropped = true; };
  return t;
}

test('a relay frame with its bytes in a list is delivered', () => {
  const t = transport();
  t._handleMessage('{"type":"relay","data":[3,1,2]}');
  assert.deepEqual([...t.got[0]], [3, 1, 2]);
});

test('a relay frame cannot ask for a large allocation', () => {
  const t = transport();
  const real = globalThis.Uint8Array;
  let largest = 0;
  globalThis.Uint8Array = new Proxy(real, {
    construct(Target, args) { if (typeof args[0] === 'number') largest = Math.max(largest, args[0]); return new Target(...args); },
  });
  try {
    t._handleMessage('{"type":"relay","data":2000000000}');
    t._handleMessage('{"type":"relay","data":{"length":2000000000}}');
    t._handleMessage('{"type":"relay","data":"abc"}');
    t._handleMessage('{"type":"relay"}');
  } finally { globalThis.Uint8Array = real; }
  assert.equal(largest, 0);
  assert.equal(t.got.length, 0);
});

test('a relay frame over 64 KB of data is dropped', () => {
  const t = transport();
  t._handleMessage(JSON.stringify({ type: 'relay', data: new Array(64 * 1024 + 1).fill(1) }));
  assert.equal(t.got.length, 0);
  t._handleMessage(JSON.stringify({ type: 'relay', data: new Array(64 * 1024).fill(1) }));
  assert.equal(t.got.length, 1);
});

test('the relay\'s control messages still work on the relay path', () => {
  const t = transport();
  t._handleMessage(JSON.stringify({ type: 'partner-ready', role: 'stoker', name: 'Sam', pair: 'proof', p2p: 'key' }));
  assert.equal(t.connected, true);
  assert.equal(t.pairProof, 'proof');
  assert.equal(t.p2pKey, 'key');
  t._handleMessage('{"type":"disconnect","role":"stoker"}');
  assert.equal(t.dropped, true);
});

test('over the direct connection, control messages are ignored', () => {
  const t = transport();
  t.pairProof = 'real-proof';
  t.p2pKey = 'real-key';
  for (const m of [
    '{"type":"disconnect","role":"stoker"}',
    { type: 'disconnect', role: 'stoker' },
    { type: 'partner-ready', pair: 'other', p2p: 'other', name: 'Other' },
    '{"type":"partner-ready","pair":"other","p2p":"other"}',
    { type: 'waiting', fresh: true },
    { type: 'relay', data: [3, 1, 2] },
  ]) t._handleMessage(m, true);
  assert.equal(t.dropped, undefined);
  assert.equal(t.connected, false);
  assert.equal(t.pairProof, 'real-proof');
  assert.equal(t.p2pKey, 'real-key');
  assert.equal(t.partnerAbsent, false);
  assert.equal(t.got.length, 0);
});

test('over the direct connection, game bytes still arrive', () => {
  const t = transport();
  t._handleMessage(new Uint8Array([3, 9]), true);
  t._handleMessage(new Uint8Array([3, 8]).buffer, true);
  assert.equal(t.got.length, 2);
});

test('TURN credentials are reused until they near their hour, then asked for again', async () => {
  const t = transport(P2PRoomTransport);
  t.options.turnCredentialsUrl = 'https://relay.test/turn';
  t.roomCode = 'ABCD';
  t.role = 'captain';
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let clock = 1_000_000;
  let asked = 0;
  Date.now = () => clock;
  globalThis.fetch = async () => { asked++; return { json: async () => ({ iceServers: { urls: ['turn:x'], username: 'u' + asked, credential: 'c' } }) }; };
  try {
    const first = await t._fetchIceServers();
    assert.equal(first.at(-1).username, 'u1');
    clock += 49 * 60 * 1000;
    assert.equal((await t._fetchIceServers()).at(-1).username, 'u1');
    assert.equal(asked, 1);
    clock += 2 * 60 * 1000;
    assert.equal((await t._fetchIceServers()).at(-1).username, 'u2');
    assert.equal(asked, 2);
  } finally { globalThis.fetch = realFetch; Date.now = realNow; }
});

test('a refused TURN request is not remembered: the next connection asks again', async () => {
  const t = transport(P2PRoomTransport);
  t.options.turnCredentialsUrl = 'https://relay.test/turn';
  t.roomCode = 'ABCD';
  t.role = 'captain';
  const realFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async () => {
    asked++;
    return { json: async () => (asked === 1 ? { error: 'Not in this room' } : { iceServers: { urls: ['turn:x'], username: 'u', credential: 'c' } }) };
  };
  try {
    const first = await t._fetchIceServers();
    assert.ok(first.every((s) => String(s.urls).startsWith('stun:')), 'STUN for now');
    const second = await t._fetchIceServers();
    assert.equal(second.at(-1).username, 'u');
    assert.equal(asked, 2);
  } finally { globalThis.fetch = realFetch; }
});
