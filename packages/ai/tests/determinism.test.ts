/** Same (state, seed, config) → same action. No Math.random anywhere. */
import { describe, expect, it } from 'vitest';
import { activeActor, makeAgent, newGame, playUntil } from './helpers.js';
import { DIFFICULTIES, PERSONALITIES } from '../src/types.js';

describe('determinism', () => {
  it('is deterministic per (state, seed, config)', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const personality of PERSONALITIES) {
        const game = newGame(77);
        const agents = [1, 2, 3, 4].map(() => makeAgent(difficulty, personality, 1234));
        playUntil(game, agents, (g) => g.getState().turnNumber >= 6, 400);
        const st = game.getState();
        const actor = activeActor(st)!;
        const a = makeAgent(difficulty, personality, 1234).chooseAction(st, actor);
        const b = makeAgent(difficulty, personality, 1234).chooseAction(st, actor);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    }
  }, 120000);

  it('differs with different seeds (noise actually varies)', () => {
    // Easy has heavy noise: different seeds should sometimes differ.
    const game = newGame(77);
    const seen = new Set<string>();
    for (let s = 0; s < 10; s++) {
      const st = game.getState();
      const cmd = makeAgent('easy', 'balanced', s).chooseAction(st, 'p1');
      if (cmd) seen.add(JSON.stringify(cmd));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
