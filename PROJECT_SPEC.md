# ISLEFORGE — Project Spec

**Isleforge** is an original online strategy board-game platform: a browser-based,
multiplayer, Catan-style strategy board game with original branding, artwork,
codebase, rules text, and terminology. It is *inspired by* the interaction model
of modern online board-game platforms (board centered, player panels around it,
resource/build/trade controls, dice, chat, lobbies, matchmaking, replays) without
copying any proprietary source code, artwork, logos, trademarks, or text.

- **Platform name:** Isleforge
- **Base game module:** *Archipelago* (the Isleforge base game)
- **Tagline:** *Forge your archipelago.*

## Product principles

1. **Gameplay is free.** Premium-style functionality (cosmetics, seasons) never
   gates gameplay and never sells advantages.
2. **The engine is independent from the frontend.** A pure, deterministic,
   event-sourced game engine (`@isleforge/game-engine`) owns all rules. The UI,
   bots, and (later) the network server are all clients of the engine.
3. **Never trust the client.** Every command is validated on the authoritative
   server; the client only requests actions.
4. **Event sourcing from day one.** Every game is a replayable event log, which
   powers replays, spectators, history, analytics, anti-cheat, and debugging.
5. **Incremental milestones.** 17 milestones, in strict order. No milestone is
   complete until tests pass, docs are updated, the app runs, and the working
   state is committed.

## Milestone 4 — Realtime multiplayer infrastructure ✅ COMPLETE (2026-10-09)

Authoritative WebSocket game server (`apps/server`, Node + `ws`) wrapping
`Game.dispatch` — the server owns state, dice, trades, and victory; browsers
are untrusted clients on the versioned `@isleforge/protocol` contract
(`PROTOCOL.md`). Full design: `MULTIPLAYER_ARCHITECTURE.md`.

Delivered:

- versioned protocol (v1) with runtime validation of every inbound message
  (malformed / oversized / wrong-version / unknown-type rejected)
- rooms with human-friendly codes (`A7K9P`), 3–4 seats, host, ready state,
  AI fill (difficulty/personality), host migration, start gating
  (2+ humans, all ready, seats filled)
- `ServerGame`: one authoritative engine per room; idempotent `commandId`s;
  monotonic event seqs from 0 (genesis `GAME_CREATED` broadcast)
- hidden-information masking per viewer (snapshots via `publicView`,
  `CARD_PURCHASED` types and bystander steal details masked in events)
- reconnect with session ids, missed-event replay, configurable grace period,
  server-AI takeover so games never stall, ws + protocol heartbeats
- server-side AI seats through the same dispatch pipeline (incl.
  `shouldAcceptTrade` auto-answers for player trades)
- rate limiting (room/command/chat/reconnect), typed errors, anti-cheat by
  construction (clients send commands, never state)
- protocol-level game chat (200 chars, rate-limited)
- web client: `useMultiplayerGame` adapter behind the shared `GameApiLike`
  interface (same `GameScreen` for local + online), `OnlineLobby`,
  connection indicator, chat wired into `ChatPanel`
- no public matchmaking, accounts, or production deployment (later milestones)

## Milestone 6 — Game history & player statistics ✅ COMPLETE (2026-10-09)

The engine remains authoritative for gameplay; the database records the outcome.

Delivered:

- migration `002_game_history`: `games`, `game_players`, `game_events`,
  `player_game_stats` (+ indexes); never modifies 001
- `GameRecorder`: on game start persists game + seat roster; on `GAME_ENDED`
  derives standings from engine state and persists game + players + ordered
  events + per-user stats in one transaction — idempotent, atomic
- display-name snapshots (history survives renames); AI seats store
  difficulty/personality; guests persist with `user_id NULL`
- history API: `GET /games` (cursor pagination), `GET /games/:id`,
  `GET /games/:id/events`, `GET /me/stats` — participants only, 404 for others
- statistics: games/wins/losses/win rate/avg VP/avg finish/best VP/total time,
  from completed games only (abandoned excluded, no NaN)
- web UI: Match History (filters, pagination), Game Detail (standings, AI
  badges), Profile statistics grid; "Watch Replay" disabled until M8
- server restart safe: duplicate `GAME_ENDED` cannot duplicate records

Full design: `GAME_HISTORY_ARCHITECTURE.md`. Out of scope (later): MMR,
ranked, leaderboards, matchmaking, friends, achievements, seasons.

## Milestone 5 — Authentication & persistent accounts ✅ COMPLETE (2026-10-09)

Identity (`User`) is separate from game participation. `packages/db`
(`@isleforge/db`) owns PostgreSQL: versioned migrations (`users`,
`account_profiles`, `sessions`, `password_resets`, `email_verifications`,
`auth_audit_log`) + typed repositories. The server adds an HTTP auth API
(`/auth/*`: register, login, logout, refresh, me, profile, sessions,
password reset, email verification) and WebSocket `AUTHENTICATE`.

Delivered:

- email registration (normalized, validated, unique email + username),
  scrypt password hashing, strength gate, reserved usernames
- sessions: 15-min JWT access tokens + rotating opaque refresh tokens
  (HttpOnly `SameSite=Lax` cookie, `Secure` in production), reuse detection
  revokes the token family, logout / logout-all
- brute-force protection: per-account exponential backoff + temporary
  lockout; dedicated `auth_*` rate limits; no account enumeration in
  login or password-reset responses
- WS auth: server verifies the access token, binds `conn.userId`; seats
  record the owner; `RECONNECT` rejects a different user
- usernames (unique, case-insensitive) vs display names (changeable);
  8 built-in original avatar SVGs
- web UI: Login / Register / Profile / Settings screens, session list,
  auth-aware main menu; guests keep playing as in M4
- audit log with a secret-guard (passwords/tokens can never be logged)
- 35 new tests (db 4, auth API 20, WS auth 4, auth security 7), all passing;
  M1–M4 suites still green

Full design: `AUTH_ARCHITECTURE.md`. Out of scope (later milestones):
friends, matchmaking, MMR, leaderboards, achievements, cosmetics economy,
payments, seasons, public discovery.

## Milestone 3 — AI opponents ✅ COMPLETE (2026-10-08)

Strategic AI in `packages/ai` (`@isleforge/ai` — no React, zero runtime deps
beyond the engine):

- `BotAgent` interface: `chooseAction(state, playerId)` returns one legal
  engine command; masked public view (no hidden info); per-decision seeded
  RNG — same (state, config) → same action
- 4 difficulties (Easy/Normal/Hard/Expert — noise + depth + Expert 1-ply
  lookahead) × 5 personalities (Balanced/Aggressive/Builder/Trader/
  Opportunist — real weight differences, not seed changes)
- Modular evaluators with reasons: settlement, road, city, dev cards,
  bank/port trades (scored on what they unlock), raider/steal, discard,
  threat assessment, immediate-win detection
- Safety: per-turn action cap (auto-reset), END_TURN fallback, never throws
- Simulation harness: AI-vs-AI, no React; 100 seeded games, 100% completion,
  0 illegal commands (see packages/ai/AI_ARCHITECTURE.md)
- UI: menu config (2–3 AI, difficulty, personality/varied), "X is thinking…"
  indicator, `?debugAI=1` developer panel; human-vs-AI fully playable
- Engine: `legalCommands` gains `skipTradePropose` enumeration option
  (no rule change); all 100 M1 tests still pass

Out of scope (later milestones): multiplayer, auth, matchmaking, ranked,
replays UI, spectators, friends/chat backend, maps, expansions, modes.

## Milestone 2 — Game UI ✅ COMPLETE (2026-10-08)

Playable browser game in `apps/web` (Vite + React + TS):

- Board-centered layout: SVG hex board from live engine state, player panels
  around it, resource/action deck, game log, chat placeholder, game menu
- Full interaction: setup placement, roll/build/trade/cards, raider flow,
  discard picker, victory screen — every intent dispatches engine commands;
  no rules duplicated in the frontend
- Local demo: 1 human + 3 SimpleBot opponents (bot selects among
  `legalCommands()`; NOT the Milestone 3 AI), plus autopilot AI-battle mode
- Design system (tokens → components → screens), responsive (desktop/tablet/
  mobile), keyboard-accessible, reduced-motion support
- 21 UI tests passing (vitest/jsdom: unit, component, GameScreen integration,
  full bot game); Playwright E2E suite for critical flows (runs in CI)
- See UI_ARCHITECTURE.md

Out of scope (later milestones): multiplayer, auth, matchmaking, ranked,
replays UI, spectators, friends/chat backend, maps, expansions, modes.

## Milestone 1 — Local deterministic game engine ✅ COMPLETE (2026-10-08)

Scope (all delivered and tested in `packages/game-engine`):

- Board generation (seeded, 19 hexes, radius-2 axial grid)
- Hexagonal terrain (forest/hills/fields/pasture/mountains/desert)
- Resource production (dice → adjacent settlements/cities, raider block, bank limits)
- Dice (seeded RNG; outcomes recorded in events)
- Player turns (setup snake draft → roll → play, incl. 7/discard/raider sub-phases)
- Roads, settlements, cities (costs, connectivity, distance rule, upgrades)
- Development cards (Guardian, Trailblazer, Harvest, Embargo, Landmark)
- Resource inventory + bank (19 of each, shortage rule)
- Trading (bank 4:1 / 3:1 / 2:1 via ports; player propose/accept/decline)
- Ports (9 coastal: 4× 3:1, 5× 2:1)
- Raider (on 7: discards, move, steal)
- Victory points (10 to win; public vs hidden Landmark points)
- Longest-road calculation (5+, opponent settlements block pass-through)
- Largest-army calculation (3+ guardians, tie keeps holder)
- Victory detection (builds, cards, road/army swings, resignation)
- Turn progression (incl. skipping resigned players)
- Legal move validation (`legalCommands`, probe-based — cannot drift from rules)
- Game reset (fresh `Game` with same seed reproduces the initial state)
- Deterministic replay (`replayEvents` — event log fully reconstructs state)

Out of scope for Milestone 1 (later milestones): UI, bots, networking,
accounts, rooms, matchmaking, ranked, replays UI, spectators, friends/chat,
maps editor, expansions, rush mode, achievements, cosmetics/economy, hardening.

## Repository layout

```
isleforge/
  PROJECT_SPEC.md  ARCHITECTURE.md  GAME_RULES.md  API.md  UI_ARCHITECTURE.md
  ROADMAP.md  TESTING.md  SECURITY.md  DECISIONS.md
  README.md
  packages/
    game-engine/          # Milestone 1 — pure TS, zero runtime deps
      src/                # types, rng, board, state, events, scoring,
                          # commands, legal, replay, engine, index, demo
      tests/              # 100 vitest tests
  apps/
    web/                  # Milestone 2 — browser game UI (Vite + React)
      src/
        game/             # engine adapter, demo bot, log formatter, build info
        components/       # board, panels, deck, modals, log
        screens/          # menu, game screen
        styles/           # design tokens, components, board, screens
      tests/              # vitest + jsdom (18 tests)
      e2e/                # Playwright critical flows
```

## IP-clean statement

All names, rules text, card names, and code are original. Familiar *mechanics*
(settlement building, dice production, trading, longest road) are not copied
from any proprietary implementation; terminology was deliberately renamed
(Raider, Guardian, Trailblazer, Harvest, Embargo, Landmark, Archipelago).
See DECISIONS.md §1.
