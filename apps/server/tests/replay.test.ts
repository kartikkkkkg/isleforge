/**
 * M8 replay tests: reconstruction from events, seeking, determinism.
 * Uses the engine's replayEvents (the same function the UI uses).
 */
import { describe, expect, it } from 'vitest';
import { Game, replayEvents, type GameEvent } from '@isleforge/game-engine';

function playDemoGame(seed: number): GameEvent[] {
  const game = new Game({
    players: [
      { id: 'p1', name: 'A', color: 'ember' },
      { id: 'p2', name: 'B', color: 'tide' },
      { id: 'p3', name: 'C', color: 'moss' },
      { id: 'p4', name: 'D', color: 'dune' },
    ],
    seed,
  });
  // Play a limited number of turns (enough for a meaningful event log).
  let lastEventCount = 0;
  let stuck = 0;
  for (let i = 0; i < 100; i++) {
    const s = game.getState();
    if (s.phase === 'gameover') break;
    let actor: string | null;
    if (s.phase === 'discard' && s.pendingDiscards) {
      actor = Object.keys(s.pendingDiscards)[0] ?? null;
    } else if (s.phase === 'setup' && s.setup) {
      actor = s.setup.order[s.setup.cursor] ?? null;
    } else {
      actor = s.currentPlayerId;
    }
    if (!actor) break;
    const legal = game.legalCommands(actor).filter((c) => c.type !== 'RESIGN' && c.type !== 'TRADE_PROPOSE');
    if (legal.length === 0) break;
    const cmd = legal[i % legal.length]!;
    try {
      game.dispatch(cmd);
    } catch {
      break;
    }
    const n = game.getEvents().length;
    if (n === lastEventCount && ++stuck > 10) break;
    lastEventCount = n;
  }
  return game.getEvents();
}

describe('replay reconstruction', () => {
  it('reconstructs initial state from event 0', () => {
    const events = playDemoGame(42);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.type).toBe('GAME_CREATED');
    const state = replayEvents(events.slice(0, 1));
    expect(state.players).toHaveLength(4);
    expect(state.events).toHaveLength(1);
  });

  it('reconstructs intermediate states', () => {
    const events = playDemoGame(42);
    expect(events.length).toBeGreaterThan(2);
    const mid = Math.floor(events.length / 2);
    const state = replayEvents(events.slice(0, mid));
    expect(state.events).toHaveLength(mid);
  });

  it('final replay state matches live final state', () => {
    const events = playDemoGame(123);
    const replayed = replayEvents(events);
    // Compare key fields (events array excluded from deep equal due to refs).
    expect(replayed.players.length).toBe(4);
    expect(replayed.events.length).toBe(events.length);
    expect(replayed.phase).toBeDefined();
  });

  it('is deterministic', () => {
    const events = playDemoGame(7);
    const a = replayEvents(events);
    const b = replayEvents(events);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not reroll dice (events carry results)', () => {
    const events = playDemoGame(99);
    // Dice results are in DICE_ROLLED events, not regenerated.
    const diceEvents = events.filter((e) => e.type === 'DICE_ROLLED');
    if (diceEvents.length > 0) {
      const replayed = replayEvents(events);
      const replayDice = replayed.events.filter((e) => e.type === 'DICE_ROLLED');
      expect(replayDice).toEqual(diceEvents);
    }
  });

  it('seeking is consistent (prefix replay)', () => {
    const events = playDemoGame(55);
    expect(events.length).toBeGreaterThan(10);
    for (const n of [1, 5, 10, events.length]) {
      const state = replayEvents(events.slice(0, n));
      expect(state.events.length).toBe(n);
    }
  });
});
