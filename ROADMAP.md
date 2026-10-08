# ROADMAP — 17 milestones, strict order

> Rule: after each milestone — run all tests, fix failures, review
> architecture, update docs, run the app, verify manually, commit. Only then
> begin the next. Never jump ahead.

| # | Milestone | Status |
|---|---|---|
| 1 | Local deterministic game engine | ✅ Done 2026-10-08 — `packages/game-engine`, 100 tests, demo-verified |
| 2 | Game UI | ✅ Done 2026-10-08 — `apps/web`, playable vs 3 bots, 18 UI tests + E2E |
| 3 | AI opponents | ✅ Done 2026-10-08 — `packages/ai`: 4 difficulties × 5 personalities, simulation-validated |
| 4 | Realtime multiplayer infrastructure | ✅ Done 2026-10-09 — `apps/server` (authoritative WS) + `packages/protocol`; rooms/lobbies, reconnect, server AI, chat foundation, online UI |
| 5 | Authentication | ⬜ Email/Google/Discord/Apple; profiles (username, avatar, rating, stats) |
| 6 | Casual matchmaking | ⬜ Queue → compatible players → game |
| 7 | Ranked/MMR | ⬜ Bronze→Grandmaster, transparent rating, leaderboards, seasons, rank + match history |
| 8 | Replay system | ⬜ Viewer on the event log: play/pause/speeds/step/timeline/stats, shareable `/replay/:id` |
| 9 | Spectators | ⬜ Watch public games via `publicView` (no hidden info), spectator count/chat, player perspective |
| 10 | Friends/chat | ⬜ Add/accept/reject/remove/block, presence, invites; lobby/spectator chat with rate limiting + moderation (game chat shipped in M4) |
| 11 | Maps | ⬜ Map definition format + editor; balance validator; AI-generated map candidates |
| 12 | Expansion framework | ⬜ `Expansion` interface (name/rules/boardGenerator/cards/actions/scoring/playerLimits); Seafarers-style, C&K-style, 5–6 / 7–8 players, custom maps |
| 13 | Additional game modes | ⬜ Mode framework on top of the engine |
| 14 | Rush mode | ⬜ Simultaneous play: auto dice, concurrent building/trading, conflict resolution, server timestamps |
| 15 | Achievements/statistics | ⬜ Achievement *definitions* (not hard-coded checks); per-player stats |
| 16 | Cosmetics/economy | ⬜ Avatars, board themes, piece/dice designs, frames, emotes, effects; COINS currency for cosmetics only — never pay-to-win |
| 17 | Production hardening | ⬜ PostgreSQL + Redis per spec, observability, backups, load testing, launch checklist |

Engine extension points already in place for M3/M5/M9/M10/M12/M13 — see
ARCHITECTURE.md. Nothing in Milestone 1 needs rewriting to support them.

> 2026-10-09: M4 absorbed the old M5 (realtime multiplayer) and M6 (rooms/lobbies)
> into a single "realtime multiplayer infrastructure" milestone; Authentication moved to M5.
