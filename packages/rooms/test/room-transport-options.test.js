// @usersfirst/rooms — what a game passes in (lab #137). Everything that used to be Tandemonium's
// own inside the transport is an option; these tests pin each one and its default.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MediaRoomTransport as RoomTransport } from '../src/index.js';

let sockets;
class FakeWS {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  close() { this.readyState = 3; }
  send(b) { this.sent.push(b); }
}
beforeEach(() => { sockets = []; globalThis.WebSocket = FakeWS; });

function transport(options) {
  const t = new RoomTransport(options);
  t._fallbackUrl = 'wss://relay.test/room';
  t._attemptP2PUpgrade = () => {};
  return t;
}

test('no options: a transport still constructs, with media off and heartbeat type 0x04', () => {
  const t = new RoomTransport();
  assert.equal(t.mediaEnabled, false);
  assert.equal(t._hb, 0x04);
  t.destroy();
});

test('deviceId: sent to the relay as &device=, URL-encoded; absent or throwing means no parameter', () => {
  let t = transport({ deviceId: () => 'dev 1&x' });
  t.enterRoom('ABCD', 'captain');
  assert.match(sockets[0].url, /^wss:\/\/relay\.test\/room\?room=ABCD&role=captain&device=dev%201%26x$/);
  t.destroy();

  t = transport();
  t.enterRoom('ABCD', 'stoker');
  assert.equal(sockets[1].url, 'wss://relay.test/room?room=ABCD&role=stoker');
  t.destroy();

  t = transport({ deviceId: () => { throw new Error('storage blocked'); } });
  t.enterRoom('ABCD', 'stoker');
  assert.equal(sockets[2].url, 'wss://relay.test/room?room=ABCD&role=stoker');
  t.destroy();
});

test('codePrefix: generateRoomCode() is the prefix plus 4 unambiguous characters', () => {
  assert.match(new RoomTransport({ codePrefix: 'TNDM-' }).generateRoomCode(), /^TNDM-[A-HJ-NP-Z2-9]{4}$/);
  assert.match(new RoomTransport().generateRoomCode(), /^[A-HJ-NP-Z2-9]{4}$/);
});

test('heartbeatType: the game chooses the keepalive byte; other first bytes reach onMessage', () => {
  const t = new RoomTransport({ heartbeatType: 0x7f });
  const got = [], sent = [];
  t.onMessage = (b) => got.push(Array.from(b));
  t._send = (b) => sent.push(Array.from(b));
  t._handleMessage(new Uint8Array([0x7f, 0x00]));          // a ping: answered, not surfaced
  t._handleMessage(new Uint8Array([0x04, 0x09]));          // 0x04 is game data for this game
  assert.deepEqual(sent, [[0x7f, 0x01]]);
  assert.deepEqual(got, [[0x04, 0x09]]);
  assert.deepEqual(Array.from(t._fastHello), [0x7f, 0x03]);
  t.destroy();
});

test('mediaEnabled: off unless the game says so', () => {
  assert.equal(new RoomTransport({ mediaEnabled: true }).mediaEnabled, true);
  assert.equal(new RoomTransport({ mediaEnabled: 0 }).mediaEnabled, false);
});

test('audioElement: the partner voice plays where the game says, and is released on disconnect', () => {
  const el = { srcObject: null, played: 0, play() { this.played++; return Promise.resolve(); } };
  const t = new RoomTransport({ audioElement: () => el });
  const stream = { getAudioTracks: () => [{}] };
  t._playRemoteAudio(stream);
  assert.equal(el.srcObject, stream);
  assert.equal(el.played, 1);
  // no audio track: nothing to play
  let asked = 0;
  const t2 = new RoomTransport({ audioElement: () => { asked++; return el; } });
  t2._playRemoteAudio({ getAudioTracks: () => [] });
  assert.equal(asked, 0, 'the element is not asked for when there is nothing to play');
  // no element option: a stream with audio is ignored, not an error
  new RoomTransport()._playRemoteAudio(stream);
  t.destroy();
  assert.equal(el.srcObject, null, 'released when the transport is destroyed');
  t2.destroy();
});

test('turnCredentialsUrl: without it the P2P upgrade uses the default STUN servers and fetches nothing', async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return { json: async () => ({}) }; };
  try {
    const t = new RoomTransport();
    const servers = await t._fetchIceServers();
    assert.equal(fetched, 0);
    assert.ok(Array.isArray(servers) && servers.length > 0 && servers.every((s) => String(s.urls).startsWith('stun:')));
    t.destroy();

    const t2 = new RoomTransport({ turnCredentialsUrl: 'https://relay.test/turn', deviceId: () => 'd1' });
    t2.roomCode = 'ABCD'; t2.role = 'captain'; t2.p2pKey = 'room-key';
    let asked = null;
    globalThis.fetch = async (u) => { asked = u; return { json: async () => ({ iceServers: { urls: ['turn:t.test'], username: 'u', credential: 'c' } }) }; };
    const s2 = await t2._fetchIceServers();
    assert.equal(asked, 'https://relay.test/turn?room=ABCD&role=captain&key=room-key', 'the proof is the room key, not the device id');
    assert.ok(s2.some((s) => JSON.stringify(s).includes('turn:t.test')));
    t2.destroy();
  } finally { globalThis.fetch = realFetch; }
});

test('onKeepalive: the 5-minute tick pings the relay with the heartbeat byte and calls the game hook', () => {
  const realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval;
  const ticks = [];
  globalThis.setInterval = (fn, ms) => { ticks.push({ fn, ms }); return ticks.length; };
  globalThis.clearInterval = () => {};
  try {
    const seen = [];
    const t = transport({ heartbeatType: 0x21, onKeepalive: (code) => { seen.push(code); throw new Error('a hook error is not ours'); } });
    t.enterRoom('ABCD', 'captain');
    sockets[0].open();
    t._startRelayKeepalive();
    const tick = ticks.filter((x) => x.ms === 5 * 60 * 1000).pop();
    assert.ok(tick, 'a 5-minute interval was set');
    sockets[0].sent.length = 0;
    assert.doesNotThrow(() => tick.fn());
    assert.deepEqual(seen, ['ABCD']);
    assert.deepEqual(sockets[0].sent.map((b) => Array.from(b)), [[0x21, 0x02]]);
    t.destroy();
  } finally { globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; }
});
