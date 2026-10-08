import { describe, expect, it } from 'vitest';
import { totalResources, type GameState } from '../src/index.js';
import { boosted, completeSetup, expectEngineError, newGame, runCmd, scriptedRng } from './helpers.js';

function rollableState(seed = 401): GameState {
  const g = newGame(seed);
  return boosted(completeSetup(g), { wood: 10, brick: 10, grain: 10, wool: 10, ore: 10 });
}

/** Roll a 7 (3+4) on the given state. */
function rollSeven(s: GameState): void {
  const before = s.players[0]!.resources;
  void before;
  runCmd(s, { type: 'ROLL_DICE', playerId: s.currentPlayerId! }, scriptedRng([3, 4]));
}

describe('rolling a 7', () => {
  it('forces discards from players holding more than 7 cards', () => {
    const s = rollableState();
    // p1..p4 hold 50 each after boosting
    rollSeven(s);
    const req = s.events.find((e) => e.type === 'DISCARDS_REQUIRED');
    expect(req?.type).toBe('DISCARDS_REQUIRED');
    if (req?.type === 'DISCARDS_REQUIRED') {
      expect(req.data.required).toEqual({ p1: 25, p2: 25, p3: 25, p4: 25 });
    }
    expect(s.phase).toBe('discard');
  });

  it('skips the discard phase when nobody holds more than 7', () => {
    const s = rollableState(402);
    for (const p of s.players) {
      p.resources = { wood: 1, brick: 1, grain: 1, wool: 1, ore: 1 }; // 5 each
    }
    rollSeven(s);
    expect(s.events.some((e) => e.type === 'DISCARDS_REQUIRED')).toBe(false);
    expect(s.phase).toBe('raider');
  });

  it('discards exactly half (rounded down), then moves to the raider phase', () => {
    const s = rollableState(403);
    s.players[0]!.resources = { wood: 8, brick: 0, grain: 0, wool: 0, ore: 0 };
    s.players[1]!.resources = { wood: 9, brick: 0, grain: 0, wool: 0, ore: 0 };
    s.players[2]!.resources = { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 };
    s.players[3]!.resources = { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 };
    rollSeven(s);
    const req = s.events.find((e) => e.type === 'DISCARDS_REQUIRED');
    if (req?.type === 'DISCARDS_REQUIRED') {
      expect(req.data.required).toEqual({ p1: 4, p2: 4 });
    }
    // wrong amount rejected
    expectEngineError(
      () =>
        runCmd(s, {
          type: 'DISCARD_RESOURCES',
          playerId: 'p1',
          resources: { wood: 3, brick: 0, grain: 0, wool: 0, ore: 0 },
        }),
      'INVALID_DISCARD',
    );
    // discarding more than held rejected (total matches, one pile does not)
    expectEngineError(
      () =>
        runCmd(s, {
          type: 'DISCARD_RESOURCES',
          playerId: 'p1',
          resources: { wood: 0, brick: 4, grain: 0, wool: 0, ore: 0 },
        }),
      'INSUFFICIENT_RESOURCES',
    );
    runCmd(s, {
      type: 'DISCARD_RESOURCES',
      playerId: 'p1',
      resources: { wood: 4, brick: 0, grain: 0, wool: 0, ore: 0 },
    });
    expect(s.phase).toBe('discard'); // p2 still owes
    expect(totalResources(s.players[0]!.resources)).toBe(4);
    runCmd(s, {
      type: 'DISCARD_RESOURCES',
      playerId: 'p2',
      resources: { wood: 4, brick: 0, grain: 0, wool: 0, ore: 0 },
    });
    expect(s.phase).toBe('raider');
    expect(s.pendingDiscards).toBeNull();
  });

  it('a player who does not owe discards cannot discard', () => {
    const s = rollableState(404);
    s.players[0]!.resources = { wood: 8, brick: 0, grain: 0, wool: 0, ore: 0 };
    for (const p of s.players.slice(1)) p.resources = { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 };
    rollSeven(s);
    expectEngineError(
      () =>
        runCmd(s, {
          type: 'DISCARD_RESOURCES',
          playerId: 'p2',
          resources: { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 },
        }),
      'NO_DISCARD_REQUIRED',
    );
  });
});

describe('moving the raider', () => {
  function raiderState(seed = 411): GameState {
    const s = rollableState(seed);
    for (const p of s.players) p.resources = { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 };
    rollSeven(s); // -> raider phase directly
    if (s.phase !== 'raider') throw new Error('fixture failed');
    return s;
  }

  it('moves to a new tile and records the reason', () => {
    const s = raiderState();
    const target = s.board.tiles.find((t) => t.key !== s.raiderTileKey)!;
    const events = runCmd(s, { type: 'MOVE_RAIDER', playerId: 'p1', tileKey: target.key });
    const moved = events.find((e) => e.type === 'RAIDER_MOVED');
    expect(moved?.type).toBe('RAIDER_MOVED');
    if (moved?.type === 'RAIDER_MOVED') {
      expect(moved.data.toTileKey).toBe(target.key);
      expect(moved.data.reason).toBe('dice');
    }
    expect(s.raiderTileKey).toBe(target.key);
  });

  it('rejects moving to the tile the raider already occupies', () => {
    const s = raiderState(412);
    expectEngineError(
      () => runCmd(s, { type: 'MOVE_RAIDER', playerId: 'p1', tileKey: s.raiderTileKey }),
      'ILLEGAL_LOCATION',
    );
  });

  it('goes straight to play when no victim is adjacent', () => {
    const s = raiderState(413);
    // move the raider somewhere with no adjacent buildings: the desert is empty at start,
    // so move it back... it's already there. Pick any tile and clear adjacency via fixture:
    const target = s.board.tiles.find((t) => t.key !== s.raiderTileKey)!;
    const adjacentCorners = Object.keys(s.board.corners).filter((cid) =>
      s.board.corners[cid]!.tiles.includes(target.key),
    );
    // strip every building from adjacent corners
    for (const p of s.players) {
      p.settlements = p.settlements.filter((c) => !adjacentCorners.includes(c));
      p.cities = p.cities.filter((c) => !adjacentCorners.includes(c));
    }
    runCmd(s, { type: 'MOVE_RAIDER', playerId: 'p1', tileKey: target.key });
    expect(s.pendingSteal).toBe(false);
    expect(s.phase).toBe('play');
  });

  it('steals a random resource from an adjacent victim', () => {
    const s = raiderState(414);
    const target = s.board.tiles.find((t) => t.key !== s.raiderTileKey)!;
    const corner = Object.keys(s.board.corners).find((cid) =>
      s.board.corners[cid]!.tiles.includes(target.key),
    )!;
    s.players[1]!.settlements.push(corner); // p2 adjacent
    s.players[1]!.resources = { wood: 0, brick: 3, grain: 0, wool: 0, ore: 0 };
    runCmd(s, { type: 'MOVE_RAIDER', playerId: 'p1', tileKey: target.key });
    expect(s.pendingSteal).toBe(true);
    const events = runCmd(s, { type: 'STEAL_RESOURCE', playerId: 'p1', targetPlayerId: 'p2' });
    const stolen = events.find((e) => e.type === 'RESOURCE_STOLEN');
    expect(stolen?.type).toBe('RESOURCE_STOLEN');
    if (stolen?.type === 'RESOURCE_STOLEN') {
      expect(stolen.data.resource).toBe('brick'); // only resource p2 holds
      expect(stolen.data.amount).toBe(1);
    }
    expect(s.players[1]!.resources.brick).toBe(2);
    expect(s.players[0]!.resources.brick).toBe(1);
    expect(s.phase).toBe('play');
    expect(s.pendingSteal).toBe(false);
  });

  it('stealing from an empty victim yields nothing but still ends the phase', () => {
    const s = raiderState(415);
    const target = s.board.tiles.find((t) => t.key !== s.raiderTileKey)!;
    const corner = Object.keys(s.board.corners).find((cid) =>
      s.board.corners[cid]!.tiles.includes(target.key),
    )!;
    s.players[1]!.settlements.push(corner);
    runCmd(s, { type: 'MOVE_RAIDER', playerId: 'p1', tileKey: target.key });
    const events = runCmd(s, { type: 'STEAL_RESOURCE', playerId: 'p1', targetPlayerId: 'p2' });
    const stolen = events.find((e) => e.type === 'RESOURCE_STOLEN');
    if (stolen?.type === 'RESOURCE_STOLEN') expect(stolen.data.resource).toBeNull();
    expect(s.phase).toBe('play');
  });

  it('rejects stealing with no pending steal, from self, or from non-adjacent players', () => {
    const s = raiderState(416);
    expectEngineError(
      () => runCmd(s, { type: 'STEAL_RESOURCE', playerId: 'p1', targetPlayerId: 'p2' }),
      'NOTHING_TO_STEAL',
    );
    const target = s.board.tiles.find((t) => t.key !== s.raiderTileKey)!;
    const corner = Object.keys(s.board.corners).find((cid) =>
      s.board.corners[cid]!.tiles.includes(target.key),
    )!;
    s.players[1]!.settlements.push(corner);
    runCmd(s, { type: 'MOVE_RAIDER', playerId: 'p1', tileKey: target.key });
    expectEngineError(
      () => runCmd(s, { type: 'STEAL_RESOURCE', playerId: 'p1', targetPlayerId: 'p1' }),
      'INVALID_TARGET',
    );
    // a player with no building next to the raider is not a valid target
    const far = s.players.find(
      (p) =>
        p.id !== 'p1' &&
        p.id !== 'p2' &&
        ![...p.settlements, ...p.cities].some((c) => s.board.corners[c]!.tiles.includes(target.key)),
    )!;
    expectEngineError(
      () => runCmd(s, { type: 'STEAL_RESOURCE', playerId: 'p1', targetPlayerId: far.id }),
      'INVALID_TARGET',
    );
  });
});
