/**
 * Manual simulation CLI: `npm run simulate -- [games] [difficulty]`
 * Example: npm run simulate -- 20 hard
 */
import { simulateGames, type SimSeat } from './simulation.js';
import type { Difficulty } from './types.js';

const games = Number(process.argv[2] ?? 20);
const difficulty = (process.argv[3] ?? 'normal') as Difficulty;
const personalities = ['balanced', 'aggressive', 'builder', 'trader', 'opportunist'] as const;

const seats: SimSeat[] = [0, 1, 2, 3].map((i) => ({
  name: `AI-${i + 1}`,
  difficulty,
  personality: personalities[i % personalities.length]!,
}));

const seeds = Array.from({ length: games }, (_, i) => 1000 + i);
console.log(`Simulating ${games} games: 4× ${difficulty} AI (varied personalities)…`);
const t0 = Date.now();
const s = simulateGames(seats, seeds);
const dt = Date.now() - t0;

console.log(`Completed: ${s.completed}/${s.games}  illegal: ${s.illegalCommands}`);
console.log(`Wins per seat:        ${s.wins.join(' / ')}`);
console.log(`Avg VP per seat:      ${s.avgVp.map((v) => v.toFixed(2)).join(' / ')}`);
console.log(`Avg turns: ${s.avgTurns.toFixed(1)}  avg moves: ${s.avgMoves.toFixed(0)}`);
console.log(`Avg cities:  ${s.avgCities.map((v) => v.toFixed(2)).join(' / ')}`);
console.log(`Avg roads:   ${s.avgRoads.map((v) => v.toFixed(1)).join(' / ')}`);
console.log(`Avg cards:   ${s.avgCardsBought.map((v) => v.toFixed(2)).join(' / ')}`);
console.log(`Longest-road wins: ${s.longestRoadWins.join(' / ')}`);
console.log(`Largest-army wins: ${s.largestArmyWins.join(' / ')}`);
console.log(`Slowest decision: ${s.maxDecisionMs}ms  total: ${(dt / 1000).toFixed(1)}s`);
