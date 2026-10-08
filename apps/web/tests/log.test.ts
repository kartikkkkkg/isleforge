/* Unit tests for the game-log formatter: real engine events in, human text out. */

import { describe, expect, it } from 'vitest';
import { Game } from '@isleforge/game-engine';
import { formatLog } from '../src/game/log';
import { chooseBotMove, createBotRng } from '../src/game/bot';
import { activeActor } from '../src/game/useGame';

function freshGame() {
  return new Game({
    seed: 42,
    players: [{ name: 'Ash' }, { name: 'Bryn' }, { name: 'Cora' }],
  });
}

describe('formatLog', () => {
  it('narrates game creation and the first turn', () => {
    const g = freshGame();
    const lines = formatLog(g.getEvents(), g.getState()).map((e) => e.text);
    expect(lines[0]).toMatch(/Game created.*3 players/);
  });

  it('narrates dice rolls and production grants (aggregated)', () => {
    const g = freshGame();
    // Play setup quickly via first-legal moves.
    let guard = 0;
    while (g.getState().phase === 'setup' && guard++ < 20) {
      const s = g.getState();
      const actor = s.setup!.order[s.setup!.cursor]!;
      const legal = g.legalCommands(actor);
      const cmd = legal.find((c) => c.type === 'PLACE_SETTLEMENT' || c.type === 'PLACE_ROAD')!;
      g.dispatch(cmd);
    }
    g.dispatch({ type: 'ROLL_DICE', playerId: g.getState().currentPlayerId! });
    const all = formatLog(g.getEvents(), g.getState());
    const texts = all.map((e) => e.text);
    const rollIdx = texts.findIndex((t) => /rolled \d \+ \d = \d+/.test(t));
    expect(rollIdx).toBeGreaterThan(-1);
    // Production grants after the roll: one line per producing player.
    const postRoll = all.slice(rollIdx + 1);
    const grantLines = postRoll.filter((e) => /received/.test(e.text));
    const players = new Set(grantLines.map((t) => t.text.split(' received')[0]));
    expect(grantLines.length).toBe(players.size);
  });

  it('narrates a full game to victory with the demo bot', () => {
    const g = freshGame();
    const rng = createBotRng(77);
    let guard = 0;
    while (g.getState().phase !== 'gameover' && guard++ < 1500) {
      const s = g.getState();
      const actor = activeActor(s)!;
      const cmd = chooseBotMove(s, actor, rng);
      if (!cmd) break;
      g.dispatch(cmd);
    }
    expect(g.getState().phase).toBe('gameover');
    const entries = formatLog(g.getEvents(), g.getState());
    const kinds = new Set(entries.map((e) => e.kind));
    expect(kinds.has('dice')).toBe(true);
    expect(kinds.has('build')).toBe(true);
    const last = entries[entries.length - 1]!;
    expect(last.kind).toBe('victory');
    expect(last.text).toMatch(/wins|Game over/);
  }, 120000);

  it('never crashes on an empty event list', () => {
    expect(formatLog([], freshGame().getState())).toEqual([]);
  });
});
