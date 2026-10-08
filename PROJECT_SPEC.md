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
  PROJECT_SPEC.md  ARCHITECTURE.md  GAME_RULES.md  API.md
  ROADMAP.md  TESTING.md  SECURITY.md  DECISIONS.md
  README.md
  packages/
    game-engine/          # Milestone 1 — pure TS, zero runtime deps
      src/                # types, rng, board, state, events, scoring,
                          # commands, legal, replay, engine, index, demo
      tests/              # 100 vitest tests
```

## IP-clean statement

All names, rules text, card names, and code are original. Familiar *mechanics*
(settlement building, dice production, trading, longest road) are not copied
from any proprietary implementation; terminology was deliberately renamed
(Raider, Guardian, Trailblazer, Harvest, Embargo, Landmark, Archipelago).
See DECISIONS.md §1.
