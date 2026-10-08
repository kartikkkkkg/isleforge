import { describe, expect, it } from 'vitest';
import {
  bankTradeRatio,
  emptyResources,
  type GameState,
  type Port,
  type ResourceType,
} from '../src/index.js';
import { boosted, completeSetup, expectEngineError, newGame, runCmd, scriptedRng } from './helpers.js';

/** State in 'play' phase, current player p1, everyone boosted. */
function playState(seed = 201): GameState {
  const g = newGame(seed);
  const s = boosted(completeSetup(g), { wood: 10, brick: 10, grain: 10, wool: 10, ore: 10 });
  runCmd(s, { type: 'ROLL_DICE', playerId: 'p1' }, scriptedRng()); // total 2 -> play phase
  if (s.phase !== 'play') throw new Error('fixture did not reach play phase');
  return s;
}

/** Fixture: p1 owns exactly one settlement, on a corner of `port`. */
function portOwnerState(seed: number, port: Port): GameState {
  const s = playState(seed);
  const p1 = s.players[0]!;
  p1.settlements = [port.cornerIds[0]];
  p1.cities = [];
  p1.roads = [];
  return boosted(s, { wood: 10, brick: 10, grain: 10, wool: 10, ore: 10 });
}

describe('bank trading', () => {
  it('trades at the best ratio the player has earned', () => {
    const s = playState();
    const ratio = bankTradeRatio(s, 'p1', 'wood');
    expect(ratio).toBeGreaterThanOrEqual(2);
    expect(ratio).toBeLessThanOrEqual(4);
    const before = { ...s.players[0]!.resources };
    const bankBefore = { ...s.bank };
    runCmd(s, { type: 'TRADE_BANK', playerId: 'p1', give: 'wood', receive: 'ore' });
    const p1 = s.players[0]!;
    expect(p1.resources.wood).toBe(before.wood - ratio);
    expect(p1.resources.ore).toBe(before.ore + 1);
    expect(s.bank.wood).toBe(bankBefore.wood + ratio);
    expect(s.bank.ore).toBe(bankBefore.ore - 1);
    const traded = s.events.find((e) => e.type === 'BANK_TRADED');
    expect(traded?.type).toBe('BANK_TRADED');
    if (traded?.type === 'BANK_TRADED') expect(traded.data.giveCount).toBe(ratio);
  });

  it('uses 3:1 with a generic port', () => {
    const probe = playState(202);
    const port = probe.board.ports.find((p) => p.kind === 'three')!;
    const s = portOwnerState(202, port);
    expect(bankTradeRatio(s, 'p1', 'brick')).toBe(3);
    s.players[0]!.resources.brick = 3;
    runCmd(s, { type: 'TRADE_BANK', playerId: 'p1', give: 'brick', receive: 'grain' });
    expect(s.players[0]!.resources.brick).toBe(0);
    expect(s.players[0]!.resources.grain).toBe(11);
  });

  it('uses 2:1 with a matching resource port (and 3:1 otherwise)', () => {
    const probe = playState(203);
    const port = probe.board.ports.find((p) => p.kind !== 'three')!;
    const kind = port.kind as ResourceType;
    const other: ResourceType = kind === 'wood' ? 'brick' : 'wood';
    const s = portOwnerState(203, port);
    expect(bankTradeRatio(s, 'p1', kind)).toBe(2);
    expect(bankTradeRatio(s, 'p1', other)).toBe(4); // no generic port in this fixture
    s.players[0]!.resources[kind] = 2;
    runCmd(s, { type: 'TRADE_BANK', playerId: 'p1', give: kind, receive: 'wool' });
    expect(s.players[0]!.resources[kind]).toBe(0);
  });

  it('rejects invalid bank trades', () => {
    const s = playState(204);
    expectEngineError(
      () => runCmd(s, { type: 'TRADE_BANK', playerId: 'p1', give: 'wood', receive: 'wood' }),
      'INVALID_TRADE',
    );
    s.players[0]!.resources.wood = 1;
    expectEngineError(
      () => runCmd(s, { type: 'TRADE_BANK', playerId: 'p1', give: 'wood', receive: 'ore' }),
      'INSUFFICIENT_RESOURCES',
    );
  });
});

describe('player trading', () => {
  function offer(wood = 0, brick = 0, grain = 0, wool = 0, ore = 0) {
    return { wood, brick, grain, wool, ore };
  }

  it('proposes and accepts: resources swap atomically', () => {
    const s = playState(211);
    const events = runCmd(s, {
      type: 'TRADE_PROPOSE',
      playerId: 'p1',
      toPlayerId: 'p2',
      offer: offer(2),
      request: { ...offer(), ore: 1 },
    });
    expect(events.some((e) => e.type === 'TRADE_PROPOSED')).toBe(true);
    expect(s.pendingTrades).toHaveLength(1);
    const tradeId = s.pendingTrades[0]!.id;

    const p1Before = { ...s.players[0]!.resources };
    const p2Before = { ...s.players[1]!.resources };
    runCmd(s, { type: 'TRADE_ACCEPT', playerId: 'p2', tradeId });
    const p1 = s.players[0]!;
    const p2 = s.players[1]!;
    expect(p1.resources.wood).toBe(p1Before.wood - 2);
    expect(p1.resources.ore).toBe(p1Before.ore + 1);
    expect(p2.resources.wood).toBe(p2Before.wood + 2);
    expect(p2.resources.ore).toBe(p2Before.ore - 1);
    expect(s.pendingTrades).toHaveLength(0);
  });

  it('declining leaves balances untouched', () => {
    const s = playState(212);
    runCmd(s, {
      type: 'TRADE_PROPOSE',
      playerId: 'p1',
      toPlayerId: 'p2',
      offer: offer(1),
      request: { ...offer(), grain: 1 },
    });
    const before = JSON.stringify([s.players[0]!.resources, s.players[1]!.resources]);
    runCmd(s, { type: 'TRADE_DECLINE', playerId: 'p2', tradeId: s.pendingTrades[0]!.id });
    expect(JSON.stringify([s.players[0]!.resources, s.players[1]!.resources])).toBe(before);
    expect(s.pendingTrades).toHaveLength(0);
  });

  it('a stale offer auto-declines instead of creating resources', () => {
    const s = playState(213);
    runCmd(s, {
      type: 'TRADE_PROPOSE',
      playerId: 'p1',
      toPlayerId: 'p2',
      offer: offer(0, 3),
      request: { ...offer(), wool: 1 },
    });
    const tradeId = s.pendingTrades[0]!.id;
    s.players[0]!.resources.brick = 0; // p1 spends the offered brick elsewhere
    const events = runCmd(s, { type: 'TRADE_ACCEPT', playerId: 'p2', tradeId });
    expect(events.some((e) => e.type === 'TRADE_DECLINED')).toBe(true);
    expect(events.some((e) => e.type === 'TRADE_ACCEPTED')).toBe(false);
    expect(s.pendingTrades).toHaveLength(0);
  });

  it('only the current player can propose', () => {
    const s = playState(214);
    expectEngineError(
      () =>
        runCmd(s, {
          type: 'TRADE_PROPOSE',
          playerId: 'p2',
          toPlayerId: 'p1',
          offer: offer(1),
          request: { ...offer(), ore: 1 },
        }),
      'NOT_YOUR_TURN',
    );
  });

  it('only the recipient can accept', () => {
    const s = playState(215);
    runCmd(s, {
      type: 'TRADE_PROPOSE',
      playerId: 'p1',
      toPlayerId: 'p2',
      offer: offer(1),
      request: { ...offer(), ore: 1 },
    });
    expectEngineError(
      () => runCmd(s, { type: 'TRADE_ACCEPT', playerId: 'p3', tradeId: s.pendingTrades[0]!.id }),
      'NOT_YOUR_TRADE',
    );
  });

  it('pending trades are declined when the turn ends', () => {
    const s = playState(216);
    runCmd(s, {
      type: 'TRADE_PROPOSE',
      playerId: 'p1',
      toPlayerId: 'p2',
      offer: offer(1),
      request: { ...offer(), ore: 1 },
    });
    const events = runCmd(s, { type: 'END_TURN', playerId: 'p1' });
    expect(events.some((e) => e.type === 'TRADE_DECLINED')).toBe(true);
    expect(s.pendingTrades).toHaveLength(0);
    expect(s.currentPlayerId).toBe('p2');
  });

  it('rejects empty or self trades', () => {
    const s = playState(217);
    const empty = emptyResources();
    expectEngineError(
      () => runCmd(s, { type: 'TRADE_PROPOSE', playerId: 'p1', toPlayerId: 'p2', offer: empty, request: { ...empty, ore: 1 } }),
      'INVALID_TRADE',
    );
    expectEngineError(
      () => runCmd(s, { type: 'TRADE_PROPOSE', playerId: 'p1', toPlayerId: 'p1', offer: { ...empty, wood: 1 }, request: { ...empty, ore: 1 } }),
      'INVALID_TRADE',
    );
  });
});
