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
3. **Never trust the client.** Every command is validated server-side (later:
   on the authoritative server); the client only requests actions.
4. **Event sourcing from day one.** Every game is a replayable event log, which
   powers replays, spectators, history, analytics, anti-cheat, and debugging.
5. **Incremental milestones.** 18 milestones, in strict order. No milestone is
   complete until tests pass, docs are updated, the app runs, and the working
   state is committed.

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
