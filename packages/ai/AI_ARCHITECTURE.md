# AI Architecture — Milestone 3

`packages/ai` (`@isleforge/ai`) implements strategic AI opponents for Isleforge.
No React, no DOM. Zero runtime dependencies beyond `@isleforge/game-engine`.

## Core principle

The AI **selects**; the engine **decides**. Every AI action is one of
`legalCommands()` on the player's masked view, dispatched through
`Game.dispatch()` exactly like a human click. The AI cannot:

- mutate state, resources, buildings, or victory points directly
- generate dice results or bypass trade validation
- see hidden information (opponent dev-card types are masked via
  `publicGameState`; evaluators never read opponent resource breakdowns)
- skip engine validation (illegal commands throw; the simulation harness
  treats any throw as a hard failure)

```
AI → chooseAction(state, playerId) → Command → engine validation
     → state transition → UI
```

## Interface

```ts
interface BotAgent {
  readonly config: { difficulty; personality; seed };
  chooseAction(state: GameState, playerId: string): Command | null;
  readonly lastDecision: DecisionDebug | null; // for ?debugAI=1
  readonly actionsThisTurn: number;            // safety accounting
  notifyTurnStarted(playerId: string): void;
}
const agent = createBot({ difficulty: 'hard', personality: 'aggressive', seed: 42 });
```

## Module layout

| File | Responsibility |
|---|---|
| `types.ts` | `Difficulty`, `Personality`, `BotConfig`, `BotAgent`, `RandomSource`, `Weights` |
| `rng.ts` | Deterministic RNG wrapping the engine's `mulberry32` |
| `weights.ts` | `getWeights(difficulty, personality)` — evaluation weight tables |
| `analysis.ts` | Pure public-info helpers: production, threats, frontier, races |
| `evaluate.ts` | Modular scorers returning `{ score, reasons[] }` |
| `agent.ts` | `BotAgent` — phase planners, safety, debug, expert lookahead |
| `trade.ts` | `shouldAcceptTrade` — answering human trade proposals |
| `simulation.ts` | AI-vs-AI harness with quality statistics |

## Evaluators

Each evaluator scores one candidate action; higher is better. All return
human-readable reasons for the debug panel:

- `evaluateSettlement` — expected production (scarcity-weighted), diversity,
  ports, setup complementarity, opponent blocking
- `evaluateRoad` — frontier expansion, longest-road race, corridor contests
- `evaluateCity` — production doubling, +1 VP with urgency scaling
- `evaluateDevCardBuy` / `evaluateDevCardPlay` — per-card-type logic
  (guardian → army+raider, trailblazer → free roads, harvest → bank value,
  embargo → deny leader, landmark → never played)
- `evaluateBankTrade` — scores what the trade **unlocks** (builds affordable
  after but not before), plus scarcity adjustments
- `evaluateRaider` / `evaluateSteal` — hits the most threatening opponent's
  production, never blocks own tiles
- `evaluateDiscard` — keeps high-marginal-utility resources
- `evaluatePosition` — static position score (Expert 1-ply lookahead)
- `wouldWinWith` — immediate-win detector for build commands

`buildEvalContext` computes shared state once per decision: threats (public VP
+ production-based VP rate), urgency (0–1 near 10 VP), marginal resource
utilities, frontier corners, race tension.

## Difficulties

| Level | Noise | Depth |
|---|---|---|
| Easy | high (±26) | shallow heuristics — makes mistakes |
| Normal | light (±5) | solid heuristics |
| Hard | 0 | full heuristics: blocking, races, threats |
| Expert | 0 | Hard + 1-ply lookahead on top-6 candidates via `evaluatePosition` deltas |

Measured decision latency (p95, busy mid-game): easy <50ms, normal <100ms,
hard <250ms, expert <500ms. See `tests/performance.test.ts`.

## Personalities

Personality scales the weight knobs (never just the seed):

- **Balanced** — default weights
- **Aggressive** — raider aggression, blocking, army race, VP urgency
- **Builder** — production, expansion, settlement/city bias, ports
- **Trader** — trade willingness, ports, card buying, diversity
- **Opportunist** — road/army races, VP urgency, blocking, slight noise

## Determinism

No `Math.random()` in the package. Each decision derives its RNG from
`hash(seed, playerId, eventCount)` — the same `(state, config)` always yields
the same action. Tests assert this across all difficulty × personality pairs.

## Safety

- Per-turn action cap (default 40, auto-reset on turn change): forces
  `END_TURN` instead of looping
- `END_TURN` (score 0) is the fallback when no action scores above 0.5 —
  the AI never takes pointless actions to avoid passing
- Immediate-win check runs before all other scoring
- `chooseAction` returns `null` (never throws) when no legal move exists

## Turn planner (play phase)

1. Immediate victory → take it
2. Score every legal command with its evaluator
3. Expert: refine top-6 with 1-ply position lookahead
4. Apply difficulty noise; pick the best
5. Safety gates; `END_TURN` if nothing is worthwhile

Setup / roll / discard / raider phases have dedicated planners. The AI never
initiates player-to-player trades (bank/port only, Milestone 3 scope) but
answers human proposals via `shouldAcceptTrade`.

## Debug

- `createBot({ ..., debug: true })` logs `AI: <name> / Goal / Best action /
  Score / Why (+/- reasons)` to the console
- `agent.lastDecision` always records `{ goal, candidates, selected, reasons,
  elapsedMs }` — the UI's `?debugAI=1` panel renders it (dev only)

## Simulation harness

`simulateGames(seats, seeds)` runs AI-vs-AI games with no React and collects:
wins, avg VP/turns/moves, build counts, card usage, longest-road / largest-army
frequency, illegal-command count, slowest decision.

`npm run simulate -- <games> <difficulty>` runs it from the CLI.

### Acceptance run (2026-10-08)

100 seeded games, 4× normal AI (balanced/aggressive/builder/trader) — run in
the background during development; results recorded here on completion:

- Completed: ___/100, illegal commands: ___, deadlocks: ___
- Wins per seat: ___ / ___ / ___ / ___
- Avg turns: ___, avg moves: ___
- Slowest single decision: ___ms

Smaller in-suite simulation (`tests/simulation.test.ts`): 8 mixed-difficulty
games + 3 same-difficulty round robins, all completing with zero illegal
commands and valid winners.

Hard-vs-Easy matchup (8 seeded games): hard wins ≥ easy wins.

## Performance notes

`legalCommands()` dominates decision cost (~50–60ms; the engine probes each
candidate with a cloned plan). The AI's own scoring adds ~8ms. Two
optimizations keep this in budget:

1. `legalCommands(..., { skipTradePropose: true })` — skips 120
   player-trade probes the M3 AI never initiates (engine enumeration option;
   no rule change)
2. The event log is dropped before the agent's state clone (probes don't read it)

## UI integration

- `apps/web` depends on `@isleforge/ai`; `GameScreen` owns one `BotAgent`
  per bot seat (difficulty/personality from the menu, deterministic seed)
- "X is thinking…" indicator during the presentation delay (700ms, 80ms with
  `?fast=1`); delays are UI-only, never in the agent
- Main menu: AI count (2–3; the engine requires 3–4 players total),
  difficulty, personality or "varied"
- The Milestone 2 demo bot (`apps/web/src/game/bot.ts`) is retained for its
  unit tests; production play uses `@isleforge/ai`
