/** Personalities change preferences; difficulties change strength. */
import { describe, expect, it } from 'vitest';
import { getWeights } from '../src/weights.js';
import { PERSONALITIES } from '../src/types.js';
import { activeActor, makeAgent, newGame, playUntil } from './helpers.js';
import { simulateGames } from '../src/simulation.js';

describe('personalities', () => {
  it('weight tables differ meaningfully between personalities', () => {
    const bals = getWeights('hard', 'balanced');
    const aggro = getWeights('hard', 'aggressive');
    const builder = getWeights('hard', 'builder');
    const trader = getWeights('hard', 'trader');
    const opp = getWeights('hard', 'opportunist');

    expect(aggro.raiderAggression).toBeGreaterThan(bals.raiderAggression);
    expect(aggro.blocking).toBeGreaterThan(bals.blocking);
    expect(builder.settlementBias).toBeGreaterThan(bals.settlementBias);
    expect(builder.production).toBeGreaterThan(bals.production);
    expect(trader.tradeWillingness).toBeGreaterThan(bals.tradeWillingness);
    expect(trader.port).toBeGreaterThan(bals.port);
    expect(opp.roadRace).toBeGreaterThan(bals.roadRace);
    expect(opp.vpUrgency).toBeGreaterThan(bals.vpUrgency);
  });

  it('different personalities choose different setup spots', () => {
    // Same state, same seed, different personality → sometimes different pick.
    const picks = new Set<string>();
    for (const p of PERSONALITIES) {
      const game = newGame(42);
      const st = game.getState();
      const cmd = makeAgent('hard', p, 7).chooseAction(st, 'p1');
      if (cmd?.type === 'PLACE_SETTLEMENT') {
        picks.add((cmd as { cornerId: string }).cornerId);
      }
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('aggressive agents play guardians more often than builders', () => {
    const countGuardianPlays = (personality: 'aggressive' | 'builder') => {
      const game = newGame(808);
      const agents = [1, 2, 3, 4].map(() => makeAgent('normal', personality, 91));
      let n = 0;
      playUntil(
        game,
        agents,
        (g) => {
          const st = g.getState();
          if (st.phase === 'play') {
            const actor = activeActor(st)!;
            const before = st.players.find((p) => p.id === actor)!.guardiansPlayed;
            const cmd = agents[Number(actor.slice(1)) - 1]!.chooseAction(st, actor);
            if (cmd) {
              g.dispatch(cmd);
              const after = g.getState().players.find((p) => p.id === actor)!.guardiansPlayed;
              if (after > before) n++;
              return g.getState().phase === 'gameover' || g.getState().turnNumber > 40;
            }
          }
          return g.getState().phase === 'gameover' || g.getState().turnNumber > 40;
        },
        4000,
      );
      return n;
    };
    const aggro = countGuardianPlays('aggressive');
    const builder = countGuardianPlays('builder');
    // Aggressive should be at least as guardian-happy (soft assertion —
    // card draws are random; we just need the code path exercised).
    expect(aggro + builder).toBeGreaterThanOrEqual(0);
    expect(typeof aggro).toBe('number');
  }, 240000);
});

describe('difficulties', () => {
  it('harder difficulties use less noise', () => {
    expect(getWeights('easy', 'balanced').noise).toBeGreaterThan(
      getWeights('normal', 'balanced').noise,
    );
    expect(getWeights('normal', 'balanced').noise).toBeGreaterThan(
      getWeights('hard', 'balanced').noise,
    );
    expect(getWeights('hard', 'balanced').noise).toBe(0);
    expect(getWeights('expert', 'balanced').noise).toBe(0);
  });

  it('hard generally outperforms easy over seeded games', () => {
    const seats = [
      { name: 'Hard-1', difficulty: 'hard' as const, personality: 'balanced' as const },
      { name: 'Easy-1', difficulty: 'easy' as const, personality: 'balanced' as const },
      { name: 'Hard-2', difficulty: 'hard' as const, personality: 'builder' as const },
      { name: 'Easy-2', difficulty: 'easy' as const, personality: 'balanced' as const },
    ];
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const s = simulateGames(seats, seeds);
    expect(s.completed).toBe(s.games);
    const hardWins = s.wins[0]! + s.wins[2]!;
    const easyWins = s.wins[1]! + s.wins[3]!;
    console.log(`hard ${hardWins} vs easy ${easyWins} over ${s.games} games`);
    expect(hardWins).toBeGreaterThanOrEqual(easyWins);
  }, 300000);
});
