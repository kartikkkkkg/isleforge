# IsleForge — Rating System (Milestone 7)

Every authenticated player has an MMR (matchmaking rating). It is labeled
**MMR**, never "Rank" — there are no visible competitive tiers in this
milestone.

## Model

- **Initial rating:** 1000 for new authenticated users.
- **Guests:** never rated, never enter matchmaking.
- **Algorithm:** multiplayer Elo (deterministic, documented, no invented constants).

### Multiplayer Elo

For each player *i* in an *N*-player game:

```
expected_i = (1/(N-1)) · Σ_{j≠i} 1 / (1 + 10^((Rj − Ri)/400))
actual_i   = 1 − (placement_i − 1) / (N − 1)     // 1st → 1.0, last → 0.0
delta_i    = K · (actual_i − expected_i)
```

For 4 players this gives placement scores 1.0 / 0.67 / 0.33 / 0.0.

### K factor

- **K = 32** for established players.
- **K = 48** for provisional players (first 10 rated games) — faster convergence.
- Configurable in `apps/server/src/rating/elo.ts`.

### Rating floor

Ratings are clamped to a minimum of **100**. No negatives, no infinities.

### Rating history

Every rated game appends one row per player to `rating_history`
(`UNIQUE(user_id, game_id)` — idempotent). History is never overwritten.
Fields: `rating_before`, `rating_after`, `rating_delta`, `placement`,
`opponent_average_rating`. This powers debugging and future rating graphs.

## Update flow

At game completion (`persistGameEnd` → `applyRatingUpdate`):

1. Read final engine standings (placement, won per seat).
2. In a DB transaction: `SELECT … FOR UPDATE` the current ratings
   (stable pre-game snapshot — never computed from already-modified values).
3. Compute deltas with `computeDeltas()`.
4. `UPDATE player_ratings` + `INSERT rating_history` (idempotent).
5. COMMIT. Duplicate `GAME_ENDED` → `recordEnd` returns `recorded=false` →
   no rating update. Even if called twice, `UNIQUE(user_id, game_id)` skips.

Only **completed** games affect rating. Abandoned games (`ABANDONED` status)
do not change rating — documented, not punished, in this milestone.

## Casual vs ranked

This milestone: `game_mode = CASUAL`, `rating_mode = RATED_CASUAL`.
Casual games **do** affect MMR (it improves matchmaking quality), but the
number is shown as "MMR", not "Rank". Ranked mode (M8+) reuses the same
underlying rating.

## Integrity

- The client can never submit a rating. Only the server's rating service
  (driven by engine standings) writes to `player_ratings`.
- `CHECK (rating >= 100)`, `UNIQUE(user_id)`.
- All math is in `apps/server/src/rating/elo.ts` — pure, deterministic,
  unit-tested.

## Simulation results (2026-10-09)

48 virtual players (12 strong / 24 medium / 12 weak), 200 games each, 3 seeds:

| group  | avg final rating |
|--------|-----------------|
| strong | ~1518           |
| medium | ~1000           |
| weak   | ~483            |

Strong rise, weak fall, no pathological values. Rating behaves sensibly.
