/**
 * AI-vs-AI simulation quality gates.
 *
 * The full 100-game acceptance run happens out-of-band (see AI_ARCHITECTURE.md
 * for the recorded results); this suite runs a representative slice inside
 * the normal test budget.
 */
import { describe, expect, it } from 'vitest';
import { simulateGames, type SimSeat } from '../src/simulation.js';

const MIXED: SimSeat[] = [
  { name: 'Hard-A', difficulty: 'hard', personality: 'balanced' },
  { name: 'Normal-A', difficulty: 'normal', personality: 'aggressive' },
  { name: 'Easy-A', difficulty: 'easy', personality: 'builder' },
  { name: 'Expert-A', difficulty: 'expert', personality: 'opportunist' },
];

describe('simulation quality', () => {
  it('completes mixed-difficulty games with no illegal commands', () => {
    const seeds = [11, 22, 33, 44, 55, 66, 77, 88];
    const s = simulateGames(MIXED, seeds);
    expect(s.completed).toBe(s.games);
    expect(s.illegalCommands).toBe(0);
    // Every game has a real winner at 10 VP.
    for (const r of s.results) {
      expect(r.winner).not.toBeNull();
      const i = MIXED.findIndex((_, k) => `p${k + 1}` === r.winner);
      expect(r.vp[i]).toBeGreaterThanOrEqual(10);
    }
    // Games terminate in a sane number of turns.
    expect(s.avgTurns).toBeLessThan(150);
    expect(s.avgTurns).toBeGreaterThan(5);
    console.log(
      `mixed: ${s.games} games, avg ${s.avgTurns.toFixed(1)} turns, ` +
        `wins ${s.wins.join('/')}, slowest decision ${s.maxDecisionMs}ms`,
    );
  }, 300000);

  it('same-difficulty round robins complete', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const seats: SimSeat[] = [1, 2, 3, 4].map((i) => ({
        name: `${d}-${i}`,
        difficulty: d,
        personality: 'balanced' as const,
      }));
      const s = simulateGames(seats, [101, 202]);
      expect(s.completed).toBe(2);
      expect(s.illegalCommands).toBe(0);
    }
  }, 300000);
});
