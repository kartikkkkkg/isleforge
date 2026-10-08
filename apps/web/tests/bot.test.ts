/* Bot tests: the demo bot must only ever choose legal commands. */

import { describe, expect, it } from 'vitest';
import {
  Game,
  legalCommands,
  planCommand,
  mulberry32,
} from '@isleforge/game-engine';
import { chooseBotMove, botAcceptsTrade, createBotRng } from '../src/game/bot';
import { activeActor } from '../src/game/useGame';

describe('chooseBotMove', () => {
  it('only ever returns commands that pass engine validation', () => {
    const g = new Game({ seed: 7, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
    const rng = createBotRng(1);
    // Play 150 bot-driven turns; every chosen move must validate.
    let guard = 0;
    let moves = 0;
    while (g.getState().phase !== 'gameover' && guard++ < 150) {
      const s = g.getState();
      const actor = activeActor(s)!;
      const cmd = chooseBotMove(s, actor, rng);
      const legal = legalCommands(s, actor).filter((c) => c.type !== 'RESIGN');
      if (legal.length === 0) {
        expect(cmd).toBeNull();
        break;
      }
      expect(cmd).not.toBeNull();
      // The chosen command must pass engine validation on a draft.
      expect(() => planCommand(s, cmd!, mulberry32(9))).not.toThrow();
      g.dispatch(cmd!);
      moves++;
    }
    expect(moves).toBeGreaterThan(50);
  });

  it('handles the raider phase (move + steal)', () => {
    const g = new Game({ seed: 99, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
    const rng = createBotRng(5);
    // Fast-forward: roll until a 7 triggers the raider phase (cheap in roll phase).
    let guard = 0;
    let sawRaider = false;
    while (guard++ < 400 && !sawRaider) {
      const s = g.getState();
      const actor = activeActor(s)!;
      if (s.phase === 'roll') {
        g.dispatch({ type: 'ROLL_DICE', playerId: actor });
      } else if (s.phase === 'play') {
        g.dispatch({ type: 'END_TURN', playerId: actor });
      } else if (s.phase === 'raider' && !s.pendingSteal) {
        sawRaider = true;
        const cmd = chooseBotMove(s, actor, rng);
        expect(cmd?.type).toBe('MOVE_RAIDER');
        expect(() => planCommand(s, cmd!, mulberry32(9))).not.toThrow();
        g.dispatch(cmd!);
        // If a steal is now pending, the bot must pick a victim legally.
        const s2 = g.getState();
        if (s2.pendingSteal) {
          const steal = chooseBotMove(s2, activeActor(s2)!, rng);
          expect(steal?.type).toBe('STEAL_RESOURCE');
          expect(() => planCommand(s2, steal!, mulberry32(9))).not.toThrow();
        }
      } else if (s.phase === 'discard') {
        const legal = legalCommands(s, actor).filter((c) => c.type === 'DISCARD_RESOURCES');
        g.dispatch(legal[0]!);
      } else if (s.phase === 'setup') {
        const legal = legalCommands(s, actor);
        g.dispatch(legal.find((c) => c.type === 'PLACE_SETTLEMENT' || c.type === 'PLACE_ROAD')!);
      } else {
        break;
      }
    }
    expect(sawRaider).toBe(true);
  });
});

describe('botAcceptsTrade', () => {
  it('accepts fair deals and rejects terrible ones', () => {
    const rng = createBotRng(3);
    const one = { wood: 1, brick: 0, grain: 0, wool: 0, ore: 0 };
    const oneOre = { wood: 0, brick: 0, grain: 0, wool: 0, ore: 1 };
    // Getting ore for wood: great deal — always accepted.
    for (let i = 0; i < 20; i++) expect(botAcceptsTrade(one, oneOre, rng)).toBe(true);
    // Giving 4 ore for 1 wood: rejected (value ratio far below threshold).
    const fourOre = { wood: 0, brick: 0, grain: 0, wool: 0, ore: 4 };
    let accepted = 0;
    for (let i = 0; i < 20; i++) if (botAcceptsTrade(fourOre, one, rng)) accepted++;
    expect(accepted).toBe(0);
  });
});

describe('activeActor', () => {
  it('resolves setup cursor, discarders, and current player', () => {
    const g = new Game({ seed: 11, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
    let s = g.getState();
    expect(activeActor(s)).toBe(s.setup!.order[0]);
    // Finish setup.
    let guard = 0;
    while (g.getState().phase === 'setup' && guard++ < 20) {
      s = g.getState();
      const actor = activeActor(s)!;
      const legal = g.legalCommands(actor);
      g.dispatch(legal.find((c) => c.type === 'PLACE_SETTLEMENT' || c.type === 'PLACE_ROAD')!);
    }
    s = g.getState();
    expect(s.phase).toBe('roll');
    expect(activeActor(s)).toBe(s.currentPlayerId);
  });
});
