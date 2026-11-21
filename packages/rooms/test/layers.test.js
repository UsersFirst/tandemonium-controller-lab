// @usersfirst/rooms — the three layers (lab #137): the relay alone, + P2P, + camera/mic.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoomTransport, withP2P, withMedia, P2PRoomTransport, MediaRoomTransport } from '../src/index.js';

let sockets, peers;
class FakeWS {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  close() { this.readyState = 3; }
  send(b) { this.sent.push(b); }
}
class FakePeer {
  constructor(id) { this.id = id; this.handlers = {}; this.destroyed = false; peers.push(this); }
  on(ev, fn) { this.handlers[ev] = fn; }
  destroy() { this.destroyed = true; }
}
const realWindow = globalThis.window;
beforeEach(() => { sockets = []; peers = []; globalThis.WebSocket = FakeWS; globalThis.window = { Peer: FakePeer, addEventListener() {}, removeEventListener() {} }; });
afterEach(() => { if (realWindow === undefined) delete globalThis.window; else globalThis.window = realWindow; });

const ready = JSON.stringify({ type: 'partner-ready', p2p: 'k1' });
function inRoom(t) {
  t._fallbackUrl = 'wss://relay.test/room';
  t.enterRoom('ABCD', 'captain');
  sockets.at(-1).open();
  sockets.at(-1).onmessage({ data: ready });
  return t;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('the relay alone: both seats ready connects, and no Peer is ever made (PeerJS on the page or not)', async () => {
  const t = inRoom(new RoomTransport());
  await tick();
  assert.equal(t.connected, true);
  assert.equal(t.transport, 'relay');
  assert.equal(peers.length, 0);
  assert.equal('peer' in t, false, 'the relay holds no P2P state');
  assert.equal(typeof t.initiateCall, 'undefined', 'and no media calls');
  // sends go to the relay, on both lanes
  sockets[0].sent.length = 0;
  t._send(new Uint8Array([9, 1]));
  t._sendFast(new Uint8Array([9, 2]));
  assert.deepEqual(sockets[0].sent.map((b) => Array.from(b)), [[9, 1], [9, 2]]);
  t.destroy();
  assert.equal(sockets[0].readyState, 3);
});

test('with P2P: both seats ready starts the upgrade with the keyed peer id', async () => {
  const t = inRoom(new P2PRoomTransport());
  await tick(); await tick();
  assert.equal(peers.length, 1);
  assert.equal(peers[0].id, 'ABCD-k1-captain');
  assert.equal(t.transport, 'relay', 'still on the relay until the direct connection opens');
  t.destroy();
  assert.equal(peers[0].destroyed, true);
  assert.equal(t.peer, null);
});

test('with P2P but no media layer: a media call that arrives is closed, never answered', async () => {
  const t = inRoom(new P2PRoomTransport());
  await tick(); await tick();
  const call = { closed: false, answered: false, close() { this.closed = true; }, answer() { this.answered = true; }, on() {} };
  peers[0].handlers.call(call);
  assert.equal(call.closed, true);
  assert.equal(call.answered, false);
  assert.equal(typeof t.acquireLocalMedia, 'undefined');
  t.destroy();
});

test('with media: off unless the game says so; on, an incoming call is answered', async () => {
  const off = inRoom(new MediaRoomTransport());
  await tick(); await tick();
  const c1 = { closed: false, answered: false, close() { this.closed = true; }, answer() { this.answered = true; }, on() {} };
  peers[0].handlers.call(c1);
  assert.equal(c1.closed && !c1.answered, true, 'mediaEnabled defaults to off');
  off.destroy();

  const on = inRoom(new MediaRoomTransport({ mediaEnabled: true }));
  await tick(); await tick();
  const c2 = { closed: false, answered: false, close() { this.closed = true; }, answer() { this.answered = true; }, on() {} };
  peers.at(-1).handlers.call(c2);
  assert.equal(c2.answered, true);
  on.destroy();
  assert.equal(c2.closed, true, 'destroy closes the call');
});

test('the mixins compose on a game class of its own', () => {
  class Base extends RoomTransport { hello() { return 'hi'; } }
  const Net = withMedia(withP2P(Base));
  const t = new Net({ heartbeatType: 0x33, mediaEnabled: true });
  assert.equal(t.hello(), 'hi');
  assert.equal(t._hb, 0x33);
  assert.deepEqual(Array.from(t._fastHello), [0x33, 0x03]);
  assert.equal(t.mediaEnabled, true);
  assert.ok(t instanceof Base && t instanceof RoomTransport);
  t.destroy();
});
