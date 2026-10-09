# IsleForge — Matchmaking Architecture (Milestone 7)

```
PLAY ONLINE (Quick Match)
      ↓ QUEUE_JOIN (WS, authenticated only)
MATCHMAKING QUEUE (in-memory, single-process)
      ↓ tick() every 1s
MATCH_FOUND → MATCH_STARTING (auto, no manual accept)
      ↓
Matchmade room (match_type = MATCHMADE) + ServerGame
      ↓
GAME_STARTED → play → GAME_ENDED
      ↓
M6 persistence + M7 rating update
```

Private rooms (`CREATE_ROOM` / `JOIN_ROOM` / room codes) are untouched and
separate.

## Queue service

`apps/server/src/matchmaking/queue.ts` — `Matchmaker` class.

- **Entry:** `{ userId, rating, queuedAt, gameMode, connIds }`.
- **One entry per user.** A second `QUEUE_JOIN` from another tab returns
  `ALREADY_QUEUED`; `QUEUE_STATUS` from a new tab attaches to the existing
  entry.
- **In-memory.** No Redis in this milestone.
- **Single-process limitation:** one matchmaking loop is authoritative. The
  `Matchmaker` interface (join/leave/tick/onMatch) is designed so a
  distributed queue can replace it later. Documented, not hidden.

## Matching algorithm

Each tick (1s):

1. Sort entries oldest-first (fairness).
2. For each unmatched player, build a group:
   - Candidates must be within the **mutual** rating window (both players'
     current ranges).
   - Prefer longest-waiting, then closest rating.
   - Every group member must be mutually compatible with all others.
3. Groups of `matchSize` (4) are removed **atomically** from the queue and
   emitted via `onMatch`. A player is never in two matches.

### Rating-range expansion

| wait time | ± range |
|-----------|---------|
| 0–30s     | 100     |
| 30–60s    | 150     |
| 60–120s   | 250     |
| 120s+     | 400     |

Configurable via `MatchmakingConfig.ratingWindows`. Predictable curve —
a 1000 player never instantly matches a 2500 player.

### Fairness

Oldest-first consideration order. Compatibility first, then waiting time,
then rating proximity. Simulation shows p95 wait ~13s with no starvation.

## Protocol (v1)

Client → Server: `QUEUE_JOIN`, `QUEUE_LEAVE`, `QUEUE_STATUS`
Server → Client: `QUEUE_JOINED`, `QUEUE_STATUS`, `QUEUE_LEFT`,
`MATCH_FOUND`, `MATCH_STARTING`, `MATCH_ERROR`

`QUEUE_STATUS` returns: status, queuedAt, playersSearching,
estimatedWaitMs (heuristic from queue size + recent match times, rounded to
5s — displayed as "~15s", never fake precision).

## Match formation

`IsleforgeServer.onMatchFound`:

1. Resolve live connections per user. If a player vanished, requeue the rest.
2. Create room via `RoomManager` (marked `match_type = MATCHMADE`).
3. `joinRoom` for players 2-4; create sessions binding `userId`.
4. Send `MATCH_FOUND` (player names) then `MATCH_STARTING`
   (roomCode, sessionId, playerId).
5. `beginGame(room)` — the **same** `ServerGame` infrastructure as private
   rooms. No special engine.

Clients reconnect their game WebSocket with the sessionId
(`RECONNECT`), then play normally.

## Race conditions handled

- Cancel during formation: player already removed from queue; if they
  vanish before `onMatchFound`, the rest are requeued.
- Disconnect while queued: `onClose` drops the entry when its last
  watching connection closes. No stale entries.
- Double queue / multi-tab: `ALREADY_QUEUED`.
- Session expiry: match requires live connections; expired sessions can't
  join the queue (AUTHENTICATE fails first).
- Duplicate `GAME_ENDED`: `recordEnd` idempotency gates the rating update.

## Disconnect from queue

`QUEUE_LEAVE` removes immediately. WS close removes the entry once its
last tab disconnects. Rejoining works: join → cancel → join leaves no
duplicates (tested).

## Persistence

- The live queue is **not** persisted (in-memory by design).
- `player_ratings` + `rating_history` persist (migration 003).
- Matchmade games persist through M6 with `match_type = 'MATCHMADE'`,
  shown in history as "Casual Matchmaking".

## Security

- Guests rejected (`NOT_AUTHENTICATED`).
- Ratings come from the server's `RatingsRepo`, never the client.
- Queue entries keyed by server-verified `conn.userId`.
- `QUEUE_LEAVE` only affects the caller's own entry.
- Rate-limited (`matchmaking` bucket).
- No match hijacking: formation uses server-side connection resolution.

## Debug mode

`?debugMatchmaking=1` — planned for M8. The `Matchmaker` exposes
`size`, `getEntry`, and `ratingRange` for future introspection.

## Simulation results (2026-10-09)

1000 virtual players (ratings 600–1800), 3 seeds:

| seed | matched | avg wait | p95 wait | avg spread | duplicates |
|------|---------|----------|----------|------------|------------|
| 1    | 99.6%   | 4.1s     | 13.5s    | 76         | 0          |
| 2    | 100%    | 4.3s     | 13.1s    | 77         | 0          |
| 3    | 99.6%   | 3.8s     | 12.3s    | 76         | 0          |

No starvation, no duplicate assignment.
