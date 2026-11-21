// @usersfirst/rooms-relay — what a game sets in env (lab #137): the room-code pattern, the
// Durable Object binding, the allowed origins and the relay's name.
import test from 'node:test';
import assert from 'node:assert/strict';
import relay, { isRoomCode, allowedOrigins } from '../src/relay.js';

const req = (url, { method = 'GET', origin = '' } = {}) => ({ url, method, headers: new Map(origin ? [['Origin', origin]] : []) });
/** A Durable Object namespace that records what it was asked for. */
function rooms(log) {
  return { idFromName: (name) => ({ name }), get: (id) => ({ fetch: async () => { log.push(id.name); return new Response('{"ok":true}', { status: 200 }); } }) };
}

test('room codes: the default is 4 to 16 of A-Z, 0-9 and "-"; a game narrows it with ROOM_CODE_PATTERN', () => {
  assert.ok(isRoomCode('ABCD') && isRoomCode('TNDM-AB2C') && isRoomCode('SAND-1234-XY'));
  assert.ok(!isRoomCode('abc') && !isRoomCode('AB') && !isRoomCode('A'.repeat(17)) && !isRoomCode('AB CD') && !isRoomCode(null) && !isRoomCode(1234));
  const tndm = '^TNDM-[A-Z0-9]{4}$';
  assert.ok(isRoomCode('TNDM-AB2C', tndm));
  assert.ok(!isRoomCode('ABCD', tndm) && !isRoomCode('TNDM-ABCDE', tndm) && !isRoomCode('anything', tndm));
  assert.equal(isRoomCode('ABCD', '('), false, 'a pattern that does not compile accepts nothing');
});

test('the Worker refuses a code outside the pattern before it reaches a room', async () => {
  const log = [];
  const env = { ROOM: rooms(log), ROOM_CODE_PATTERN: '^TNDM-[A-Z0-9]{4}$' };
  assert.equal((await relay.fetch(req('https://relay/?room=ABCD&role=captain'), env)).status, 400);
  assert.equal((await relay.fetch(req('https://relay/turn-credentials?room=ABCD&role=captain'), env)).status, 403);
  assert.deepEqual(log, []);
  assert.equal((await relay.fetch(req('https://relay/?room=TNDM-AB2C&role=captain'), env)).status, 200);
  assert.deepEqual(log, ['TNDM-AB2C']);
});

test('ROOM_BINDING names the Durable Object binding (default ROOM)', async () => {
  const a = [], b = [];
  await relay.fetch(req('https://relay/?room=ABCD&role=captain'), { ROOM: rooms(a) });
  await relay.fetch(req('https://relay/?room=ABCD&role=captain'), { ROOM_BINDING: 'TANDEM_ROOM', TANDEM_ROOM: rooms(b), ROOM: null });
  assert.deepEqual([a, b], [['ABCD'], ['ABCD']]);
});

test('RELAY_NAME is the word in the health line', async () => {
  assert.equal(await (await relay.fetch(req('https://relay/'), {})).text(), 'Rooms Relay OK');
  assert.equal(await (await relay.fetch(req('https://relay/'), { RELAY_NAME: 'Tandemonium' })).text(), 'Tandemonium Relay OK');
});

test('CORS: an allowed origin is echoed, localhost always, anything else gets the first allowed origin', async () => {
  const env = { ALLOWED_ORIGINS: 'https://game.example, https://old.example' };
  assert.deepEqual(allowedOrigins(env), ['https://game.example', 'https://old.example']);
  const acao = async (origin, e = env) => (await relay.fetch(req('https://relay/', { method: 'OPTIONS', origin }), e)).headers.get('Access-Control-Allow-Origin');
  assert.equal(await acao('https://old.example'), 'https://old.example');
  assert.equal(await acao('http://localhost:8080'), 'http://localhost:8080');
  assert.equal(await acao('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(await acao('https://evil.example'), 'https://game.example');
  assert.equal(await acao('https://evil.example', {}), 'null', 'no list: no outside origin is allowed');
});
