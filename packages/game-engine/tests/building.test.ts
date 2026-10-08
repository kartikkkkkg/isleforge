import { describe, expect, it } from 'vitest';
import {
  COSTS,
  cornersOfEdge,
  legalCommands,
  totalResources,
  victoryPoints,
  type GameState,
} from '../src/index.js';
import { boosted, completeSetup, expectEngineError, newGame, runCmd, toPlay } from './helpers.js';

function readyState(seed = 101): GameState {
  const g = newGame(seed);
  const done = completeSetup(g);
  return toPlay(boosted(done, { wood: 10, brick: 10, grain: 10, wool: 10, ore: 10 }));
}

describe('roads', () => {
  it('builds a road on a connected edge and charges 1 wood + 1 brick', () => {
    const s = readyState(101);
    const legal = legalCommands(s, 'p1').find((c) => c.type === 'BUILD_ROAD');
    expect(legal).toBeDefined();
    const before = { ...s.players[0]!.resources };
    runCmd(s, legal as { type: 'BUILD_ROAD'; playerId: string; edgeId: string });
    const after = s.players[0]!;
    expect(after.roads).toHaveLength(3);
    expect(after.resources.wood).toBe(before.wood - COSTS.road.wood);
    expect(after.resources.brick).toBe(before.brick - COSTS.road.brick);
    expect(after.resources.grain).toBe(before.grain);
  });

  it('rejects roads on occupied edges', () => {
    const s = readyState();
    const taken = s.players[0]!.roads[0]!;
    expectEngineError(() => runCmd(s, { type: 'BUILD_ROAD', playerId: 'p1', edgeId: taken }), 'EDGE_OCCUPIED');
  });

  it('rejects disconnected roads', () => {
    const s = readyState(102);
    const p1 = s.players[0]!;
    const owned = new Set(p1.roads);
    const network = new Set<string>();
    for (const e of p1.roads) {
      const cs = cornersOfEdge(s.board, e)!;
      network.add(cs[0]);
      network.add(cs[1]);
    }
    // an edge whose corners are all far from p1's network
    const far = Object.entries(s.board.edges).find(([eid, info]) => {
      if (owned.has(eid)) return false;
      return !info.corners.some((c) => network.has(c));
    });
    expect(far).toBeDefined();
    expectEngineError(
      () => runCmd(s, { type: 'BUILD_ROAD', playerId: 'p1', edgeId: far![0] }),
      'NO_ROAD_CONNECTION',
    );
  });

  it('rejects roads the player cannot afford (and the enumerator agrees)', () => {
    const g = newGame(103);
    completeSetup(g);
    const s = toPlay(boosted(g.getState(), { wood: 0, brick: 10, grain: 10, wool: 10, ore: 10 }));
    // the enumerator (probing the same validator) lists no affordable roads
    expect(legalCommands(s, 'p1').filter((c) => c.type === 'BUILD_ROAD')).toHaveLength(0);
    // white-box: force the attempt on a connected, unoccupied edge
    const p1 = s.players[0]!;
    const taken = new Set<string>();
    for (const p of s.players) for (const e of p.roads) taken.add(e);
    const anchors = new Set<string>();
    for (const e of p1.roads) for (const c of s.board.edges[e]!.corners) anchors.add(c);
    const edge = Object.entries(s.board.edges).find(
      ([eid, info]) => !taken.has(eid) && info.corners.some((c) => anchors.has(c)),
    )!;
    expectEngineError(
      () => runCmd(s, { type: 'BUILD_ROAD', playerId: 'p1', edgeId: edge[0] }),
      'INSUFFICIENT_RESOURCES',
    );
  });
});

describe('settlements', () => {
  it('builds a settlement on a road-connected corner and charges the cost', () => {
    const s = readyState(111);
    // controlled fixture: empty board, p1 owns a 2-road chain, tip corner is free
    for (const p of s.players) {
      p.settlements = [];
      p.cities = [];
      p.roads = [];
    }
    const board = s.board;
    const e0 = Object.keys(board.edges)[0]!;
    const [a, b] = board.edges[e0]!.corners;
    const e1 = board.cornerEdges[b]!.find((e) => e !== e0)!;
    const tip = board.edges[e1]!.corners.find((c) => c !== b)!;
    s.players[0]!.roads = [e0, e1];
    const before = { ...s.players[0]!.resources };
    runCmd(s, { type: 'BUILD_SETTLEMENT', playerId: 'p1', cornerId: tip });
    const p1 = s.players[0]!;
    expect(p1.settlements).toEqual([tip]);
    expect(p1.resources.wood).toBe(before.wood - 1);
    expect(p1.resources.brick).toBe(before.brick - 1);
    expect(p1.resources.grain).toBe(before.grain - 1);
    expect(p1.resources.wool).toBe(before.wool - 1);
    expect(victoryPoints(p1, s).public).toBe(1);
  });

  it('enforces the distance rule', () => {
    const s = readyState(112);
    const occupied = s.players[0]!.settlements[0]!;
    const neighbor = s.board.corners[occupied]!.neighbors[0]!;
    expectEngineError(
      () => runCmd(s, { type: 'BUILD_SETTLEMENT', playerId: 'p1', cornerId: neighbor }),
      'DISTANCE_RULE',
    );
  });

  it('requires a road connection', () => {
    const s = readyState(113);
    // an empty corner far from p1's roads but not adjacent to buildings
    const p1 = s.players[0]!;
    const roadCorners = new Set<string>();
    for (const e of p1.roads) {
      const cs = cornersOfEdge(s.board, e)!;
      roadCorners.add(cs[0]);
      roadCorners.add(cs[1]);
    }
    const owners = new Set<string>();
    for (const p of s.players) for (const c of [...p.settlements, ...p.cities]) owners.add(c);
    const candidate = Object.entries(s.board.corners).find(
      ([cid, info]) => !owners.has(cid) && !roadCorners.has(cid) && !info.neighbors.some((n) => owners.has(n)),
    );
    expect(candidate).toBeDefined();
    expectEngineError(
      () => runCmd(s, { type: 'BUILD_SETTLEMENT', playerId: 'p1', cornerId: candidate![0] }),
      'NO_ROAD_CONNECTION',
    );
  });
});

describe('cities', () => {
  it('upgrades a settlement to a city for 2 grain + 3 ore', () => {
    const s = readyState(121);
    const p1 = s.players[0]!;
    const target = p1.settlements[0]!;
    const before = { ...p1.resources };
    runCmd(s, { type: 'BUILD_CITY', playerId: 'p1', cornerId: target });
    expect(p1.settlements).not.toContain(target);
    expect(p1.cities).toContain(target);
    expect(p1.resources.grain).toBe(before.grain - 2);
    expect(p1.resources.ore).toBe(before.ore - 3);
    expect(victoryPoints(p1, s).public).toBe(3); // 1 remaining settlement + 1 city
  });

  it('rejects upgrading a corner without your settlement', () => {
    const s = readyState(122);
    const other = s.players[1]!.settlements[0]!;
    expectEngineError(() => runCmd(s, { type: 'BUILD_CITY', playerId: 'p1', cornerId: other }), 'ILLEGAL_LOCATION');
  });
});

describe('trailblazer free roads', () => {
  function trailblazerState(seed = 131): GameState {
    const g = newGame(seed);
    const s = toPlay(boosted(completeSetup(g), { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 }));
    s.players[0]!.devCards.push({ uid: 'c900', type: 'trailblazer', playable: true });
    return s;
  }

  function placeOneFreeRoad(s: GameState): void {
    for (const eid of Object.keys(s.board.edges)) {
      try {
        runCmd(s, { type: 'BUILD_ROAD', playerId: 'p1', edgeId: eid });
        return;
      } catch {
        /* not a legal edge — try the next */
      }
    }
    throw new Error('no free road placement found');
  }

  it('grants two free roads and blocks END_TURN until they are placed', () => {
    const s = trailblazerState();
    runCmd(s, { type: 'PLAY_DEVELOPMENT_CARD', playerId: 'p1', cardUid: 'c900' });
    expect(s.players[0]!.freeRoads).toBe(2);
    expectEngineError(() => runCmd(s, { type: 'END_TURN', playerId: 'p1' }), 'FREE_ROADS_PENDING');
    placeOneFreeRoad(s);
    placeOneFreeRoad(s);
    expect(s.players[0]!.freeRoads).toBe(0);
    expect(s.players[0]!.roads).toHaveLength(4);
    expect(totalResources(s.players[0]!.resources)).toBe(0); // nothing was charged
    runCmd(s, { type: 'END_TURN', playerId: 'p1' }); // now legal
    expect(s.currentPlayerId).toBe('p2');
  });
});
