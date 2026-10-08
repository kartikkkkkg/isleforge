/* Slow test (~1 min): the demo SimpleBot plays a complete game against the
   real engine until someone wins. Proves the bot never gets stuck, never
   picks an illegal command, and the engine reaches gameover through the
   exact bot the UI uses. */

import { describe, expect, it } from 'vitest';
import { Game } from '@isleforge/game-engine';
import { chooseBotMove, createBotRng } from '../src/game/bot';
import { activeActor } from '../src/game/useGame';

describe('SimpleBot full game', () => {
  it('plays seed 7 to gameover without stalling or illegal commands', () => {
    const colors = ['ember', 'tide', 'moss', 'dune'] as const;
    const names = ['Coral', 'Marina', 'Reef', 'Pearl'];
    const game = new Game({
      seed: 7,
      players: names.map((name, i) => ({ id: `p${i + 1}`, name, color: colors[i] })),
    });
    const rng = createBotRng(7);
    let moves = 0;
    const maxMoves = 5000;
    while (game.getState().phase !== 'gameover' && moves < maxMoves) {
      const state = game.getState();
      const actor = activeActor(state);
      expect(actor, `an actor must be available (phase ${state.phase})`).toBeTruthy();
      const cmd = chooseBotMove(state, actor!, rng);
      expect(cmd, `bot must find a move for ${actor} (phase ${state.phase})`).toBeTruthy();
      // dispatch() throws on illegal commands — so every move is legal by construction.
      game.dispatch(cmd!);
      moves++;
    }
    const final = game.getState();
    expect(final.phase).toBe('gameover');
    expect(final.winnerId).toBeTruthy();
    expect(moves).toBeLessThan(maxMoves);
  }, 300000);
});
