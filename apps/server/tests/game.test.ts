/**
 * ServerGame unit tests: authoritative dispatch, idempotency, anti-spoofing,
 * AI cascade, hidden-information masking, and snapshots.
 */

import { describe, expect, it } from 'vitest';
import { legalCommands, type Command, type GameEvent } from '@isleforge/game-engine';

import { maskEventForViewer, ServerGame } from '../src/game.js';

const players = [
  { id: 'p1', name: 'A', color: 'ember' as const },
  { id: 'p2', name: 'B', color: 'tide' as const },
  { id: 'p3', name: 'C', color: 'moss' as const },
  { id: 'p4', name: 'D', color: 'dune' as const },
];

const mkGame = (seed = 42): ServerGame =>
  new ServerGame({
    gameId: 'g1',
    players,
    aiSeats: new Map([
      ['p3', { difficulty: 'normal', personality: 'balanced' }],
      ['p4', { difficulty: 'easy', personality: 'aggressive' }],
    ]),
    seed,
  });

describe('ServerGame', () => {
  it('dispatches a legal command and reports event seqs', () => {
    const game = mkGame();
    // Setup phase: p1 places first (corner from the engine's legal set).
    const st = game.debugState();
    expect(st.phase).toBe('setup');
    const out = game.handleCommand('p1', 'cmd-1', {
      type: 'PLACE_SETTLEMENT',
      playerId: 'p1',
      cornerId: Object.keys(st.board.corners)[0]!,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.seqs.length).toBeGreaterThan(0);
      expect(out.seqs).toEqual([...out.seqs].sort((a, b) => a - b));
    }
  });

  it('is idempotent: a retransmitted commandId produces no new events', () => {
    const game = mkGame();
    const st = game.debugState();
    const cmd = {
      type: 'PLACE_SETTLEMENT',
      playerId: 'p1',
      cornerId: Object.keys(st.board.corners)[0]!,
    } as const;
    const first = game.handleCommand('p1', 'cmd-dup', cmd);
    expect(first.ok).toBe(true);
    const seqAfterFirst = game.lastSeq;
    const second = game.handleCommand('p1', 'cmd-dup', cmd);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.seqs).toEqual(first.seqs);
    }
    expect(game.lastSeq).toBe(seqAfterFirst);
  });

  it('rejects commands whose playerId does not match the sender (anti-spoof)', () => {
    const game = mkGame();
    const out = game.handleCommand('p2', 'cmd-spoof', {
      type: 'ROLL_DICE',
      playerId: 'p1',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('NOT_AUTHORIZED');
  });

  it('rejects out-of-turn setup commands via the engine', () => {
    const game = mkGame();
    // p2 tries to place during p1's setup turn.
    const st = game.debugState();
    const cornerId = Object.keys(st.board.corners)[0]!;
    const out = game.handleCommand('p2', 'cmd-oot', {
      type: 'PLACE_SETTLEMENT',
      playerId: 'p2',
      cornerId,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('NOT_YOUR_TURN');
  });

  it('rejects illegal commands without mutating state', () => {
    const game = mkGame();
    const before = game.lastSeq;
    const out = game.handleCommand('p1', 'cmd-bad', {
      type: 'BUILD_CITY',
      playerId: 'p1',
      cornerId: 'nonexistent',
    });
    expect(out.ok).toBe(false);
    expect(game.lastSeq).toBe(before);
  });

  it('runs AI seats through the same pipeline (setup cascade)', () => {
    const game = mkGame();
    // p1 and p2 are humans; AI seats p3/p4 auto-play via the post-command cascade.
    let cmdN = 0;
    const playSetupTurn = (pid: string): void => {
      const s = game.debugState();
      expect(s.phase).toBe('setup');
      expect(s.setup?.order[s.setup.cursor]).toBe(pid);
      const legal = legalCommands(s, pid);
      const cmd = legal.find((c) => c.type === 'PLACE_SETTLEMENT' || c.type === 'PLACE_ROAD');
      expect(cmd, `${pid} should have a legal setup command`).toBeDefined();
      const out = game.handleCommand(pid, `setup-cmd-${cmdN++}`, cmd as Command);
      expect(out.ok).toBe(true);
    };

    for (let i = 0; i < 16; i++) {
      const s = game.debugState();
      if (s.phase !== 'setup' || !s.setup) break;
      const actor = s.setup.order[s.setup.cursor]!;
      // AI seats cascade automatically inside handleCommand; the cursor
      // should never rest on one here.
      expect(actor === 'p1' || actor === 'p2', `unexpected AI actor ${actor}`).toBe(true);
      playSetupTurn(actor);
    }
    const s = game.debugState();
    expect(s.phase).not.toBe('setup');
    // All four seats placed their two setup settlements.
    for (const p of s.players) {
      expect(p.settlements.length).toBe(2);
    }
  });

  it('masks CARD_PURCHASED card types from opponents', () => {
    const evt = {
      seq: 5,
      type: 'CARD_PURCHASED',
      playerId: 'p1',
      data: { cardUid: 'c1', cardType: 'guardian' },
    } as GameEvent;
    const owner = maskEventForViewer(evt, 'p1');
    expect((owner.data as { cardType: string }).cardType).toBe('guardian');
    const foe = maskEventForViewer(evt, 'p2');
    expect((foe.data as { cardType: string }).cardType).toBe('hidden');
    // Original untouched.
    expect((evt.data as { cardType: string }).cardType).toBe('guardian');
  });

  it('masks stolen resources from bystanders but not participants', () => {
    const evt = {
      seq: 6,
      type: 'RESOURCE_STOLEN',
      playerId: 'p1',
      data: { resource: 'ore', amount: 1, reason: 'raider', fromPlayerId: 'p2' },
    } as unknown as GameEvent;
    expect(
      (maskEventForViewer(evt, 'p3').data as { resource: string | null }).resource,
    ).toBeNull();
    expect(
      (maskEventForViewer(evt, 'p1').data as { resource: string | null }).resource,
    ).toBe('ore');
    expect(
      (maskEventForViewer(evt, 'p2').data as { resource: string | null }).resource,
    ).toBe('ore');
  });

  it('snapshotFor masks opponents dev cards', () => {
    const game = mkGame();
    const snap = game.snapshotFor('p2');
    expect(snap.lastSeq).toBe(game.lastSeq);
    for (const p of snap.state.players) {
      for (const c of p.devCards) {
        if (p.id === 'p2') continue;
        expect(c.type).toBe('hidden');
      }
    }
  });
});
