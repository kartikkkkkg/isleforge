/* buildinfo tests: menu availability derived from engine state. */

import { describe, expect, it } from 'vitest';
import { Game, legalCommands } from '@isleforge/game-engine';
import { buildOptions } from '../src/game/buildinfo';

function playToRoll(seed = 21): Game {
  const g = new Game({ seed, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  let guard = 0;
  while (g.getState().phase === 'setup' && guard++ < 20) {
    const s = g.getState();
    const actor = s.setup!.order[s.setup!.cursor]!;
    const legal = g.legalCommands(actor);
    g.dispatch(legal.find((c) => c.type === 'PLACE_SETTLEMENT' || c.type === 'PLACE_ROAD')!);
  }
  return g;
}

describe('buildOptions', () => {
  it('disables everything before the dice roll with a clear reason', () => {
    const g = playToRoll();
    const s = g.getState();
    expect(s.phase).toBe('roll');
    const opts = buildOptions(s, 'p1', legalCommands(s, 'p1'));
    for (const o of opts) {
      expect(o.enabled).toBe(false);
      expect(o.reason).toMatch(/Roll the dice|Not your turn/);
    }
  });

  it('disables options for the player who is not on turn', () => {
    const g = playToRoll();
    const s = g.getState();
    const other = s.currentPlayerId === 'p1' ? 'p2' : 'p1';
    const opts = buildOptions(s, other, legalCommands(s, other));
    for (const o of opts) expect(o.reason).toBe('Not your turn');
  });

  it('reports shortfall when the player cannot afford', () => {
    // Find a seed whose first roll is not a 7 (so we land in the play phase).
    let g: Game | null = null;
    let me = '';
    for (const seed of [21, 22, 23, 24, 25]) {
      const candidate = playToRoll(seed);
      const actor = candidate.getState().currentPlayerId!;
      candidate.dispatch({ type: 'ROLL_DICE', playerId: actor });
      if (candidate.getState().phase === 'play') {
        g = candidate;
        me = actor;
        break;
      }
    }
    expect(g).not.toBeNull();
    const s = g!.getState();
    const opts = buildOptions(s, me, []);
    const poor = opts.filter((o) => !o.affordable);
    expect(poor.length).toBeGreaterThan(0);
    for (const o of poor) expect(o.reason).toMatch(/Needs .* more/);
  });

  it('enables affordable builds with legal placements in play phase', () => {
    const g = playToRoll();
    const s0 = g.getState();
    const me = s0.currentPlayerId!;
    g.dispatch({ type: 'ROLL_DICE', playerId: me });
    // Grant resources directly on a cloned state via events is complex;
    // instead drive turns until the player can afford a road.
    let guard = 0;
    let enabledRoad = false;
    while (guard++ < 60 && !enabledRoad) {
      const s = g.getState();
      const actor = s.currentPlayerId!;
      if (s.phase === 'roll') {
        g.dispatch({ type: 'ROLL_DICE', playerId: actor });
      } else if (s.phase === 'play') {
        const legal = g.legalCommands(actor);
        const opts = buildOptions(s, actor, legal);
        const road = opts.find((o) => o.kind === 'road')!;
        if (road.enabled) {
          enabledRoad = true;
          expect(road.legalCount).toBeGreaterThan(0);
          break;
        }
        g.dispatch({ type: 'END_TURN', playerId: actor });
      } else {
        break;
      }
    }
    expect(enabledRoad).toBe(true);
  });
});
