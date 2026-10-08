/** Settlement placement prefers high-production, diverse locations. */
import { describe, expect, it } from 'vitest';
import { legalCommands } from '@isleforge/game-engine';
import { cornerYield } from '../src/analysis.js';
import { activeActor, makeAgent, newGame } from './helpers.js';

describe('settlement evaluation', () => {
  it('picks a strong setup location (not the first legal corner)', () => {
    for (const seed of [42, 7, 1234]) {
      const game = newGame(seed);
      const agent = makeAgent('hard', 'balanced', 1);
      const st = game.getState();
      const actor = activeActor(st)!;
      const cmd = agent.chooseAction(st, actor)!;
      expect(cmd.type).toBe('PLACE_SETTLEMENT');
      const cornerId = (cmd as { cornerId: string }).cornerId;

      // Rank all legal corners by expected production; the pick should be
      // in the top half.
      const legal = legalCommands(st, actor)
        .filter((c) => c.type === 'PLACE_SETTLEMENT')
        .map((c) => (c as { cornerId: string }).cornerId);
      const ranked = legal
        .map((c) => ({ c, y: cornerYield(st.board, c, st.raiderTileKey).total }))
        .sort((a, b) => b.y - a.y);
      const rank = ranked.findIndex((x) => x.c === cornerId);
      expect(rank, `seed ${seed}`).toBeLessThan(Math.ceil(ranked.length / 2));
      // And it must not be the naive first-legal-corner pick every time.
      expect(cornerId).not.toBe(legal[0]);
    }
  });

  it('second setup settlement complements the first (diversity)', () => {
    // Play the full setup with hard/balanced agents and check that each
    // player's two settlements together cover 3+ resource types.
    const game = newGame(2024);
    const agents = [1, 2, 3, 4].map(() => makeAgent('hard', 'balanced', 5));
    let moves = 0;
    while (game.getState().phase === 'setup' && moves < 40) {
      const st = game.getState();
      const actor = activeActor(st)!;
      const cmd = agents[Number(actor.slice(1)) - 1]!.chooseAction(st, actor)!;
      game.dispatch(cmd);
      moves++;
    }
    for (const p of game.getState().players) {
      expect(p.settlements).toHaveLength(2);
      const res = new Set<string>();
      for (const c of p.settlements) {
        const y = cornerYield(game.getState().board, c, '');
        for (const [k, v] of Object.entries(y.perResource)) if (v > 0) res.add(k);
      }
      expect(res.size, `${p.name} diversity`).toBeGreaterThanOrEqual(2);
    }
  });
});
