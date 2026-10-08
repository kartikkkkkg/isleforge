/**
 * BotAgent implementation: selects one legal engine command per call.
 *
 * Flow per decision:
 *   public view (masked) → legalCommands() → score candidates →
 *   difficulty noise → safety gates → command
 *
 * The agent never sees hidden info (opponent dev-card types are masked via
 * publicGameState) and never touches engine internals.
 */

import {
  COSTS,
  RESOURCES,
  legalCommands,
  publicGameState,
  type Command,
  type GameState,
  type ResourceCount,
  type ResourceType,
} from '@isleforge/game-engine';
import { createRng } from './rng.js';
import { getWeights } from './weights.js';
import {
  buildEvalContext,
  evaluateBankTrade,
  evaluateCity,
  evaluateDevCardBuy,
  evaluateDevCardPlay,
  evaluateDiscard,
  evaluatePosition,
  evaluateRaider,
  evaluateRoad,
  evaluateSettlement,
  evaluateSteal,
  wouldWinWith,
  type EvalContext,
  type Scored,
} from './evaluate.js';
import type { AnyState } from './analysis.js';
import type {
  BotAgent,
  BotConfig,
  DecisionDebug,
  Difficulty,
  RandomSource,
  ScoredAction,
  Weights,
} from './types.js';

/** FNV-1a hash for per-decision RNG seeding. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const DEFAULT_MAX_ACTIONS = 40;

function labelOf(cmd: Command): string {
  switch (cmd.type) {
    case 'PLACE_SETTLEMENT': return `PLACE_SETTLEMENT@${cmd.cornerId}`;
    case 'PLACE_ROAD': return `PLACE_ROAD@${cmd.edgeId}`;
    case 'ROLL_DICE': return 'ROLL_DICE';
    case 'DISCARD_RESOURCES': return 'DISCARD';
    case 'MOVE_RAIDER': return `RAIDER→${cmd.tileKey}`;
    case 'STEAL_RESOURCE': return `STEAL←${cmd.targetPlayerId}`;
    case 'BUILD_ROAD': return `ROAD@${cmd.edgeId}`;
    case 'BUILD_SETTLEMENT': return `SETTLEMENT@${cmd.cornerId}`;
    case 'BUILD_CITY': return `CITY@${cmd.cornerId}`;
    case 'BUY_DEVELOPMENT_CARD': return 'BUY_CARD';
    case 'PLAY_DEVELOPMENT_CARD': return `PLAY_CARD`;
    case 'TRADE_BANK': return `BANK ${cmd.give}→${cmd.receive}`;
    case 'END_TURN': return 'END_TURN';
    default: return cmd.type;
  }
}

/** Project simple structural effects of a build/buy/trade (for lookahead). */
function projectCommand(state: GameState, playerId: string, cmd: Command): GameState {
  const next: GameState = {
    ...state,
    events: [],
    players: state.players.map((p) => {
      if (p.id !== playerId) return p;
      const c: ResourceCount = { ...p.resources };
      const pay = (cost: ResourceCount) => {
        for (const r of RESOURCES) c[r] = Math.max(0, c[r] - cost[r]);
      };
      switch (cmd.type) {
        case 'BUILD_ROAD': case 'PLACE_ROAD':
          pay(COSTS.road); return { ...p, resources: c, roads: [...p.roads, cmd.edgeId] };
        case 'BUILD_SETTLEMENT': case 'PLACE_SETTLEMENT':
          pay(COSTS.settlement); return { ...p, resources: c, settlements: [...p.settlements, cmd.cornerId] };
        case 'BUILD_CITY':
          pay(COSTS.city);
          return { ...p, resources: c, settlements: p.settlements.filter((x) => x !== cmd.cornerId), cities: [...p.cities, cmd.cornerId] };
        case 'BUY_DEVELOPMENT_CARD':
          pay(COSTS.devCard); return { ...p, resources: c };
        case 'TRADE_BANK': {
          const ratio = cmd.give === cmd.receive ? 4 : 4; // ratio resolved by scorer; approx here
          c[cmd.give] = Math.max(0, c[cmd.give] - ratio);
          c[cmd.receive] += 1;
          return { ...p, resources: c };
        }
        default:
          return p;
      }
    }),
  };
  return next;
}

class Agent implements BotAgent {
  readonly config: BotAgent['config'];
  private readonly weights: Weights;
  private readonly baseSeed: number;
  private readonly debug: boolean;
  private readonly maxActions: number;
  private _lastDecision: DecisionDebug | null = null;
  private _actionsThisTurn = 0;
  private _turnOwner: string | null = null;

  constructor(config: BotConfig) {
    this.config = {
      difficulty: config.difficulty,
      personality: config.personality,
      seed: config.seed,
    };
    this.weights = getWeights(config.difficulty, config.personality);
    this.baseSeed = config.seed >>> 0;
    this.debug = config.debug ?? false;
    this.maxActions = config.maxActionsPerTurn ?? DEFAULT_MAX_ACTIONS;
  }

  get lastDecision(): DecisionDebug | null {
    return this._lastDecision;
  }

  get actionsThisTurn(): number {
    return this._actionsThisTurn;
  }

  notifyTurnStarted(playerId: string): void {
    if (this._turnOwner !== playerId) {
      this._turnOwner = playerId;
      this._actionsThisTurn = 0;
    }
  }

  /** Deterministic RNG for one decision: same (state, config) → same stream. */
  private rngFor(eventCount: number, playerId: string): RandomSource {
    const h = hashStr(`${this.baseSeed}:${playerId}:${eventCount}`);
    return createRng(h);
  }

  chooseAction(state: GameState, playerId: string): Command | null {
    const t0 = Date.now();
    const eventCount = state.events.length;
    // Auto-reset the per-turn safety counter when the turn changes, so the
    // agent can never get stuck even if the caller forgets notifyTurnStarted.
    const turnKey = state.phase === 'setup' && state.setup
      ? `setup:${state.setup.cursor}`
      : `${state.turnNumber}:${playerId}:${state.phase}`;
    if (this._turnOwner !== turnKey) {
      this._turnOwner = turnKey;
      this._actionsThisTurn = 0;
    }
    // Masked view: opponent dev-card types are hidden, like for a human.
    // Drop the event log before cloning — probes don't read it and it's the
    // largest part of the state.
    const view = publicGameState({ ...state, events: [] }, playerId);
    // Probing on the masked view is safe: legality only depends on the
    // acting player's own (unmasked) cards/resources/position. Skipping
    // TRADE_PROPOSE enumeration (120 probes the M3 AI never initiates).
    const legal = legalCommands(view as unknown as GameState, playerId, {
      skipTradePropose: true,
    }).filter((c) => c.type !== 'RESIGN');
    if (legal.length === 0) {
      this._lastDecision = null;
      return null;
    }

    const rng = this.rngFor(eventCount, playerId);
    const ctx = buildEvalContext(view, playerId, this.weights);
    const diff: Difficulty = this.config.difficulty;

    let scored: ScoredAction[];
    let goal = 'Develop';
    switch (view.phase) {
      case 'setup':
        goal = 'Expand';
        scored = this.scoreSetup(view, playerId, legal, ctx);
        break;
      case 'roll':
        goal = 'Roll';
        scored = legal.map((c) => ({ command: c, score: 1, reasons: [] }));
        break;
      case 'discard':
        goal = 'Survive the raider';
        scored = this.scoreDiscard(view, playerId, legal, ctx);
        break;
      case 'raider':
        goal = view.pendingSteal ? 'Steal' : 'Place the raider';
        scored = this.scoreRaider(view, playerId, legal, ctx);
        break;
      case 'play':
        goal = this.pickGoal(ctx);
        scored = this.scorePlay(state, view, playerId, legal, ctx);
        break;
      default:
        scored = [];
    }

    if (scored.length === 0) {
      this._lastDecision = null;
      return null;
    }

    // Difficulty noise (easy = erratic, hard/expert = exact).
    const noisy = scored.map((s) => ({
      ...s,
      score: s.score + (rng.next() * 2 - 1) * this.weights.noise,
    }));
    noisy.sort((a, b) => b.score - a.score);

    // Expert: 1-ply lookahead on the top candidates (position after the move).
    let ranked = noisy;
    if (diff === 'expert') {
      const base = evaluatePosition(view, playerId, this.weights);
      ranked = noisy.map((s, i) => {
        if (i >= 6) return s;
        const projected = projectCommand(state, playerId, s.command);
        const delta = evaluatePosition(projected, playerId, this.weights) - base;
        return { ...s, score: s.score + delta * 0.6 };
      });
      ranked.sort((a, b) => b.score - a.score);
    }

    let pick = ranked[0]!;
    // Safety: never spin forever — cap actions per turn, then end it.
    this._actionsThisTurn++;
    if (this._actionsThisTurn > this.maxActions) {
      const end = legal.find((c) => c.type === 'END_TURN');
      if (end) pick = { command: end, score: 0, reasons: [{ label: 'safety cap', points: 0 }] };
    }
    // Don't take pointless actions when ending the turn is cleaner.
    if (view.phase === 'play' && pick.score < 0.5) {
      const end = legal.find((c) => c.type === 'END_TURN');
      if (end && pick.command.type !== 'END_TURN') {
        pick = { command: end, score: 0, reasons: [{ label: 'nothing worthwhile', points: 0 }] };
      }
    }

    const elapsedMs = Date.now() - t0;
    this._lastDecision = {
      playerId,
      phase: view.phase,
      goal,
      candidates: ranked.slice(0, 8).map((s) => ({ label: labelOf(s.command), score: Math.round(s.score * 10) / 10 })),
      selected: labelOf(pick.command),
      reasons: pick.reasons,
      elapsedMs,
    };
    if (this.debug) {
      const me = view.players.find((p) => p.id === playerId);
      console.log(
        `AI: ${me?.name ?? playerId}\nGoal: ${goal}\nBest action: ${labelOf(pick.command)}\nScore: ${(Math.round(pick.score * 10) / 10).toFixed(1)}\n\nWhy:\n` +
          pick.reasons.map((x) => `${x.points >= 0 ? '+' : ''}${x.points.toFixed(1)} ${x.label}`).join('\n'),
      );
    }
    return pick.command;
  }

  private pickGoal(ctx: EvalContext): string {
    if (ctx.urgency > 0.7) return 'Win now';
    if (ctx.topThreat && ctx.topThreat.turnsToWin <= 4) return 'Stop the leader';
    if (ctx.roadTension > 0.6) return 'Race for longest road';
    if (ctx.armyTension > 0.6) return 'Race for largest army';
    return 'Expand';
  }

  private scoreSetup(
    state: AnyState,
    playerId: string,
    legal: Command[],
    ctx: EvalContext,
  ): ScoredAction[] {
    const me = state.players.find((p) => p.id === playerId)!;
    const second = me.settlements.length > 0;
    return legal.map((cmd) => {
      let s: Scored;
      if (cmd.type === 'PLACE_SETTLEMENT') {
        s = evaluateSettlement(state, playerId, cmd.cornerId, ctx, second);
      } else if (cmd.type === 'PLACE_ROAD') {
        s = evaluateRoad(state, playerId, cmd.edgeId, ctx);
      } else {
        s = { score: -50, reasons: [] };
      }
      return { command: cmd, ...s };
    });
  }

  private scoreDiscard(
    state: AnyState,
    playerId: string,
    legal: Command[],
    ctx: EvalContext,
  ): ScoredAction[] {
    return legal
      .filter((c) => c.type === 'DISCARD_RESOURCES')
      .map((cmd) => ({
        command: cmd,
        ...evaluateDiscard(state, playerId, (cmd as { resources: ResourceCount }).resources, ctx),
      }));
  }

  private scoreRaider(
    state: AnyState,
    playerId: string,
    legal: Command[],
    ctx: EvalContext,
  ): ScoredAction[] {
    if (state.pendingSteal) {
      const steals = legal.filter((c) => c.type === 'STEAL_RESOURCE');
      return steals.map((cmd) => {
        const target = ctx.threats.find(
          (t) => t.playerId === (cmd as { targetPlayerId: string }).targetPlayerId,
        );
        return { command: cmd, ...evaluateSteal(target, ctx) };
      });
    }
    return legal
      .filter((c) => c.type === 'MOVE_RAIDER')
      .map((cmd) => ({
        command: cmd,
        ...evaluateRaider(state, playerId, (cmd as { tileKey: string }).tileKey, ctx),
      }));
  }

  private scorePlay(
    fullState: GameState,
    state: AnyState,
    playerId: string,
    legal: Command[],
    ctx: EvalContext,
  ): ScoredAction[] {
    // 1. Immediate victory always wins.
    for (const cmd of legal) {
      if (
        (cmd.type === 'BUILD_SETTLEMENT' || cmd.type === 'BUILD_CITY' ||
          cmd.type === 'BUILD_ROAD' || cmd.type === 'PLACE_SETTLEMENT' ||
          cmd.type === 'PLACE_ROAD') &&
        wouldWinWith(fullState, playerId, cmd)
      ) {
        return [{
          command: cmd,
          score: 10000,
          reasons: [{ label: 'wins the game immediately', points: 10000 }],
        }];
      }
    }

    const me = state.players.find((p) => p.id === playerId)!;
    const out: ScoredAction[] = [];
    for (const cmd of legal) {
      let s: Scored | null = null;
      switch (cmd.type) {
        case 'BUILD_CITY':
          s = evaluateCity(state, playerId, cmd.cornerId, ctx);
          break;
        case 'BUILD_SETTLEMENT':
          s = evaluateSettlement(state, playerId, cmd.cornerId, ctx);
          break;
        case 'BUILD_ROAD':
          s = evaluateRoad(state, playerId, cmd.edgeId, ctx);
          break;
        case 'BUY_DEVELOPMENT_CARD':
          s = evaluateDevCardBuy(state, playerId, ctx);
          break;
        case 'PLAY_DEVELOPMENT_CARD': {
          const card = me.devCards.find((c) => c.uid === cmd.cardUid);
          // Public view keeps MY cards typed; hidden ones can't be evaluated.
          if (card && card.type !== 'hidden') {
            s = evaluateDevCardPlay(
              state,
              playerId,
              { uid: card.uid, type: card.type, playable: card.playable },
              cmd,
              ctx,
            );
          } else {
            s = { score: -50, reasons: [{ label: 'unknown card', points: -50 }] };
          }
          break;
        }
        case 'TRADE_BANK':
          s = evaluateBankTrade(state, playerId, cmd.give, cmd.receive, ctx);
          break;
        case 'END_TURN':
          s = { score: 0, reasons: [{ label: 'end turn', points: 0 }] };
          break;
        default:
          s = { score: -50, reasons: [] };
      }
      // Bank trades are scored on their merits; the "nothing worthwhile"
      // fallback below keeps the AI from churning.
      out.push({ command: cmd, ...s });
    }
    return out;
  }
}

export function createBot(config: BotConfig): BotAgent {
  return new Agent(config);
}

/** Difficulty levels in ascending strength (for round-robin tests). */
export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

export type { ResourceType };
