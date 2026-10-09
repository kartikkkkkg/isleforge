# ROADMAP — 18 milestones, strict order

> Rule: after each milestone — run all tests, fix failures, review
> architecture, update docs, run the app, verify manually, commit. Only then
> begin the next. Never jump ahead.

| # | Milestone | Status |
|---|---|---|
| 1 | Local deterministic game engine | ✅ Done 2026-10-08 — `packages/game-engine`, 100 tests, demo-verified |
| 2 | Game UI | ✅ Done 2026-10-08 — `apps/web`, playable vs 3 bots, 18 UI tests + E2E |
| 3 | AI opponents | ✅ Done 2026-10-08 — `packages/ai`: 4 difficulties × 5 personalities, simulation-validated |
| 4 | Realtime multiplayer infrastructure | ✅ Done 2026-10-09 — `apps/server` (authoritative WS) + `packages/protocol`; rooms/lobbies, reconnect, server AI, chat foundation, online UI |
| 5 | Authentication | ✅ Done 2026-10-09 — `packages/db` (PostgreSQL, migrations) + auth in `apps/server` (scrypt, JWT access + rotating refresh, WS AUTHENTICATE, seat authz); Login/Register/Profile/Settings UI; 35 auth/security tests |
| 6 | Game history & player statistics | ✅ Done 2026-10-09 — `packages/db` migration 002 (games, game_players, game_events, player_game_stats); server GameRecorder persists completed games idempotently; history API (cursor pagination) + stats; Match History / Game Detail / Profile stats UI |
| 7 | MMR + casual matchmaking | ✅ Done 2026-10-09 — `player_ratings` + `rating_history` (migration 003); multiplayer Elo (K=32/48, floor 100); in-memory matchmaker (rating windows, fairness, atomic formation); WS queue protocol; Quick Match UI; profile MMR; matchmade games in history |
| 8 | Ranked + leaderboards + replays | ✅ Done 2026-10-09 — RankService (7 tiers, divisions, provisional); ranked matchmaking (tighter windows); leaderboard API/UI; replay viewer (event reconstruction, controls, timeline) |
| 9 | Friends, presence & social play | ✅ Done 2026-10-09 — friendships, blocks, presence (multi-tab), game invitations, notifications, social UI |
| 9 | Replay system | ⬜ Viewer on the event log: play/pause/speeds/step/timeline/stats, shareable `/replay/:id` |
| 10 | Spectators | ⬜ Watch public games via `publicView` (no hidden info), spectator count/chat, player perspective |
| 11 | Friends/chat | ⬜ Add/accept/reject/remove/block, presence, invites; lobby/spectator chat with rate limiting + moderation (game chat shipped in M4) |
| 12 | Maps | ⬜ Map definition format + editor; balance validator; AI-generated map candidates |
| 13 | Expansion framework | ⬜ `Expansion` interface (name/rules/boardGenerator/cards/actions/scoring/playerLimits); Seafarers-style, C&K-style, 5–6 / 7–8 players, custom maps |
| 14 | Additional game modes | ⬜ Mode framework on top of the engine |
| 15 | Rush mode | ⬜ Simultaneous play: auto dice, concurrent building/trading, conflict resolution, server timestamps |
| 16 | Achievements/statistics | ⬜ Achievement *definitions* (not hard-coded checks); per-player stats |
| 17 | Cosmetics/economy | ⬜ Avatars, board themes, piece/dice designs, frames, emotes, effects; COINS currency for cosmetics only — never pay-to-win |
| 18 | Production hardening | ⬜ PostgreSQL + Redis per spec, observability, backups, load testing, launch checklist |

Engine extension points already in place for M3/M5/M9/M10/M12/M13 — see
ARCHITECTURE.md. Nothing in Milestone 1 needs rewriting to support them.

> 2026-10-09: M4 absorbed the old M5 (realtime multiplayer) and M6 (rooms/lobbies)
> into a single "realtime multiplayer infrastructure" milestone; Authentication moved to M5.
