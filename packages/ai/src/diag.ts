import { simulateGame } from './simulation.js';

const r = simulateGame(
  [0, 1, 2, 3].map((i) => ({
    name: `AI-${i + 1}`,
    difficulty: 'normal' as const,
    personality: 'balanced' as const,
  })),
  1000,
);
console.log(JSON.stringify({ ...r, results: undefined }, null, 1));
