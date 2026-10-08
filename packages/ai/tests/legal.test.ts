/** The AI only ever returns commands the engine accepts. */
import { describe, expect, it } from 'vitest';
import { legalCommands } from '@isleforge/game-engine';
import { activeActor, makeAgent, newGame } from './helpers.js';
import { DIFFICULTIES, PERSONALITIES } from '../src/types.js';

describe('legal action guarantee', () => {
  it('never returns an illegal command across difficulties/personalities', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const personality of PERSONALITIES) {
        const game = newGame(100 + DIFFICULTIES.indexOf(difficulty));
        const agents = [1, 2, 3, 4].map(() =>
          makeAgent(difficulty, personality, 999),
        );
        let moves = 0;
        while (moves < 60) {
          const st = game.getState();
          if (st.phase === 'gameover') break;
          const actor = activeActor(st)!;
          const agent = agents[Number(actor.slice(1)) - 1]!;
          const cmd = agent.chooseAction(st, actor);
          expect(cmd, `${difficulty}/${personality} move ${moves}`).not.toBeNull();
          // The chosen command must be legal on the TRUE state…
          const legal = legalCommands(st, actor).map((c) => JSON.stringify(c));
          expect(legal).toContain(JSON.stringify(cmd!));
          // …and dispatch must accept it.
          expect(() => game.dispatch(cmd!)).not.toThrow();
          moves++;
        }
        expect(moves).toBeGreaterThan(0);
      }
    }
  }, 120000);

  it('returns null (never throws) when the player has no moves', () => {
    const game = newGame(5);
    const agent = makeAgent();
    const st = game.getState();
    // p2 is not the setup actor on move 0.
    const cmd = agent.chooseAction(st, 'p2');
    expect(cmd).toBeNull();
  });
});
