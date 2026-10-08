# UI_ARCHITECTURE — Milestone 2

How the browser UI in `apps/web` is built on top of `@isleforge/game-engine`
without duplicating a single rule.

## Stack

Vite 6 + React 18 + TypeScript (strict). No UI framework beyond React; no
CSS framework — a hand-rolled design system in `src/styles/`. Zero game-logic
dependencies beyond the engine package.

## State flow (the one rule)

```
Game Engine (Game instance)
      ↓  dispatch(cmd) → events | EngineError
Game State Adapter (useGame hook — snapshots only)
      ↓  state: GameState (cloned), legal: Command[]
React Components (render snapshots; emit intents)
```

- **Game state comes from the engine.** `useIsleforgeGame` owns the `Game`
  instance, exposes `state` (a fresh `getState()` clone per dispatch tick),
  `dispatch` (catches `EngineError` → friendly toast), and `newGame`.
- **UI-only state stays in components:** selected build, open modal, hover,
  dice-roll animation flag, toasts, fresh-piece animation ids.
- **Legality is never recomputed in React.** `legalCommands(state, humanId)`
  (engine) feeds the build menu, placement targets, and action enablement.
  `buildOptions()` only *reads* affordability + legal counts to produce
  labels and disabled reasons.
- **The active actor is derived, not read.** The engine does not update
  `currentPlayerId` during setup (the setup cursor is authoritative), so the
  UI resolves the actor via `activeActor(state)` — setup cursor, then pending
  discarder, then `currentPlayerId`. TopBar, PlayerPanel, ControlDeck, and the
  bot runner all use it. The returned `api` object is memoized so the bot
  timer effect doesn't reset on unrelated re-renders.

## Component hierarchy

```
App (menu ⇄ game session; ?autopilot/?seed/?fast deep links)
├── MainMenu (name/seed entry, AI battle, rules)
└── GameScreen (orchestrator)
    ├── TopBar (brand, turn/phase chips, timer placeholder, menu/rules)
    ├── PlayerPanel ×4 (avatar, VP, stats, titles; opponents: counts only)
    ├── GameBoard (SVG)
    │   ├── HexTile ×19 (terrain gradients + vector motifs)
    │   ├── NumberToken ×18 (number + probability pips)
    │   ├── Port ×9 (3:1 / 2:1 badges)
    │   ├── RaiderToken, Road ×n, Settlement/City ×n
    │   └── Target (placement/raider targets — keyboard accessible)
    ├── ControlDeck (human)
    │   ├── ResourceBar, DevCardHand, Dice, ActionBar, BuildMenu
    ├── LogChatTabs (GameLog from engine events | Chat placeholder)
    └── Modals: Trade, Discard, Harvest, Embargo, Steal, Menu, Rules,
        Confirm, GameEnd
```

## Board rendering

SVG, `viewBox` fitted to engine topology. Geometry is *parsed* from engine
ids (`"x.xxx,y.yyy"` corners, `"a|b"` edges) with the same hex math — the UI
never rebuilds the topology. Layers: tiles → ports → roads → buildings →
raider → targets. `React.memo` on the board; ownership maps memoized.

Board modes (from `GameScreen`):
- `idle` — no targets.
- `place { build, targets }` — setup placements and build-menu placements;
  targets are the engine-validated legal ids.
- `raider { targets }` — every tile except the raider's.

Animations (CSS only, never blocking state): placement pop, raider hop,
dice shake, pulsing target halos, turn glow. `prefers-reduced-motion`
disables them.

## Demo bot (NOT Milestone 3)

`src/game/bot.ts` — `SimpleBot`: picks reasonable moves *among*
`legalCommands()` output (priority: city > settlement > road > card > trade >
end turn). No difficulties, no personalities, no lookahead. It exists so one
human can play a full local game. Bots also auto-answer trade proposals via
`botAcceptsTrade` (rough value heuristic + noise). The M3 AI will replace
this module behind the same `chooseBotMove(state, playerId, rng)` shape.

The bot runner lives in `GameScreen`: an effect watches `activeActor(state)`;
when a bot must act, it dispatches after ~700ms (80ms with `?fast=1`).

## Interaction model

| Intent | Engine command(s) |
|---|---|
| Click glowing corner/edge | `PLACE_*` / `BUILD_*` |
| Click own settlement (city selected) | `BUILD_CITY` |
| Roll Dice | `ROLL_DICE` |
| Build menu → Dev Card | `BUY_DEVELOPMENT_CARD` |
| Card click | `PLAY_DEVELOPMENT_CARD` (+ param modals for Harvest/Embargo) |
| Guardian / 7 → click tile | `MOVE_RAIDER`, then `STEAL_RESOURCE` |
| Bank tab → Confirm | `TRADE_BANK` ×n |
| Player tab → Send | `TRADE_PROPOSE`; Accept/Decline → `TRADE_ACCEPT`/`TRADE_DECLINE` |
| Discard modal | `DISCARD_RESOURCES` |
| End Turn / Resign | `END_TURN` / `RESIGN` |

Every intent goes through `dispatch`; illegal attempts surface as toasts —
the UI never pre-validates beyond what the engine reports.

## Game log

`formatLog(events, state)` maps the event log to feed entries (aggregating
consecutive same-player/same-reason grants). Internal bookkeeping events
(`TURN_PHASE_CHANGED`, `RESOURCES_PAID`, …) are omitted.

## Responsive

- ≥961px: 3-column grid (opponents | board | you + log/chat), bottom control deck.
- ≤960px: single column; player panels become a horizontal strip; deck sticks
  to the bottom; build menu becomes a bottom sheet.
- ≤560px: compact top bar, bottom-sheet build menu, stats hidden in end screen.

## Accessibility

Real `<button>`s everywhere; SVG targets are `role="button"` + `tabIndex` +
`aria-label` + Enter/Space handling; dialogs are `aria-modal` with Esc and
initial focus; `aria-live` on log, turn indicator, and toasts; visible
focus rings; tooltips via `data-tip` (focus-visible accessible).

## Deep links (also used by E2E)

`?quick=1` boot straight into a human game; `?autopilot=1` all-bot battle;
`?seed=N` fixed island; `?fast=1` 80ms bot delay; `?name=X` captain name.

## Performance notes

`legalCommands` costs ~90ms (probe-based by design). It runs only for the
human's turn (memoized per state) and once per bot command — fine for
turn-based play at 60fps; the board itself re-renders only on state ticks.
