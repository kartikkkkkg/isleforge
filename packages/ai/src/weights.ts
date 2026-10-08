/**
 * Evaluation weights per (difficulty, personality).
 *
 * Difficulty controls evaluation *depth* and *noise*:
 *   easy   — heavy noise, shallow heuristics (makes mistakes)
 *   normal — light noise, solid heuristics
 *   hard   — no noise, full heuristics incl. blocking and races
 *   expert — no noise, full heuristics + 1-ply lookahead in the agent
 *
 * Personality scales the strategic *knobs* (never just the seed).
 */

import type { Difficulty, Personality, Weights } from './types.js';

const BASE: Weights = {
  production: 10,
  diversity: 6,
  vp: 22,
  vpUrgency: 30,
  expansion: 5,
  port: 7,
  blocking: 8,
  raiderAggression: 6,
  armyRace: 5,
  roadRace: 6,
  tradeWillingness: 0.5,
  cardBuy: 9,
  noise: 0,
  cityBias: 1.15,
  settlementBias: 1.0,
  roadBias: 0.9,
  hoardingPenalty: 1.2,
};

/** Personality multipliers applied on top of the difficulty base. */
const PERSONALITY_MODS: Record<Personality, Partial<Weights>> = {
  balanced: {},
  aggressive: {
    raiderAggression: 14,
    blocking: 16,
    armyRace: 12,
    vpUrgency: 36,
    tradeWillingness: 0.35,
    cardBuy: 12,
  },
  builder: {
    production: 14,
    diversity: 9,
    expansion: 10,
    settlementBias: 1.35,
    cityBias: 1.35,
    roadBias: 1.1,
    port: 10,
    raiderAggression: 3,
    armyRace: 2,
  },
  trader: {
    tradeWillingness: 0.95,
    port: 14,
    cardBuy: 14,
    diversity: 10,
    production: 8,
  },
  opportunist: {
    roadRace: 14,
    armyRace: 11,
    vpUrgency: 44,
    expansion: 9,
    blocking: 12,
    noise: 4,
    cardBuy: 12,
  },
};

const DIFFICULTY_MODS: Record<Difficulty, Partial<Weights>> = {
  // Easy: mostly noise-driven; heuristics barely matter (mistakes happen).
  easy: { noise: 26, production: 5, vp: 12, blocking: 2, armyRace: 1, roadRace: 1, raiderAggression: 2, tradeWillingness: 0.3, cardBuy: 4 },
  normal: { noise: 5 },
  hard: { noise: 0, blocking: 12, armyRace: 8, roadRace: 9, vpUrgency: 36 },
  expert: { noise: 0, blocking: 14, armyRace: 10, roadRace: 11, vpUrgency: 42, production: 12 },
};

function applyMods(base: Weights, mods: Partial<Weights>): Weights {
  const out = { ...base };
  for (const [k, v] of Object.entries(mods)) {
    if (v !== undefined) (out as Record<string, number>)[k] = v as number;
  }
  return out;
}

export function getWeights(
  difficulty: Difficulty,
  personality: Personality,
): Weights {
  return applyMods(
    applyMods(BASE, DIFFICULTY_MODS[difficulty]),
    PERSONALITY_MODS[personality],
  );
}
