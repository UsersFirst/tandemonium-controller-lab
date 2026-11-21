# @usersfirst/rooms-relay

The room relay for `@usersfirst/rooms`: a Cloudflare Worker and Durable Object. One Durable Object per room code holds the two seats' WebSockets and forwards frames between them. Plain ESM, no build.

Lifted from Tandemonium's `worker/relay.js` (lab #137) with its behaviour unchanged. What was Tandemonium's own is read from `env`.

## What it does

- **Seats.** Each seat (`captain`, `stoker`) belongs to the first connection that takes it: an account (a valid relay token) or, for a guest, the device it dialled from. While the seat is held, and for 10 minutes after it leaves, only that account or device may take it again. Anyone else is told the room is full.
- **Frames.** Binary frames from one seat go to the other, unread.
- **Control messages** (JSON) to the client: `waiting` (with what the room remembers), `partner-ready` (with the partner's name, a pair proof and the room's P2P key), `disconnect`.
- **Pair proof** (`room-proof.js`): with both seats taken the room signs who rode, for a game's score posts.
- **TURN credentials** (`/turn-credentials`): only for a connection that holds a seat.
- **Room memory.** When it was last used and when each seat was last there, for a week.

## Deploy it from a game

The game's Worker entry exports the Durable Object class under the name its `wrangler.toml` already uses, and passes its settings:

```js
// worker/relay.js
import relay, { Room } from '@usersfirst/rooms-relay';

const SETTINGS = {
  ROOM_BINDING: 'GAME_ROOM',
  ROOM_CODE_PATTERN: '^GAME-[A-Z0-9]{4}$',
  ALLOWED_ORIGINS: 'https://game.example',
  RELAY_NAME: 'Game',
};

export class GameRoom extends Room {}
export default {
  fetch(request, env, ctx) {
    const e = Object.create(env);                       // wrangler vars win over these defaults
    for (const k of Object.keys(SETTINGS)) if (env[k] === undefined) e[k] = SETTINGS[k];
    return relay.fetch(request, e, ctx);
  },
};
```

## env

| Name | What |
|---|---|
| `ROOM_BINDING` | name of the Durable Object binding (default `ROOM`) |
| `ROOM_CODE_PATTERN` | a regular expression's source for the room codes accepted (default: 4 to 16 of A-Z, 0-9 and `-`) |
| `ALLOWED_ORIGINS` | comma-separated CORS origins; the first is the fallback. `localhost` and `127.0.0.1` are always allowed |
| `RELAY_NAME` | the word in the health line (`<name> Relay OK`) |
| `RELAY_SECRET` | signs relay tokens, guest keys and pair proofs (a secret) |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | Cloudflare TURN |
| `ANALYTICS` | optional Analytics Engine dataset |
| `RELAY_IP_LIMITER` | optional rate-limit binding, per IP |

## Still to do (lab #137)

- More than two seats, and seat names other than `captain` and `stoker`.
- SandHands and the Discord Activities deploying this instead of their own relays.

## Tests

`node --test` in this folder (no install): seats, room memory, close notices, and each `env` setting.
