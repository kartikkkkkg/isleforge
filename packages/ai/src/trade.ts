/**
 * Responding to player trade proposals. The AI never *initiates* player
 * trades in Milestone 3 (bank/port only), but it must answer the human's
 * proposals sensibly.
 */

import {
  RESOURCES,
  publicGameState,
  type GameState,
  type ResourceCount,
  type ResourceType,
} from '@isleforge/game-engine';
import { buildEvalContext } from './evaluate.js';
import { createRng } from './rng.js';
import { getWeights } from './weights.js';
import type { Difficulty, Personality } from './types.js';

export interface TradeResponseConfig {
  difficulty: Difficulty;
  personality: Personality;
  seed: number;
}

/**
 * Should the AI accept a trade proposal? Compares marginal values with a
 * personality-scaled fairness bar and a little seeded noise.
 */
export function shouldAcceptTrade(
  state: GameState,
  playerId: string,
  offer: Record<ResourceType, number>,   // what the proposer gives us
  request: Record<ResourceType, number>, // what the proposer wants from us
  config: TradeResponseConfig,
): boolean {
  const weights = getWeights(config.difficulty, config.personality);
  const view = publicGameState(state, playerId);
  const ctx = buildEvalContext(view, playerId, weights);
  const rng = createRng((config.seed ^ 0x51ab) >>> 0);

  let give = 0; // value of what WE would give
  let get = 0;  // value of what WE would receive
  for (const r of RESOURCES) {
    give += (request[r] ?? 0) * ctx.marginal[r];
    get += (offer[r] ?? 0) * ctx.marginal[r];
  }
  if (give <= 0) return get > 0;
  // Fairness bar: traders accept near-even deals, others demand an edge.
  const bar = 1.15 - weights.tradeWillingness * 0.35;
  const noise = (rng.next() - 0.5) * 0.2 * (weights.noise > 0 ? 1 : 0.25);
  return get / give >= bar + noise;
}
