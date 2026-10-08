/**
 * AI-vs-AI simulation harness. No React, no DOM — pure engine + agents.
 * Runs many seeded games and collects quality statistics.
 */

import {
  Game,
  victoryPoints,
  type GameState,
} from '@isleforge/game-engine';
import { createBot } from './agent.js';
import type { BotAgent } from './types.js';
import type { Difficulty, Personality } from './types.js';

export interface SimSeat {
  name: string;
  difficulty: Difficulty;
  personality: Personality;
}

export interface SimGameResult {
  seed: number;
  completed: boolean;
  /** False when the turn cap or a stuck agent aborted the game. */
  winner: string | null;
  turns: number;
  moves: number;
  /** Per-seat total VP (incl. hidden landmarks). */
  vp: number[];
  settlements: number[];
  cities: number[];
  roads: number[];
  cardsBought: number[];
  guardiansPlayed: number[];
  longestRoadHolder: string | null;
  largestArmyHolder: string | null;
  illegalCommands: number;
  maxDecisionMs: number;
}

export interface SimSummary {
  games: number;
  completed: number;
  /** Wins per seat index. */
  wins: number[];
  avgVp: number[];
  avgTurns: number;
  avgMoves: number;
  avgSettlements: number[];
  avgCities: number[];
  avgRoads: number[];
  avgCardsBought: number[];
  longestRoadWins: number[];
  largestArmyWins: number[];
  illegalCommands: number;
  /** Slowest single decision observed, ms. */
  maxDecisionMs: number;
  results: SimGameResult[];
}

function activeActor(state: GameState): string | null {
  if (state.phase === 'gameover') return null;
  if (state.phase === 'setup' && state.setup) {
    return state.setup.order[state.setup.cursor] ?? null;
  }
  if (state.phase === 'discard' && state.pendingDiscards) {
    return Object.keys(state.pendingDiscards)[0] ?? null;
  }
  return state.currentPlayerId;
}

export function simulateGame(
  seats: SimSeat[],
  seed: number,
  opts: { maxTurns?: number; maxMoves?: number } = {},
): SimGameResult {
  const maxTurns = opts.maxTurns ?? 400;
  const maxMoves = opts.maxMoves ?? 6000;
  const game = new Game({
    seed,
    players: seats.map((s, i) => ({ id: `p${i + 1}`, name: s.name })),
  });
  const agents = new Map<string, BotAgent>();
  seats.forEach((s, i) => {
    agents.set(
      `p${i + 1}`,
      createBot({
        difficulty: s.difficulty,
        personality: s.personality,
        seed: (seed ^ (0x9e3779b9 + i * 0x85ebca6b)) >>> 0,
      }),
    );
  });

  let moves = 0;
  let illegal = 0;
  let maxDecisionMs = 0;
  let lastTurn = 0;
  let completed = false;

  while (moves < maxMoves) {
    const state = game.getState();
    if (state.turnNumber > maxTurns) break;
    if (state.phase === 'gameover') {
      completed = true;
      break;
    }
    lastTurn = state.turnNumber;
    const actor = activeActor(state);
    if (!actor) break;
    const agent = agents.get(actor)!;
    agent.notifyTurnStarted(actor);
    const t0 = Date.now();
    const cmd = agent.chooseAction(state, actor);
    const dt = Date.now() - t0;
    if (dt > maxDecisionMs) maxDecisionMs = dt;
    if (!cmd) break; // stuck — should not happen
    try {
      game.dispatch(cmd);
    } catch {
      illegal++;
      break; // an illegal command is a hard failure — abort the game
    }
    moves++;
  }

  const final = game.getState();
  if (final.phase === 'gameover') completed = true;

  const n = seats.length;
  const vp = Array<number>(n).fill(0);
  const settlements = Array<number>(n).fill(0);
  const cities = Array<number>(n).fill(0);
  const roads = Array<number>(n).fill(0);
  const cardsBought = Array<number>(n).fill(0);
  const guardiansPlayed = Array<number>(n).fill(0);
  final.players.forEach((p, i) => {
    vp[i] = victoryPoints(p, final).total;
    settlements[i] = p.settlements.length;
    cities[i] = p.cities.length;
    roads[i] = p.roads.length;
    guardiansPlayed[i] = p.guardiansPlayed;
  });
  // Cards bought: count CARD_PURCHASED events per player.
  for (const e of final.events) {
    if (e.type === 'CARD_PURCHASED' && e.playerId) {
      const i = seats.findIndex((_, k) => `p${k + 1}` === e.playerId);
      if (i >= 0) cardsBought[i]!++;
    }
  }

  return {
    seed,
    completed,
    winner: final.winnerId,
    turns: lastTurn,
    moves,
    vp,
    settlements,
    cities,
    roads,
    cardsBought,
    guardiansPlayed,
    longestRoadHolder: final.longestRoad.playerId,
    largestArmyHolder: final.largestArmy.playerId,
    illegalCommands: illegal,
    maxDecisionMs,
  };
}

export function simulateGames(
  seats: SimSeat[],
  seeds: number[],
  opts: { maxTurns?: number; maxMoves?: number } = {},
): SimSummary {
  const results = seeds.map((s) => simulateGame(seats, s, opts));
  const n = seats.length;
  const sum = (f: (r: SimGameResult) => number, i?: number) =>
    results.reduce((a, r) => a + (i === undefined ? f(r) : (f(r) as unknown as number[])[i]!), 0);
  const avg = (f: (r: SimGameResult) => number, i?: number) =>
    results.length ? sum(f, i) / results.length : 0;

  const wins = Array<number>(n).fill(0);
  const longestRoadWins = Array<number>(n).fill(0);
  const largestArmyWins = Array<number>(n).fill(0);
  for (const r of results) {
    if (r.winner) {
      const i = seats.findIndex((_, k) => `p${k + 1}` === r.winner);
      if (i >= 0) wins[i]!++;
    }
    if (r.longestRoadHolder) {
      const i = seats.findIndex((_, k) => `p${k + 1}` === r.longestRoadHolder);
      if (i >= 0) longestRoadWins[i]!++;
    }
    if (r.largestArmyHolder) {
      const i = seats.findIndex((_, k) => `p${k + 1}` === r.largestArmyHolder);
      if (i >= 0) largestArmyWins[i]!++;
    }
  }

  let maxDecisionMs = 0;
  for (const r of results) maxDecisionMs = Math.max(maxDecisionMs, r.maxDecisionMs);

  return {
    games: results.length,
    completed: results.filter((r) => r.completed).length,
    wins,
    avgVp: seats.map((_, i) => avg((r) => r.vp[i]!)),
    avgTurns: avg((r) => r.turns),
    avgMoves: avg((r) => r.moves),
    avgSettlements: seats.map((_, i) => avg((r) => r.settlements[i]!)),
    avgCities: seats.map((_, i) => avg((r) => r.cities[i]!)),
    avgRoads: seats.map((_, i) => avg((r) => r.roads[i]!)),
    avgCardsBought: seats.map((_, i) => avg((r) => r.cardsBought[i]!)),
    longestRoadWins,
    largestArmyWins,
    illegalCommands: results.reduce((a, r) => a + r.illegalCommands, 0),
    maxDecisionMs,
    results,
  };
}
