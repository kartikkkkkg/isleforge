# IsleForge — Replay Architecture (Milestone 8)

## Data source

M6 persists `game_events` (ordered, PK on game_id+sequence). The replay
viewer uses **the same event log** — no separate replay format.

```
GET /games/:id/events → ordered GameEvent[] → replayEvents() → GameState
```

## Reconstruction

`replayEvents(events)` (engine): folds events from `GAME_CREATED` via
`applyEvent`. Deterministic. Dice results come from persisted
`DICE_ROLLED` events — never rerolled.

For seeking to event N: `replayEvents(events.slice(0, N+1))`. Typical games
(<1000 events) reconstruct in milliseconds; checkpoints are a future
optimization if needed.

## Architecture

```
LiveGame (GameScreen + useMultiplayer)
ReplayGame (ReplayScreen + replayEvents)
       ↓
Common: GameBoard, engine types
```

Replay reuses `GameBoard` in `{ kind: 'idle' }` mode with no-op handlers.
No gameplay commands are sent — the WebSocket isn't even opened for replay
(events come via HTTP).

## Controls

Play/pause, restart, previous/next event, 0.5×/1×/2×/4× speed, seekable
timeline. All local state.

## Visibility

Replay shows the full game state (all players' pieces). This is correct for
post-game review — the game is over, hidden information is moot. During
live play, the server's per-viewer masking still applies.

## Security

- `GET /games/:id/events` requires participant (existing M6 authz).
- Read-only: no command endpoint is touched.
- Events are immutable in the DB (no UPDATE path).
