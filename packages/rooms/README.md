# @usersfirst/rooms

A two-seat room over a relay, with an optional PeerJS P2P upgrade. Opaque bytes in and out. Plain ESM, no imports, no build.

This is the first step of lab #137: Tandemonium's `js/net/room-transport.js` moved here unchanged in behaviour, with everything that belonged to the game passed in as options. Tandemonium vendors it into `shared/rooms/` (`npm run sync-rooms`) and its own `js/net/room-transport.js` is a small subclass that passes the game's settings.

## What it does

- Joins a room by code on a relay (a WebSocket per seat), and reconnects with backoff.
- Tries a PeerJS P2P upgrade when both seats are on the relay, and falls back to the relay when P2P drops. A second, unordered data channel carries high-rate traffic.
- Keeps the connection alive with its own HEARTBEAT frames (the one message type it understands).
- Places camera and microphone calls over P2P when the game allows media.
- Sends and receives bytes. It does not know what they mean.

## Use

```js
import { RoomTransport } from '@usersfirst/rooms';

class GameNet extends RoomTransport {
  constructor() {
    super({
      heartbeatType: 0x04,                       // the first byte of keepalive frames
      turnCredentialsUrl: 'https://relay.example/turn-credentials',
      peerjs: { host: 'peer.example', port: 443, path: '/', secure: true },
      deviceId: () => myDeviceId(),              // a reload gets its seat back
      mediaEnabled: false,
      codePrefix: 'GAME-',
      fastChannelLabel: 'game-fast',
      audioElement: () => document.getElementById('partner-audio'),
      onKeepalive: (roomCode) => {},             // every 5 minutes while the relay socket is held
    });
  }
}
```

Every option has a default, so `new RoomTransport()` works (relay only needs `_fallbackUrl` and a room; P2P without `turnCredentialsUrl` uses STUN only; with no `peerjs` the PeerJS library's own defaults apply).

## What is still Tandemonium-shaped

- The two seats are named `captain` and `stoker` on the wire, and `stoker` is the side that dials.
- The relay's JSON control messages (`waiting`, `partner-ready`, `disconnect`, room info) are the ones Tandemonium's relay Worker sends.
- P2P and media live in the same class as the relay client. #137 wants P2P as an optional module that only Tandemonium loads.
- The relay Worker itself is not here yet. It stays in Tandemonium (`worker/relay.js`) because it is tied to that game's seat proofs and deploy.

## Tests

`node --test` in this folder (no install): the relay socket lifecycle, the media gate, and each option.
