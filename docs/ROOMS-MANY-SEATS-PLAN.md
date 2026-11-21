# Rooms with more than two seats: a proposal

**Status:** proposal, not agreed, nothing built. Written 2026-11-20 for issue #137.
**Decision needed from Pete:** whether to do this at all, and the three questions at the end.

## Where we are

`@usersfirst/rooms` (the client) and `@usersfirst/rooms-relay` (the Worker) are in the lab and Tandemonium runs on them. They are exactly Tandemonium's shape: two seats named `captain` and `stoker`, binary frames forwarded unread, the two clients run the game.

Issue #137 also wanted the Discord Activities and SandHands on the same code. They cannot move onto it as it is. Read from their code on 2026-11-20:

| | Tandemonium | Dice, Carnival Dozer, Roulette | SandHands |
|---|---|---|---|
| Who is in a room | 2 seats | up to 48 sockets: players, plus phone remotes that are not players | up to 4 players |
| Who runs the game | the two clients | the room's Durable Object (`TableServer`), which keeps score and saves achievements | one player is host |
| Messages | binary, to "the other seat" | JSON envelopes `{ from, to: "host" or "all", msg }`; the room refuses broadcasts it does not allow | ops, tiles, snapshots, presence |
| Who may enter | a relay token, or the device that took the seat | a key the player id is derived from; a Discord room ticket; a House Tandem session | nothing |
| Presence | `waiting`, `partner-ready`, `disconnect` | a `peers` list of player and remote ids, in connection order | its own presence messages |
| Extras | pair proof, P2P key, TURN, what a room remembers | rate limit on shakes, stale-socket eviction, a saved table | a daily puzzle endpoint |
| Deploy | CI | by hand (`npm run deploy`), no CI | by hand |

Two things follow.

- The parts that really are the same are small: one Durable Object per room code, a WebSocket per connection, a newer connection for the same id replacing the older one, reconnect with backoff, a keepalive, and "tell everyone who is here".
- The parts that differ are the parts that matter to each game: who may enter, who runs the game, and what a message is. The Activities' room is not a relay at all for most messages; it is the game server.

## What could be shared

A third, small layer under both shapes, not a merge of them.

**`RoomSocket` (client).** One WebSocket to one room with: connect, reconnect with backoff, keepalive, "replaced" and "full" handling, and status events. No seats, no host, no message format. Tandemonium's `RoomTransport` and the Activities' `RelayTransport` would each sit on it and keep their own messages.

**`RoomHub` (Worker base class).** A Durable Object base with: accept a socket under an id and a role, replace an older socket with the same id, a cap on sockets, presence change callbacks, stale-socket eviction, and an alarm that cleans up. A game subclasses it and decides what a message does. Tandemonium's two-seat `Room` becomes a subclass (two ids, forward binary to the other). An Activity's room becomes a subclass that hands messages to its `TableServer`.

Entry checks stay in each game's Worker `fetch`, as now. They are the least alike and the most security-sensitive, so they should not be generalised.

**Not shared:** message formats, host logic, tickets and tokens, pair proofs, the P2P and media layers (already separate), anything about a table or a bike.

## What this buys, and what it costs

Buys:
- A reconnect or "replaced socket" bug is fixed once. Tandemonium has had three of those (#468, #480, #621); the Activities have their own copies of the same logic.
- A new game starts from a working room.

Costs:
- It touches the relays of four live products that work today. Three deploy by hand and have no CI, so each move needs a manual deploy and a manual check.
- SandHands can only be checked in a headset.
- The shared part is perhaps 150 lines per side. The risk is high for the amount of code saved.

## Recommended order, if we do it

1. Build `RoomSocket` and `RoomHub` in the lab with tests, and move Tandemonium's own two-seat client and relay onto them with no wire change. Tandemonium has CI and an online smoke, so this is the safe proof.
2. Add CI (tests and type check on a PR) to dice, Carnival Dozer and roulette. This is worth doing whatever is decided here.
3. Move dice. Deploy, play one table in Discord and one on the web with a phone remote.
4. Move Carnival Dozer and roulette the same way.
5. SandHands last, after its submission deadline, with a headset check.

Each step stands alone; stopping after step 1 or 2 leaves nothing half-done.

## Questions for Pete

1. **Do it at all?** A fair answer is "no, not now": the three copies work, and step 2 (CI for the Activities) is the cheaper win.
2. **If yes, is "share the socket and the hub, not the messages" the right size?** The alternative in #137 (one framing for every game, first byte = destination seat) would mean rewriting the Activities' JSON protocol, which I do not recommend.
3. **Who checks the Activities in Discord after each move?** I can build and test, and deploy if told to, but I cannot run a Discord Activity or a headset.
