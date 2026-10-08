# ARCHITECTURE

## Monorepo

```
isleforge/
  packages/
    game-engine/      # M1 ✅ — deterministic rules engine
  apps/
    web/              # M2 ✅ — browser game UI (Vite + React + TS)
```

`packages/game-engine` has **zero runtime dependencies** and imports nothing
from the DOM, React, Next.js, or Node APIs (only `structuredClone`, available
in all modern runtimes). It compiles to dependency-free JS usable in the
browser, on the server, and in bots.

`apps/web` consumes the engine as a workspace dependency and adds no game
rules of its own — see UI_ARCHITECTURE.md for the full UI design.

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
