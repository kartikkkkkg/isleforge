/**
 * @isleforge/ai — core types.
 *
 * The AI only ever *selects* among engine commands. It never mutates state,
 * generates dice, or touches internals: every decision flows through
 * `legalCommands()` and `Game.dispatch()`, exactly like a human's clicks.
 */

import type { Command, GameState, ResourceType } from '@isleforge/game-engine';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export type Personality =
  | 'balanced'
  | 'aggressive'
  | 'builder'
  | 'trader'
  | 'opportunist';

export const DIFFICULTIES: readonly Difficulty[] = [
  'easy',
  'normal',
  'hard',
  'expert',
];
export const PERSONALITIES: readonly Personality[] = [
  'balanced',
  'aggressive',
  'builder',
  'trader',
  'opportunist',
];

/** Injectable randomness. Never use Math.random() inside the AI package. */
export interface RandomSource {
  /** Uniform [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
  /** Uniform pick, or undefined for an empty array. */
  pick<T>(arr: readonly T[]): T | undefined;
  /** A shuffled copy. */
  shuffle<T>(arr: readonly T[]): T[];
}

export interface BotConfig {
  difficulty: Difficulty;
  personality: Personality;
  /** Seed for all AI randomness (decision noise, tie-breaks). */
  seed: number;
  /** Safety cap on commands issued on a single turn. Default 40. */
  maxActionsPerTurn?: number;
  /** Enable verbose console debug logging. Default false. */
  debug?: boolean;
}

/** One scored evaluation reason, for the debug panel. */
export interface EvalReason {
  label: string;
  points: number;
}

export interface ScoredAction {
  command: Command;
  score: number;
  reasons: EvalReason[];
}

export interface DecisionDebug {
  playerId: string;
  phase: string;
  goal: string;
  /** Top candidates considered, best first. */
  candidates: { label: string; score: number }[];
  selected: string;
  reasons: EvalReason[];
  /** Milliseconds the decision took. */
  elapsedMs: number;
}

/**
 * A strategic AI opponent. `chooseAction` returns the single best legal
 * command for `playerId` right now, or null when the player has no legal
 * move (healthy games always have at least END_TURN / ROLL_DICE).
 *
 * Implementations must be deterministic for a fixed (state, config) pair.
 */
export interface BotAgent {
  readonly config: Required<Pick<BotConfig, 'difficulty' | 'personality' | 'seed'>>;
  chooseAction(state: GameState, playerId: string): Command | null;
  /** Debug info about the most recent decision (always recorded, cheap). */
  readonly lastDecision: DecisionDebug | null;
  /** Number of commands issued on the current turn (safety accounting). */
  readonly actionsThisTurn: number;
  /** Call when a new turn starts for anyone (resets the safety counter). */
  notifyTurnStarted(playerId: string): void;
}

/** Strategic evaluation weights. Personalities scale these knobs. */
export interface Weights {
  /** Value per expected resource per turn. */
  production: number;
  /** Bonus per distinct resource type produced. */
  diversity: number;
  /** Value per victory point. */
  vp: number;
  /** Extra multiplier on VP value when close to winning (0..1 urgency handled separately). */
  vpUrgency: number;
  /** Bonus for roads that extend toward open settlement spots. */
  expansion: number;
  /** Value of holding a useful port. */
  port: number;
  /** Bonus for blocking an opponent's expansion / production. */
  blocking: number;
  /** Multiplier on raider-target value. */
  raiderAggression: number;
  /** Weight for contesting largest army. */
  armyRace: number;
  /** Weight for contesting longest road. */
  roadRace: number;
  /** Willingness to trade with the bank (0..1 gate). */
  tradeWillingness: number;
  /** Base value of buying a development card. */
  cardBuy: number;
  /** Decision noise (stddev-ish scale). 0 = fully deterministic best pick. */
  noise: number;
  /** Bonus multiplier for city upgrades. */
  cityBias: number;
  /** Bonus multiplier for new settlements. */
  settlementBias: number;
  /** Bonus multiplier for roads. */
  roadBias: number;
  /** Penalty per resource card held past the raider threshold (risk aversion). */
  hoardingPenalty: number;
}

export type ResourceValuation = Record<ResourceType, number>;
