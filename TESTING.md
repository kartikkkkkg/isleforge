# TESTING

## How to run

```bash
cd packages/game-engine
npm test          # vitest, 100 tests
npm run typecheck # strict TS over src + tests
npm run demo      # CLI smoke: full random games, replay-verified
```

## Strategy

- **Rule tests over code coverage.** Every game rule has direct tests:
  board generation, dice, production, building, roads/settlements/cities,
  trading, dev cards, raider, longest road, largest army, victory, turns,
  disconnect-free resign flow, replay reconstruction.
- **White-box fixtures + black-box flows.** Most tests drive the public
  `Game.dispatch` API end-to-end (setup → play). Resource-heavy scenarios use
  `planCommand`/`applyEvent` directly on cloned states with fixture resources —
  the exact code path `dispatch` wraps — so validation and reduction stay
  covered without cheat commands in the engine.
- **Probe-tested enumeration.** `legalCommands` is verified to agree with
  validation (e.g. unaffordable roads are neither listed nor buildable).
- **Determinism tests.** Same seed + same commands ⇒ byte-identical event
  logs and states; different seeds diverge.
- **Replay tests.** `replayEvents(game.getEvents())` deep-equals live state;
  logs not starting with `GAME_CREATED` are rejected.
- **Property-style sweeps.** 6/8 adjacency checked over 40 seeds; dice ranges
  over 30 rolls; topology invariants (54 corners / 72 edges / neighbor
  symmetry / coastal ports).

## Test files

| File | Covers |
|---|---|
| `board.test.ts` | Generation, terrain/number/port distribution, no adjacent 6/8, topology, determinism |
| `engine.test.ts` | Creation, setup snake draft, distance rule, dice, production (+raider block, bank shortage), turns, resign, determinism, replay, hidden info |
| `building.test.ts` | Roads/settlements/cities: costs, connectivity, distance rule, occupancy, Trailblazer free roads |
| `trading.test.ts` | Bank ratios (4:1/3:1/2:1), port ownership, propose/accept/decline, stale auto-decline, turn-end clearing |
| `cards.test.ts` | Buying, play timing (not same turn, one per turn), all five card effects, Landmark silence |
| `robber.test.ts` | 7 → discards (amounts, rounding, errors) → move → steal (victim/empty/invalid) |
| `scoring.test.ts` | Longest-road DFS (branches, blocked pass-through), title tie/loss rules, largest army, victory at 10 via builds/road swings/hidden points |

## Demo (manual verification)

`npm run demo` plays complete games with random legal moves through the real
`dispatch` pipeline, then replay-verifies each finished game from its event
log. It exercises setup, dice, discards, raider moves, steals, building,
trading, dev cards, and victory in combination — the closest thing to a
human playtest at this milestone.

## Later milestones

M5 adds multiplayer integration tests (authoritative server vs malicious
client); M2/M18 add end-to-end browser tests for critical flows. No milestone
is complete until its tests pass.
