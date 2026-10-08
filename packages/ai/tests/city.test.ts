/** City upgrades target the most productive settlement. */
import { describe, expect, it } from 'vitest';
import { activeActor, makeAgent, newGame, playUntil } from './helpers.js';
import { cornerYield } from '../src/analysis.js';

describe('city evaluation', () => {
  it('upgrades a high-production settlement, not an arbitrary one', () => {
    // Drive games until some hard agent builds a city, then check the
    // upgraded settlement was a strong one.
    for (const seed of [42, 99]) {
      const game = newGame(seed);
      const agents = [1, 2, 3, 4].map(() => makeAgent('hard', 'builder', 11));
      let found: { cornerId: string; settlements: string[]; playerId: string } | null = null;
      playUntil(
        game,
        agents,
        (g) => {
          const st = g.getState();
          if (st.phase !== 'play') return false;
          const actor = activeActor(st)!;
          const agent = agents[Number(actor.slice(1)) - 1]!;
          // Peek: let the agent decide, then verify via the dispatched game.
          const cmd = agent.chooseAction(st, actor);
          if (cmd?.type === 'BUILD_CITY') {
            const p = st.players.find((x) => x.id === actor)!;
            found = {
              cornerId: (cmd as { cornerId: string }).cornerId,
              settlements: [...p.settlements],
              playerId: actor,
            };
            return true;
          }
          return st.phase === 'gameover';
        },
        4000,
      );
      expect(found, `seed ${seed} should reach a city build`).not.toBeNull();
      const f = found!;
      // The upgraded corner was a settlement (now a city).
      const st = game.getState();
      const me = st.players.find((x) => x.id === f.playerId)!;
      expect(me.cities).toContain(f.cornerId);
      if (f.settlements.length > 1) {
        const yields = f.settlements.map((c) => ({
          c,
          y: cornerYield(st.board, c, st.raiderTileKey).total,
        }));
        const avg = yields.reduce((a, x) => a + x.y, 0) / yields.length;
        const chosen = yields.find((x) => x.c === f.cornerId)!;
        // Upgraded spot should be above average (not the worst settlement).
        expect(chosen.y).toBeGreaterThanOrEqual(avg - 0.05);
      }
    }
  }, 240000);
});
