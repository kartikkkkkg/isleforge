# ⚒️ ISLEFORGE

*Forge your archipelago.* An original online strategy board-game platform —
browser-based multiplayer in the spirit of modern Catan-style platforms, with
its own name, branding, rules text, and codebase. Gameplay stays free forever.

## Status: Milestone 2 complete ✅ — full production Game UI

The **playable browser game** is done (Vite + React + TypeScript, `apps/web/`):

- Live SVG board from engine state: 19 terrain hexes, 18 number tokens, 9 ports,
  Raider, roads/settlements/cities, glowing legal targets (mouse + keyboard)
- One human + three local demo bots; every interaction dispatches engine
  commands and legality comes from `legalCommands()` — rules are never
  re-implemented in React
- Dice, build menu (costs + engine-derived disabled reasons), bank/port trading,
  player-trade proposals, Harvest/Embargo/discard/Raider-steal flows
- Player panels (public VP, cards, army, Longest Road / Largest Army), event
  game log, game menu / rules / resignation / victory rankings
- Desktop-first 3-column layout → tablet/mobile single-column with bottom-sheet
  build menu; keyboard-accessible, ARIA live regions, reduced-motion support
- Autopilot demo: `?autopilot=1&seed=N` (bots play the whole game, incl. victory screen)
- 21 UI tests passing (unit, component, full GameScreen flows, bot full-game) +
  Playwright E2E suite (`apps/web/e2e/`) for CI

```
apps/web/
  src/game/       useGame (sole engine bridge), demo bot, log formatter
  src/components/ Board, TopBar, PlayerPanel, ControlDeck, Modals, GameLog
  src/screens/    MainMenu, GameScreen   src/styles/  design tokens + responsive
  tests/          vitest unit/component/integration (21 passing)
  e2e/            Playwright desktop + mobile flows (runs in CI)
```

### Quick start

```bash
npm install          # from repo root (workspaces)
npm run dev:web      # Vite dev server → http://localhost:5173
# or: cd apps/web && npm run dev
cd apps/web && npm test        # 21 UI tests
cd apps/web && npm run e2e     # Playwright (needs: npx playwright install)
```

Milestone 1 (engine) remains green: 100 tests passing · strict TypeScript ·
zero runtime dependencies. See below.

- Seeded board generation (19 hexes, terrain, number tokens, 9 ports)
- Full turn engine: snake-draft setup → dice → production → build/trade/cards
- Roads, settlements, cities, 5 development-card types, bank + player trading
- Raider (discards, move, steal), longest road, largest army, victory at 10
- **Event-sourced**: every game is a replayable event log (replays, spectators, anti-cheat later)
- **Never trusts the caller**: every command validated; illegal moves throw
- 100 automated tests passing · strict TypeScript · zero runtime dependencies

```
packages/game-engine/
  src/    types · rng · board · state · events · scoring ·
          commands · legal · replay · engine · demo
  tests/  100 vitest tests covering every Milestone 1 rule
```

### Quick start

```bash
cd packages/game-engine
npm install
npm test          # 100 tests
npm run typecheck # strict TS
npm run demo      # plays full games with random legal moves, replay-verifies each
```

```ts
import { Game } from '@isleforge/game-engine';
const game = new Game({ seed: 42, players: [{ name: 'Ash' }, { name: 'Bryn' }] });
game.dispatch({ type: 'ROLL_DICE', playerId: 'p1' });
game.legalCommands('p1'); // everything p1 may legally do — the bot interface
```

## Docs

| Doc | What |
|---|---|
| PROJECT_SPEC.md | Product vision, principles, Milestone 1 scope |
| ARCHITECTURE.md | Module map, command→event pipeline, extension points |
| GAME_RULES.md | The actual rules of *Archipelago* (original text) |
| API.md | Engine API reference |
| ROADMAP.md | All 18 milestones, strict order, status |
| TESTING.md | Test strategy and how to run |
| SECURITY.md | Trust model now; threats per later milestone |
| DECISIONS.md | Durable technical/product decisions |

## Roadmap (next)

**M2 – Game UI** (board-centered layout, player panels, resource/build/trade/dice
controls, chat, responsive mobile) → **M3 – AI opponents** → **M4 – Auth** →
**M5 – Realtime multiplayer** (authoritative WebSocket server) → … → 18 milestones
to a polished commercial-grade platform. See ROADMAP.md.

## IP note

Built clean: no proprietary code, artwork, logos, trademarks, or text from any
existing board-game platform. Familiar mechanics, original expression.
