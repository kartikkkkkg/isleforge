/**
 * @isleforge/ai — strategic AI opponents for Isleforge.
 *
 * Entry points:
 *   createBot(config)      — a BotAgent that picks one legal command per call
 *   shouldAcceptTrade(...) — answer a human's trade proposal
 *   simulateGames(...)     — AI-vs-AI simulation harness (no React)
 *
 * The AI never mutates engine state and never sees hidden information:
 * every decision is one of legalCommands() on the player's masked view,
 * validated again by Game.dispatch().
 */

export { createBot, DIFFICULTY_ORDER } from './agent.js';
export { createRng } from './rng.js';
export { getWeights } from './weights.js';
export { shouldAcceptTrade } from './trade.js';
export { simulateGame, simulateGames } from './simulation.js';
export {
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
} from './evaluate.js';
export {
  armyRaceTension,
  assessThreats,
  cornerYield,
  frontierCorners,
  pips,
  playerProduction,
  portAtCorner,
  publicVp,
  resourceTotal,
  roadRaceTension,
  tileExpected,
  touchesOpponentRoad,
} from './analysis.js';
export type {
  BotAgent,
  BotConfig,
  DecisionDebug,
  Difficulty,
  EvalReason,
  Personality,
  RandomSource,
  ResourceValuation,
  ScoredAction,
  Weights,
} from './types.js';
export { DIFFICULTIES, PERSONALITIES } from './types.js';
export type { SimGameResult, SimSeat, SimSummary } from './simulation.js';
