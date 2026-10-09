# IsleForge — Ranked Architecture (Milestone 8)

## Casual vs Ranked

| | Casual | Ranked |
|---|---|---|
| Queue | `matchMode=CASUAL` | `matchMode=RANKED` |
| Rating | MMR (same Elo) | MMR (same Elo) |
| Presentation | "MMR 1147" | "Gold II · MMR 1147" |
| Rating windows | ±100→400 | ±75→300 (tighter) |
| Game mode | `CASUAL` | `RANKED` |

**rating = skill estimate. rank = competitive presentation.** They are not
the same. One Elo system serves both.

## Rank tiers

Derived deterministically from rating via `RankService` (`rankFor`):

| Rating | Tier |
|--------|------|
| < 800 | Bronze (III/II/I) |
| 800–999 | Silver (III/II/I) |
| 1000–1199 | Gold (III/II/I) |
| 1200–1399 | Platinum (III/II/I) |
| 1400–1599 | Diamond (III/II/I) |
| 1600–1799 | Master |
| 1800+ | Grandmaster |

Divisions split each 200-point tier into thirds. Master/Grandmaster have no
divisions. Thresholds validated against the M7 rating distribution
(simulation: 1000 players → 24% Bronze I at most, 0.5% Diamond, no
Grandmasters — sane).

## Provisional

`< 10` rated games → "Provisional Gold II", "7/10 games". No false certainty.

## Ranked matchmaking

Reuses the M7 `Matchmaker` — no second engine. Queue entries carry
`gameMode: 'CASUAL' | 'RANKED'`; groups only form within the same mode.
A player cannot be in both queues (`ALREADY_QUEUED`).

On match: `game_mode = RANKED`, `match_type = MATCHMADE`.

## Finalization

```
GAME_ENDED → persist game → persist stats → Elo → rating_history →
update rating → rank derived on read → broadcast
```

Idempotent (M7 guarantees hold). Abandoned ranked games don't affect rating.

## Anti-abuse

All rating changes originate from server-side game completion. Clients
cannot submit placements, deltas, or ratings. `rating_history` is
append-only.
