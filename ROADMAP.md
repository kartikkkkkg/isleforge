# ROADMAP — 18 milestones, strict order

> Rule: after each milestone — run all tests, fix failures, review
> architecture, update docs, run the app, verify manually, commit. Only then
> begin the next. Never jump ahead.

| # | Milestone | Status |
|---|---|---|
| 1 | Local deterministic game engine | ✅ Done 2026-10-08 — `packages/game-engine`, 100 tests, demo-verified |
| 2 | Game UI | ✅ Done 2026-10-08 — `apps/web`, playable vs 3 bots, 18 UI tests + E2E |
| 3 | AI opponents | ⬜ EASY/NORMAL/HARD/EXPERT via `legalCommands`; personalities later (Aggressive, Defensive, Builder, Trader, Opportunist, Balanced) |
| 4 | Authentication | ⬜ Email/Google/Discord/Apple; profiles (username, avatar, rating, stats) |
| 5 | Realtime multiplayer | ⬜ Authoritative WebSocket server wrapping `Game.dispatch`; server owns state, dice, trades, victory |
| 6 | Rooms/lobbies | ⬜ Create/join via code/link, private/public, slots, bots, ready state, settings, map/expansion/player-count selection |
| 7 | Casual matchmaking | ⬜ Queue → compatible players → game |
| 8 | Ranked/MMR | ⬜ Bronze→Grandmaster, transparent rating, leaderboards, seasons, rank + match history |
| 9 | Replay system | ⬜ Viewer on the event log: play/pause/speeds/step/timeline/stats, shareable `/replay/:id` |
| 10 | Spectators | ⬜ Watch public games via `publicView` (no hidden info), spectator count/chat, player perspective |
| 11 | Friends/chat | ⬜ Add/accept/reject/remove/block, presence, invites; game/room/lobby/spectator chat with rate limiting + moderation |
| 12 | Maps | ⬜ Map definition format + editor; balance validator; AI-generated map candidates |
| 13 | Expansion framework | ⬜ `Expansion` interface (name/rules/boardGenerator/cards/actions/scoring/playerLimits); Seafarers-style, C&K-style, 5–6 / 7–8 players, custom maps |
| 14 | Additional game modes | ⬜ Mode framework on top of the engine |
| 15 | Rush mode | ⬜ Simultaneous play: auto dice, concurrent building/trading, conflict resolution, server timestamps |
| 16 | Achievements/statistics | ⬜ Achievement *definitions* (not hard-coded checks); per-player stats |
| 17 | Cosmetics/economy | ⬜ Avatars, board themes, piece/dice designs, frames, emotes, effects; COINS currency for cosmetics only — never pay-to-win |
| 18 | Production hardening | ⬜ PostgreSQL + Redis per spec, observability, backups, load testing, launch checklist |

Engine extension points already in place for M3/M5/M9/M10/M12/M13 — see
ARCHITECTURE.md. Nothing in Milestone 1 needs rewriting to support them.
