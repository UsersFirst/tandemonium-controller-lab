# @usersfirst/rooms

A two-seat room over a relay. Opaque bytes in and out. Plain ESM, no build.

Three layers, each its own file, so a game loads only what it uses (lab #137):

| Import | What it adds |
|---|---|
| `RoomTransport` (`./room-transport`) | Joins a room by code on the relay (a WebSocket per seat), reconnects with backoff, keeps the connection alive with its own HEARTBEAT frames. No imports, no WebRTC. |
| `withP2P` (`./p2p`) | The PeerJS P2P upgrade when both seats are on the relay, an unordered fast lane for high-rate traffic, WebRTC quality stats, and the automatic fall back to the relay when P2P drops. Needs PeerJS on `window.Peer`; without it the room stays on the relay. |
| `withMedia` (`./media`) | Camera and microphone calls over the P2P connection. Off unless `mediaEnabled` is true. |

`P2PRoomTransport` and `MediaRoomTransport` are the ready-made combinations. The relay itself is `@usersfirst/rooms-relay`.

## Use

```js
import { RoomTransport, withP2P, withMedia } from '@usersfirst/rooms';

// relay only (most games):
class GameNet extends RoomTransport {
  constructor() {
    super({
      heartbeatType: 0x04,                       // the first byte of keepalive frames
      deviceId: () => myDeviceId(),              // a reload gets its seat back
      codePrefix: 'GAME-',
      onKeepalive: (roomCode) => {},             // every 5 minutes while the relay socket is held
    });
  }
}

// with the P2P upgrade (Tandemonium):
class FastNet extends withP2P(RoomTransport) {
  constructor() {
    super({
      turnCredentialsUrl: 'https://relay.example/turn-credentials',
      peerjs: { host: 'peer.example', port: 443, path: '/', secure: true },
      fastChannelLabel: 'game-fast',
    });
  }
}

// with camera and microphone too:
class CallNet extends withMedia(withP2P(RoomTransport)) {
  constructor() {
    super({ mediaEnabled: true, audioElement: () => document.getElementById('partner-audio') });
  }
}
```

Every option has a default, so `new RoomTransport()` works (it needs `_fallbackUrl`, the relay address, and a room). P2P without `turnCredentialsUrl` uses STUN only.

## The same calls on every layer

- `enterRoom(code, role)`, `send`-side `_send(bytes)` and `_sendFast(bytes)`, `onMessage(bytes)`, `onConnected`, `onDisconnected`, `onReconnecting`, `onRoomJoined`, `onRoomWaiting`, `retryConnection()`, `destroy()`.
- `_sendFast` is latest-wins traffic. On the relay alone it is the same as `_send`; with P2P it uses the unordered channel once the partner has answered on it.
- A media call that reaches a room without the media layer is closed, never answered.

## What is still Tandemonium-shaped

- The two seats are named `captain` and `stoker` on the wire, and `stoker` is the side that dials.
- The JSON control messages (`waiting`, `partner-ready`, `disconnect`, room info) are the ones `@usersfirst/rooms-relay` sends.

## Tests

`node --test` in this folder (no install): the relay socket lifecycle (run against the relay alone and again with the P2P layer on top), the media gate, each option, and the layers.
