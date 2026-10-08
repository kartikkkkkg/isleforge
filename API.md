# API — `@isleforge/game-engine`

Pure TypeScript, zero runtime dependencies. Import from `@isleforge/game-engine`
(or `src/index.ts` in this repo).

## Creating and driving a game

```ts
import { Game } from '@isleforge/game-engine';

const game = new Game({
  seed: 42,                                  // optional; random if omitted
  players: [{ name: 'Ash' }, { name: 'Bryn' }, { name: 'Cora' }, { name: 'Dev' }],
  // id and color optional; colors: ember|tide|moss|dune|orchid|slate
});

game.dispatch({ type: 'PLACE_SETTLEMENT', playerId: 'p1', cornerId: '0.866,-0.500' });
game.dispatch({ type: 'ROLL_DICE', playerId: 'p1' });
// ... every command returns the GameEvent[] it produced (with seq assigned)

game.getState();            // deep-cloned GameState (full info — local game)
game.getEvents();           // deep-cloned event log
game.legalCommands('p1');   // Command[] — everything p1 may legally do now
game.publicView('p2');      // GameState with opponents' dev-card types masked
```

`dispatch` throws `EngineError` (with a stable `code`: `WRONG_PHASE`,
`NOT_YOUR_TURN`, `INSUFFICIENT_RESOURCES`, `ILLEGAL_LOCATION`,
`NO_ROAD_CONNECTION`, `DISTANCE_RULE`, `CORNER_OCCUPIED`, `EDGE_OCCUPIED`,
`INVALID_TRADE`, `CARD_NOT_PLAYABLE`, …) on any illegal command. State is
unchanged when a command throws.

## Commands

`PLACE_SETTLEMENT`, `PLACE_ROAD` (setup) · `ROLL_DICE` · `DISCARD_RESOURCES` ·
`MOVE_RAIDER`, `STEAL_RESOURCE` · `BUILD_ROAD`, `BUILD_SETTLEMENT`, `BUILD_CITY` ·
`BUY_DEVELOPMENT_CARD`, `PLAY_DEVELOPMENT_CARD` (params: `resources?` for
Harvest, `resource?` for Embargo) · `TRADE_BANK`, `TRADE_PROPOSE`,
`TRADE_ACCEPT`, `TRADE_DECLINE` · `END_TURN` · `RESIGN`.

## Events (the source of truth)

`GAME_CREATED`, `TURN_STARTED`, `TURN_PHASE_CHANGED`, `SETUP_PLACED`,
`DICE_ROLLED`, `RESOURCE_GRANTED`, `RESOURCES_PAID`, `DISCARDS_REQUIRED`,
`RESOURCES_DISCARDED`, `RAIDER_MOVED`, `RESOURCE_STOLEN`, `ROAD_BUILT`,
`SETTLEMENT_BUILT`, `CITY_BUILT`, `CARD_PURCHASED`, `CARD_PLAYED`,
`TRADE_PROPOSED`, `TRADE_ACCEPTED`, `TRADE_DECLINED`, `BANK_TRADED`,
`LONGEST_ROAD_CHANGED`, `LARGEST_ARMY_CHANGED`, `VICTORY_ACHIEVED`,
`PLAYER_RESIGNED`, `GAME_ENDED`. Each carries `seq` and a typed `data` payload.

## Key functions

| Function | Purpose |
|---|---|
| `planCommand(state, cmd, rng)` | Validate + plan events on a draft (no mutation) |
| `applyEvent(state, event)` | Reducer — the only mutation path |
| `replayEvents(events)` | Rebuild state from an event log |
| `serializeGame` / `deserializeGame` | JSON save/load (version-checked) |
| `serializeEvents` / `replaySerializedEvents` | Compact replay artifacts |
| `legalCommands(state, playerId)` | Legal-move enumeration (bot interface) |
| `discardCombinations(hand, need)` | Bounded discard enumerations |
| `generateBoard(seed, mapId?)` | Pure board generation |
| `longestRoadLength(roads, board, blocked)` | Road measurement primitive |
| `computeLongestRoadHolder` / `computeLargestArmyHolder` | Title logic (tie keeps holder) |
| `victoryPoints(player, state)` | `{ public, total }` (total includes hidden Landmarks) |
| `bankTradeRatio(state, playerId, give)` | Best bank ratio from ports (4/3/2) |
| `publicGameState(state, viewerId?)` | Hidden-info masking |

## Constants

`COSTS` (road/settlement/city/devCard), `VICTORY_POINT_TARGET` (10),
`LONGEST_ROAD_MINIMUM` (5), `LARGEST_ARMY_MINIMUM` (3),
`BANK_STARTING_STOCK` (19), `DEV_DECK_COMPOSITION` (25 cards),
`RESOURCES`, `PLAYER_COLORS`, `TERRAIN_RESOURCE`.

## Scripts

- `npm test` — vitest (100 tests)
- `npm run typecheck` — strict TS incl. tests
- `npm run build` — emits `dist/`
- `npm run demo` — CLI: plays full random games, replay-verifies each
