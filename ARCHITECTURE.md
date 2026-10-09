# ARCHITECTURE

## Monorepo

```
isleforge/
  packages/
    game-engine/      # M1 ✅ — deterministic rules engine
    ai/               # M3 ✅ — AI opponents (difficulties × personalities)
    protocol/         # M4 ✅ — versioned WS protocol + runtime validators
    db/               # M5 ✅ — PostgreSQL: migrations + typed repositories
  apps/
    web/              # M2 ✅ / M4 ✅ / M5 ✅ — browser game UI (Vite + React + TS)
    server/           # M4 ✅ / M5 ✅ — authoritative multiplayer server (Node + ws)
```

`packages/game-engine` has **zero runtime dependencies** and imports nothing
from the DOM, React, Next.js, or Node APIs (only `structuredClone`, available
in all modern runtimes). It compiles to dependency-free JS usable in the
browser, on the server, and in bots.

`apps/web` consumes the engine as a workspace dependency and adds no game
rules of its own — see UI_ARCHITECTURE.md for the full UI design.


## Multiplayer server (M4)

`apps/server` is authoritative: it owns one `Game` per room and executes every
command through `Game.dispatch()` — no game rules are duplicated server-side.
Browsers send `GAME_COMMAND`s over the versioned `@isleforge/protocol`
WebSocket contract and render masked snapshots (`GAME_STATE`) + events
(`GAME_EVENT`). Sessions (`sessionId`) survive disconnects; a grace period
with server-AI takeover keeps games moving. Full design:
`MULTIPLAYER_ARCHITECTURE.md`; wire format: `PROTOCOL.md`.

| Module | Responsibility |
|---|---|
| `server.ts` | `IsleforgeServer`: ws wiring, message routing, heartbeats, reconnect grace |
| `rooms.ts` | `RoomManager`: codes, seats, ready, host, AI fill, start gating |
| `sessions.ts` | `SessionManager`: `sessionId` → (room, player) bindings |
| `game.ts` | `ServerGame`: authoritative engine, AI cascade, idempotency, event masking |
| `roomCode.ts` | Human-friendly room codes (`A7K9P`) |
| `ratelimit.ts` | Per-category flood protection |
| `protocol` pkg | Message types + runtime validators (shared with the web client) |
| `auth/` | M5 ✅ — `AuthService` (register/login/refresh/logout), scrypt, JWTs, HTTP router |

The web client consumes the same `GameScreen` through the `GameApiLike`
interface: `useIsleforgeGame` (local) and `useMultiplayerGame` (online) are
interchangeable adapters — local game, online game, and (later)
replay/spectator share components.

## Authentication (M5)

Identity (`User`) is separate from game participation. `packages/db`
(`@isleforge/db`) owns PostgreSQL: versioned migrations
(`users`, `account_profiles`, `sessions`, `password_resets`,
`email_verifications`, `auth_audit_log`) + typed repositories. The server
adds an HTTP auth API (`/auth/*`: register, login, logout, refresh, me,
profile, sessions, password reset) and WebSocket `AUTHENTICATE`:
the server verifies the access token itself and binds `conn.userId`;
seats record the owner, and `RECONNECT` is rejected for a different user.
Passwords use scrypt; sessions are short-lived JWT access tokens + rotating
opaque refresh tokens (HttpOnly cookie) with reuse detection. Guests keep
working as in M4. Full design: `AUTH_ARCHITECTURE.md`.

## Game history (M6)

The engine stays authoritative; PostgreSQL records outcomes. `GameRecorder`
(`apps/server/src/history/`) persists game start/end: on `GAME_ENDED` it
derives standings from engine state (`victoryPoints()`, sorted by total VP)
and writes game + players + ordered engine events + per-user stats in one
transaction — idempotent via status-gated `COMPLETED` transition and
`ON CONFLICT DO NOTHING`. History API: `GET /games` (cursor pagination),
`GET /games/:id`, `GET /games/:id/events`, `GET /me/stats` — participants
only. Full design: `GAME_HISTORY_ARCHITECTURE.md`.

## Engine module map

| Module | Responsibility |
|---|---|
| `types.ts` | Domain types: resources, terrain, cards, board, players, state, commands, events, `EngineError` |
| `rng.ts` | Seeded PRNG (mulberry32), shuffle, weighted pick |
| `board.ts` | Axial hex grid, corner/edge topology, seeded terrain/number/port placement |
| `state.ts` | `GameState` factories, player helpers, turn-order helpers |
| `events.ts` | `applyEvent(state, event)` — the **only** mutation path; event log = source of truth |
| `scoring.ts` | Victory points, longest road (DFS with blocked corners), largest army |
| `commands.ts` | `planCommand(state, cmd, rng)` — validate every command, plan resulting events on a throwaway draft |
| `legal.ts` | `legalCommands(state, playerId)` — enumerate legal moves **by probing `planCommand`** (cannot drift from validation) |
| `replay.ts` | `replayEvents`, serialize/deserialize state and event logs |
| `engine.ts` | `Game` facade: owns RNG, `dispatch()`, `getState()`, `publicView()` (hidden-info masking) |
| `demo.ts` | CLI smoke demo: plays full games with random legal moves, replay-verifies each |

## Command → event pipeline

```
            ┌─────────────┐   validate    ┌──────────────┐   assign seq   ┌────────────┐
  client ──▶│   Command   │ ────────────▶ │ planCommand  │ ────────────▶ │ applyEvent │ ──▶ state
            └─────────────┘  EngineError   │ (draft copy) │   per event   │ (reducer)  │    +
                             on illegal   └──────────────┘               └────────────┘   event log
```

- `planCommand` clones state into a draft, validates, and emits events through a
  local `emit()` that also applies them to the draft — so multi-event commands
  (road → longest-road → victory) observe correct intermediate state.
- `Game.dispatch` assigns sequence numbers, applies to live state, appends to
  the log. A throwing command leaves state untouched (atomicity).
- All randomness (dice, steals) is generated inside `planCommand` via the
  injected RNG and **recorded in events** (`DICE_ROLLED`, `RESOURCE_STOLEN`,
  `CARD_PURCHASED`). Replaying events needs no RNG.

## State model

`GameState` is plain JSON data (records, arrays, no Maps/Sets/Floats-as-keys):
board topology, players (resources, buildings, cards, counters), bank, dev
deck, raider position, turn/phase, pending discards/steals/trades, road/army
holders, winner, setup cursor, event log.

Phases: `setup → roll → play`, with `discard` and `raider` sub-phases after a 7
or a Guardian card, ending in `gameover`.

## Hidden information

Local milestone: `Game.getState()` returns everything. `publicView(viewerId?)`
masks opponents' dev-card types as `'hidden'` — the seam spectators (M10) and
the network server (M5) will use. Resource counts are public (as in the game
rules); card identities are not.

## Determinism contract

`new Game({seed, players})` + the same command sequence ⇒ byte-identical event
logs and states. Board layout, number tokens, ports, and the dev deck all derive
from the seed. Verified by tests (`determinism` suite) and by the demo, which
replay-verifies every finished game.

## Extension points (for later milestones)

- **Maps (M12):** `generateBoard(seed, mapId)` already takes a `mapId`; new
  generators plug in beside `archipelago-classic`.
- **Expansions (M13):** commands/events are data; new modules add command types
  + `planCommand` branches + event handlers without touching the core loop.
- **Bots (M3):** `legalCommands(state, playerId)` is the bot decision interface —
  implemented in `packages/ai` (`@isleforge/ai`): 4 difficulties × 5
  personalities, modular evaluators, deterministic seeded decisions, AI-vs-AI
  simulation harness. See `packages/ai/AI_ARCHITECTURE.md`.
- **Server (M5):** `Game.dispatch` *is* the authoritative move handler; the
  server will wrap it with auth, rooms, and broadcast.
- **Replays (M9):** `replayEvents` + `serializeEvents` are the replay backend.
