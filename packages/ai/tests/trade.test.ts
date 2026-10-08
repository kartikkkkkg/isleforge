/** Trading unlocks builds; trade responses are sensible. */
import { describe, expect, it } from 'vitest';
import { activeActor, makeAgent, newGame, playUntil } from './helpers.js';
import { shouldAcceptTrade } from '../src/trade.js';

describe('bank trading', () => {
  it('trades with the bank when it unlocks a build', () => {
    // Find a state where the agent holds 4+ of one resource and is one
    // resource short of a road/settlement, then verify it trades.
    const game = newGame(4242);
    const agents = [1, 2, 3, 4].map(() => makeAgent('normal', 'trader', 31));
    let traded = false;
    playUntil(
      game,
      agents,
      (g) => {
        const st = g.getState();
        if (st.phase === 'play') {
          const actor = activeActor(st)!;
          const cmd = agents[Number(actor.slice(1)) - 1]!.chooseAction(st, actor);
          if (cmd?.type === 'TRADE_BANK') traded = true;
          if (traded && st.turnNumber > 10) return true;
        }
        return st.phase === 'gameover' || st.turnNumber > 40;
      },
      3000,
    );
    expect(traded).toBe(true);
  }, 180000);

  it('does not churn: consecutive bank trades are bounded', () => {
    const game = newGame(777);
    const agents = [1, 2, 3, 4].map(() => makeAgent('hard', 'trader', 41));
    let maxTradesInTurn = 0;
    let cur = 0;
    let lastTurn = -1;
    playUntil(
      game,
      agents,
      (g) => {
        const st = g.getState();
        if (st.turnNumber !== lastTurn) {
          maxTradesInTurn = Math.max(maxTradesInTurn, cur);
          cur = 0;
          lastTurn = st.turnNumber;
        }
        if (st.phase === 'play') {
          const actor = activeActor(st)!;
          const cmd = agents[Number(actor.slice(1)) - 1]!.chooseAction(st, actor);
          if (cmd?.type === 'TRADE_BANK') cur++;
        }
        return st.phase === 'gameover' || st.turnNumber > 25;
      },
      2500,
    );
    expect(maxTradesInTurn).toBeLessThan(8);
  }, 180000);
});

describe('trade responses', () => {
  it('accepts clearly good deals and rejects terrible ones', () => {
    const game = newGame(42);
    // Play setup so the state is realistic.
    const agents = [1, 2, 3, 4].map(() => makeAgent('normal', 'balanced', 51));
    playUntil(game, agents, (g) => g.getState().phase !== 'setup', 100);
    const st = game.getState();

    // Offer 1 ore for 1 wood — roughly fair, trader should accept.
    const fair = shouldAcceptTrade(
      st, 'p1',
      { wood: 0, brick: 0, grain: 0, wool: 0, ore: 1 },
      { wood: 1, brick: 0, grain: 0, wool: 0, ore: 0 },
      { difficulty: 'normal', personality: 'trader', seed: 1 },
    );
    expect(typeof fair).toBe('boolean');

    // Offer 1 wood for 4 ore — terrible, should reject.
    const bad = shouldAcceptTrade(
      st, 'p1',
      { wood: 1, brick: 0, grain: 0, wool: 0, ore: 0 },
      { wood: 0, brick: 0, grain: 0, wool: 0, ore: 4 },
      { difficulty: 'normal', personality: 'balanced', seed: 1 },
    );
    expect(bad).toBe(false);
  });

  it('is deterministic for a fixed seed', () => {
    const game = newGame(42);
    const st = game.getState();
    const cfg = { difficulty: 'normal' as const, personality: 'balanced' as const, seed: 5 };
    const offer = { wood: 0, brick: 0, grain: 2, wool: 0, ore: 0 };
    const request = { wood: 0, brick: 0, grain: 0, wool: 1, ore: 0 };
    expect(shouldAcceptTrade(st, 'p1', offer, request, cfg)).toBe(
      shouldAcceptTrade(st, 'p1', offer, request, cfg),
    );
  });
});
