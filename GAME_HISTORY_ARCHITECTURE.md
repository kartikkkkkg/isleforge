# IsleForge — Game History & Statistics Architecture (Milestone 6)

Completed games are remembered. The engine stays authoritative for gameplay;
PostgreSQL records the outcome. The database never decides who won.

```
Game Engine ──events──▶ ServerGame ──GAME_ENDED──▶ GameRecorder ──▶ PostgreSQL
     (decides)              (detects)               (derives)          (stores)
```

---

## 1. Schema (migration 002)

**`games`** — one row per game, keyed by the server's gameId (unique).

| column | meaning |
|---|---|
| `id` | server gameId (uuid), PK |
| `game_type` | `ONLINE` \| `LOCAL` (extensible) |
| `game_mode` | `CASUAL` (later: `RANKED`, `RUSH`, `CUSTOM`) |
| `status` | `CREATED` \| `STARTED` \| `COMPLETED` \| `ABANDONED` \| `CANCELLED` |
| `map_id` | board/map identifier (`archipelago` for now) |
| `player_count` | seats at start |
| `started_at` / `finished_at` | server timestamps (never client clocks) |
| `duration_seconds` | `finished_at − started_at`, computed server-side |
| `winner_user_id` | FK → users, nullable (guests/AI can win) |
| `winner_player_id` | engine seat id (`p1`…), kept even without a user |

**`game_players`** — one row per seat. `user_id` NULL = guest or AI seat
(`is_ai` distinguishes). `display_name_snapshot` freezes the name shown
during the game — later renames don't rewrite history. AI seats store
`ai_difficulty` / `ai_personality`. `finish_position`, `victory_points`,
`won` are filled at finalization.

**`game_events`** — server-generated engine events only. PK
`(game_id, sequence)` keeps the stream ordered and makes duplicate writes
safe. Payload is JSONB. Raw WebSocket messages are never stored.

**`player_game_stats`** — per-user per-game aggregates derived from engine
state at finalization: `vp`, `finish_position`, `won`, `roads_built`,
`settlements_built`, `cities_built`, `dev_cards_bought`,
`dev_cards_played`. Only metrics the engine actually produces — nothing
fabricated.

Indexes: `games(winner_user_id)`, `games(finished_at)`,
`game_players(user_id)`, PK on `game_events(game_id, sequence)`,
`player_game_stats(user_id)`.

Guest claiming is *not* implemented, but the schema supports it later:
guests have `user_id IS NULL` rows, so a future `guest_claims(guest_key,
user_id)` table can backfill them.

## 2. Persistence flow

**Start** (`persistGameStart`, fire-and-forget): `INSERT games … ON
CONFLICT DO NOTHING` + `INSERT game_players … ON CONFLICT DO NOTHING`.

**End** (`persistGameEnd`, fire-and-forget): on `GAME_ENDED` the server
derives standings from engine state (`victoryPoints()` per player, sorted
by total VP, ties by public VP then seat), then in **one transaction**:

1. `completeGame` — `UPDATE … WHERE status='STARTED'` (idempotent: a
   second call affects 0 rows → no-op, no duplicate)
2. `finalizePlayers` — positions, VP, won flags
3. `insertEvents` — all engine events, `ON CONFLICT DO NOTHING`
4. `insertPlayerStats` — per-user aggregates

Persistence failures are logged, never thrown into gameplay. Duplicate
`GAME_ENDED` handling cannot create duplicate records (unique game id +
status-gated transition + `ON CONFLICT DO NOTHING`).

**Abandonment**: `ABANDONED` is a terminal status for games the server
cannot finish. Rule: only `CREATED`/`STARTED` games can be marked
abandoned, and abandoned games are excluded from all statistics.

## 3. API

All routes require a Bearer access token. Users see only games they
participated in; non-participants get `404` (not `403`) so game existence
doesn't leak.

```
GET /games?limit=20&before=<cursor>  → { items, nextCursor, hasMore }
GET /games/:gameId                   → { game, players }
GET /games/:gameId/events            → { gameId, events[] } (ordered)
GET /me/stats                        → { stats }
```

Cursor pagination: `before` is a base64url `{ finished_at, id }` pair;
`WHERE (finished_at, id) < ($1, $2) ORDER BY finished_at DESC, id DESC`.
Limits clamped to 1–100. Malformed cursors → 400.

## 4. Statistics definitions

Computed by `GamesRepo.getStats`, from **COMPLETED games only**:

| stat | definition |
|---|---|
| Games Played | completed games where the user has a `player_game_stats` row |
| Wins | `won = true` rows |
| Losses | `won = false` rows |
| Win Rate | `wins / games_played` (0 when no games — never NaN) |
| Average VP | `AVG(vp)` |
| Average Finish | `AVG(finish_position)` |
| Best VP | `MAX(vp)` |
| Total Play Time | `SUM(duration_seconds)` |

Abandoned/cancelled games never count. Guests have no per-user stats.

## 5. UI

- **Profile**: stats grid (Games, Wins, Win Rate, Avg VP, Avg Finish,
  Time Played) + Match History button. Empty state shows dashes, not zeros
  pretending to be data.
- **Match History**: cursor-paginated list, All/Wins/Losses filter,
  each row shows result, player count, mode, duration, date.
- **Game Detail**: metadata grid, final standings with winner badge and
  AI indicators, disabled "Watch Replay (coming in M8)" button —
  replay reuses the persisted ordered events (M8), not a second system.
- Game completion shows "Game saved" to authenticated players via the
  normal `GAME_ENDED` flow (history appears on next profile/history load).

## 6. What M6 does NOT include

MMR, matchmaking, ranked, leaderboards, friends, achievements, seasons,
cosmetics, payments, public discovery — later milestones.
