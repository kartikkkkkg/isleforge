# Isleforge — Multiplayer Architecture (Milestone 4)

Authoritative realtime multiplayer: the **server owns the game state**,
browsers are untrusted clients. All game rules live in
`@isleforge/game-engine`; the server executes them, never duplicates them.

```
                 ┌───────────────┐
                 │    Client A   │
                 │  (React UI)   │
                 └───────┬───────┘
                         │ WebSocket (JSON, protocol v1)
                         ▼
                 ┌───────────────┐
                 │ IsleforgeServer│
                 │  ├─ RoomManager      (lobby rooms, codes, ready, AI seats)
                 │  ├─ SessionManager  (sessionId → roomCode/playerId)
                 │  ├─ ServerGame      (ONE engine instance per game)
                 │  │    ├─ Game (engine, authoritative)
                 │  │    └─ BotAgents (server-side AI seats)
                 │  ├─ MessageRouter   (validate → route → respond)
                 │  ├─ RateLimiter      (per-category flood protection)
                 │  └─ Heartbeat       (ws ping/pong, dead-conn reaping)
                 └───────▲────────┘
                         │ WebSocket (JSON, protocol v1)
                 ┌───────┴───────┐
                 │    Client B   │
                 └───────────────┘
```

## Packages

| Package | Role |
|---|---|
| `packages/protocol` (`@isleforge/protocol`) | Versioned message types + **runtime validators**. Zero runtime deps. Shared by server and web client. |
| `apps/server` (`@isleforge/server`) | Authoritative server. Deps: `ws`, engine, ai, protocol. |
| `packages/game-engine` | Unchanged authority: `Game.dispatch()`, `legalCommands()`, `publicGameState()`. |
| `packages/ai` | Unchanged: `createBot()` / `shouldAcceptTrade()` run **server-side** for AI seats. |
| `apps/web` | New `useMultiplayerGame` adapter + `OnlineLobby`; `GameScreen` renders both local and online games through the `GameApiLike` interface. |

## Trust model

1. **Never trust the client.** Every inbound WebSocket message is parsed and
   structurally validated by `@isleforge/protocol` (`parseClientMessage`).
   Malformed / oversized / wrong-version / unknown-type messages are rejected
   with typed `ERROR`s.
2. **Never trust a client-supplied playerId.** Identity comes from the
   `PlayerSession` (issued on create/join, presented on reconnect). A
   `GAME_COMMAND` whose `command.playerId` differs from the session's player
   is rejected with `NOT_AUTHORIZED`.
3. **The engine validates semantics.** Turn ownership, legality, affordability,
   trade validity — `Game.dispatch()` throws `EngineError`; the server maps it
   to a protocol `ErrorCode` (`NOT_YOUR_TURN`, `INVALID_COMMAND`, …).
4. **Hidden information is masked per viewer.** Snapshots use
   `engine.publicView(playerId)`; broadcast events pass through
   `maskEventForViewer` (opponents' drafted card types → `'hidden'`, bystander
   steal details → `null`). The server never sends a full `GameState`.

## Rooms

- Short codes (`A7K9P`): 5 chars from an unambiguous alphabet, case-insensitive,
  collision-checked.
- Statuses: `WAITING → STARTING → IN_GAME → FINISHED → CLOSED`. (STARTING is
  currently folded into the start transition.)
- Seats: 3–4 total (the engine's player-count contract). 2–4 humans;
  the host fills the rest with AI seats (difficulty/personality).
- Host migration on leave; room closes when empty.
- `START_GAME` requires: requester is host, ≥2 humans, all humans ready,
  every seat filled.

## ServerGame (authoritative instance)

- Owns one `Game`. `handleCommand(playerId, commandId, command)`:
  1. Rejects when the game ended.
  2. **Idempotency**: a seen `commandId` returns the cached seqs without
     re-executing.
  3. Rejects spoofed `command.playerId`.
  4. `engine.dispatch()` — the single validation/execution point.
  5. **AI cascade**: server-side `BotAgent`s act for AI seats through the same
     `dispatch` path until a human must act.
  6. **AI trade answers**: pending player trades targeting AI seats are
     answered via `shouldAcceptTrade` through `dispatch`.
- Events carry the engine's monotonic `seq`. The genesis `GAME_CREATED`
  (seq 0) is broadcast at game start so client streams are gapless.
- `snapshotFor(playerId)` → masked `PublicGameState` + `lastSeq`.
- `eventsAfter(seq)` → replay for reconnecting clients.

## Client synchronization

- `GAME_STARTED` → per-player `GAME_EVENT`(s) from seq 0 → `GAME_STATE`
  snapshot. The client renders snapshots; events feed the game log and
  piece-placement animations.
- After every accepted command: `COMMAND_ACCEPTED` → `GAME_EVENT…` →
  `GAME_STATE` (per-viewer masked). On `GAME_ENDED`, the room becomes
  `FINISHED`.
- Gap detection: each `GAME_EVENT` carries `seq`; a client that sees a gap
  re-sends `RECONNECT` with its `lastSeq` and receives `missedEvents`.

## Reconnect

- `sessionId` (UUID) is issued on create/join and survives disconnects.
- On socket close the seat is kept: `connected=false`, grace timer starts
  (default 120s, configurable).
- `RECONNECT { sessionId, lastSeq }` → `RECONNECT_SUCCESS { playerId, room,
  missedEvents }` + fresh `GAME_STATE`. Any stale connection for the seat is
  terminated.
- Grace expiry: in `WAITING` the seat is freed; in `IN_GAME` a server AI
  pilots the seat (`aiTakeover`) until the player returns so games never stall.
- Heartbeat: ws ping every 25s; connections missing pongs for 60s are reaped.
  Protocol-level `PING`/`PONG` is also supported.

## Rate limiting & anti-cheat

- Per-category fixed windows: room create (5/min), room join (10/min),
  commands (40/10s/player), chat (5/10s/player), reconnect (10/min/session).
- Anti-cheat is structural: fake dice/resources/builds/trades/victory claims
  are impossible because clients only send *commands* and the engine computes
  everything. Out-of-turn, illegal, duplicate, and oversized inputs are
  rejected and never touch authoritative state.

## Chat

Protocol-level only (Milestone 4): `GAME_CHAT` (≤200 chars, rate-limited) →
server-validated → `CHAT_MESSAGE { from, fromName, text, ts }` broadcast.
No moderation/friends/history yet.

## What M4 does NOT include

Public matchmaking, ratings, friends, accounts/auth, payments, cosmetics,
seasons, production deployment, public game discovery. Those are later
milestones.

## Running locally

```bash
npm run dev:server   # ws://localhost:8080
npm run dev:web      # http://localhost:5173
```

Multi-browser test: open the web app in 2–4 windows (or devices on the LAN
with `?server=ws://<host>:8080`), create a room in one, join by code in the
others, ready up, start. See `PROTOCOL.md` for the wire format.
