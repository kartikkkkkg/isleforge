# IsleForge — Leaderboard Architecture (Milestone 8)

## API

```
GET /leaderboard?limit=50&before=<cursor>
```

- Auth required.
- `limit` 1–100, default 50.
- Cursor pagination: base64url `{ rating, gamesRated, userId }`.
- Response: `{ leaderboard, nextCursor, personalPosition }`.

## Ordering

1. `rating DESC`
2. `gamesRated DESC`
3. `user_id ASC` (stable)

Documented and tested. Index-friendly: the query uses
`ORDER BY rating DESC, games_rated DESC, user_id ASC` with a tuple
comparison for the cursor.

## Personal position

`rankPosition(userId)`: `SELECT COUNT(*) … WHERE (rating, games_rated,
user_id) > (…)` + 1. Efficient — no full table scan into the frontend.

## Privacy

Only public fields: userId, username, displayName, avatarId, rating,
gamesRated, wins, rankName, tier. No email, sessions, IPs.

## UI

- Main nav: Leaderboard (authenticated users).
- Desktop: table rows. Mobile: card rows (responsive CSS).
- Personal position banner at top: "#347 · 1147 MMR".
- Current user highlighted.
