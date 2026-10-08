import { describe, expect, it } from 'vitest';
import {
  computeLargestArmyHolder,
  computeLongestRoadHolder,
  cornersOfEdge,
  generateBoard,
  longestRoadLength,
  victoryPoints,
  type Board,
  type GameState,
} from '../src/index.js';
import { boosted, completeSetup, newGame, runCmd, toPlay } from './helpers.js';

/** Greedy walk returning `n` connected edges forming a simple path, plus corners in path order. */
function findChain(board: Board, n: number, exclude: Set<string> = new Set()): { edges: string[]; corners: string[] } {
  for (const start of Object.keys(board.edges)) {
    if (exclude.has(start)) continue;
    const [c0, c1] = cornersOfEdge(board, start)!;
    const edges = [start];
    const corners = [c0, c1];
    const usedEdges = new Set([start]);
    const visited = new Set([c0, c1]);
    let tip = c1;
    let ok = true;
    while (edges.length < n) {
      const next = (board.cornerEdges[tip] ?? []).find((e) => {
        if (usedEdges.has(e) || exclude.has(e)) return false;
        const cs = cornersOfEdge(board, e)!;
        const far = cs[0] === tip ? cs[1] : cs[0];
        return !visited.has(far);
      });
      if (!next) {
        ok = false;
        break;
      }
      const cs = cornersOfEdge(board, next)!;
      const far = cs[0] === tip ? cs[1] : cs[0];
      usedEdges.add(next);
      visited.add(far);
      edges.push(next);
      corners.push(far);
      tip = far;
    }
    if (ok && edges.length === n) return { edges, corners };
  }
  throw new Error(`no simple chain of ${n} found`);
}

function occupiedEdges(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const p of s.players) for (const e of p.roads) out.add(e);
  return out;
}

function fixtureState(seed = 501): GameState {
  const g = newGame(seed);
  const done = completeSetup(g);
  return toPlay(boosted(done, { wood: 20, brick: 20, grain: 20, wool: 20, ore: 20 }));
}

/** Strip every building so fixture roads are evaluated without setup clutter. */
function clearBuildings(s: GameState): void {
  for (const p of s.players) {
    p.settlements = [];
    p.cities = [];
    p.roads = [];
  }
}

describe('longestRoadLength', () => {
  it('measures a simple chain', () => {
    const board = generateBoard(11);
    expect(longestRoadLength(findChain(board, 5).edges, board, new Set())).toBe(5);
    expect(longestRoadLength(findChain(board, 8).edges, board, new Set())).toBe(8);
    expect(longestRoadLength([], board, new Set())).toBe(0);
  });

  it('is not fooled by branches', () => {
    const board = generateBoard(12);
    const chain = findChain(board, 5);
    const midCorner = chain.corners[2]!;
    const branch = (board.cornerEdges[midCorner] ?? []).find((e) => !chain.edges.includes(e))!;
    expect(longestRoadLength([...chain.edges, branch], board, new Set())).toBe(5);
  });

  it('cannot pass through an opponents building, but may end at it', () => {
    const board = generateBoard(13);
    const chain = findChain(board, 5); // corners c0..c5
    // block the true middle corner: longest becomes max(c0-c1-c2, c2-c3-c4-c5) = 3
    expect(longestRoadLength(chain.edges, board, new Set([chain.corners[2]!]))).toBe(3);
    // block a true endpoint: the road can still end there
    expect(longestRoadLength(chain.edges, board, new Set([chain.corners[0]!]))).toBe(5);
  });
});

describe('longest road title', () => {
  it('is awarded at 5 segments and worth 2 VP', () => {
    const s = fixtureState();
    clearBuildings(s);
    s.players[0]!.roads = findChain(s.board, 5).edges;
    const holder = computeLongestRoadHolder(s);
    expect(holder).toEqual({ playerId: 'p1', length: 5 });
    const cs = Object.keys(s.board.corners);
    s.players[0]!.settlements = [cs[0]!, cs[10]!];
    s.longestRoad = { playerId: 'p1', length: 5 }; // as LONGEST_ROAD_CHANGED would set it
    expect(victoryPoints(s.players[0]!, s).public).toBe(4); // 2 settlements + 2 road bonus
  });

  it('needs a strict improvement to change hands (ties keep the holder)', () => {
    const s = fixtureState(502);
    clearBuildings(s);
    s.players[0]!.roads = findChain(s.board, 5).edges;
    s.longestRoad = { playerId: 'p1', length: 5 };
    s.players[1]!.roads = findChain(s.board, 5).edges;
    expect(computeLongestRoadHolder(s).playerId).toBe('p1');
    s.players[1]!.roads = findChain(s.board, 6).edges;
    expect(computeLongestRoadHolder(s)).toEqual({ playerId: 'p2', length: 6 });
  });

  it('is lost when the holder drops below 5', () => {
    const s = fixtureState(503);
    clearBuildings(s);
    s.players[0]!.roads = findChain(s.board, 4).edges;
    s.longestRoad = { playerId: 'p1', length: 5 };
    expect(computeLongestRoadHolder(s)).toEqual({ playerId: null, length: 0 });
  });

  it('an opponents settlement in the middle breaks the road', () => {
    const s = fixtureState(504);
    clearBuildings(s);
    const chain = findChain(s.board, 6);
    s.players[0]!.roads = chain.edges;
    // p2 settles on the middle corner (white-box fixture)
    s.players[1]!.settlements.push(chain.corners[3]!);
    const holder = computeLongestRoadHolder(s);
    // longest remaining stretch for p1 is 3 -> below minimum -> no holder
    expect(holder).toEqual({ playerId: null, length: 0 });
  });
});

describe('largest army', () => {
  it('needs 3 guardians; ties keep the holder', () => {
    const s = fixtureState(511);
    s.players[0]!.guardiansPlayed = 2;
    expect(computeLargestArmyHolder(s)).toEqual({ playerId: null, count: 0 });
    s.players[0]!.guardiansPlayed = 3;
    expect(computeLargestArmyHolder(s)).toEqual({ playerId: 'p1', count: 3 });
    s.largestArmy = { playerId: 'p1', count: 3 };
    s.players[1]!.guardiansPlayed = 3;
    expect(computeLargestArmyHolder(s).playerId).toBe('p1');
    s.players[1]!.guardiansPlayed = 4;
    expect(computeLargestArmyHolder(s)).toEqual({ playerId: 'p2', count: 4 });
  });

  it('is worth 2 VP once held', () => {
    const s = fixtureState(512);
    s.players[0]!.guardiansPlayed = 3;
    s.largestArmy = { playerId: 'p1', count: 3 };
    expect(victoryPoints(s.players[0]!, s).public).toBe(4); // 2 settlements + 2 army
  });
});

describe('victory detection', () => {
  function nineVpState(): GameState {
    const s = fixtureState(521);
    const corners = Object.keys(s.board.corners);
    const p1 = s.players[0]!;
    // 5 settlements (5) + 2 cities (4) = 9 VP. Fixture bypasses placement rules;
    // BUILD_CITY validation only needs a settlement on the corner.
    p1.settlements = corners.slice(0, 5);
    p1.cities = corners.slice(5, 7);
    p1.roads = [];
    expect(victoryPoints(p1, s).total).toBe(9);
    return s;
  }

  it('declares victory at exactly 10 VP', () => {
    const s = nineVpState();
    const target = s.players[0]!.settlements[4]!;
    const events = runCmd(s, { type: 'BUILD_CITY', playerId: 'p1', cornerId: target });
    expect(victoryPoints(s.players[0]!, s).total).toBe(10);
    expect(events.some((e) => e.type === 'VICTORY_ACHIEVED')).toBe(true);
    expect(events.some((e) => e.type === 'GAME_ENDED')).toBe(true);
    const win = events.find((e) => e.type === 'VICTORY_ACHIEVED');
    if (win?.type === 'VICTORY_ACHIEVED') {
      expect(win.playerId).toBe('p1');
      expect(win.data.victoryPoints).toBe(10);
    }
    expect(s.phase).toBe('gameover');
    expect(s.winnerId).toBe('p1');
  });

  it('a longest-road swing can deliver the winning points', () => {
    const s = fixtureState(522);
    const corners = Object.keys(s.board.corners);
    const p1 = s.players[0]!;
    p1.settlements = corners.slice(0, 4); // 4
    p1.cities = corners.slice(4, 6); // +4 = 8 VP
    const taken = occupiedEdges(s);
    const chain = findChain(s.board, 5, taken);
    // anchor the chain to c0 with a free edge so the final link is legally connected
    const anchorEdge = (s.board.cornerEdges[chain.corners[0]!] ?? []).find(
      (e) => !taken.has(e) && !chain.edges.includes(e),
    )!;
    p1.roads = [anchorEdge, ...chain.edges.slice(0, 4)];
    expect(victoryPoints(p1, s).total).toBe(8);
    const events = runCmd(s, { type: 'BUILD_ROAD', playerId: 'p1', edgeId: chain.edges[4]! });
    expect(events.some((e) => e.type === 'LONGEST_ROAD_CHANGED')).toBe(true);
    expect(s.longestRoad.playerId).toBe('p1');
    expect(victoryPoints(p1, s).total).toBe(10);
    expect(s.phase).toBe('gameover');
    expect(s.winnerId).toBe('p1');
  });

  it('hidden landmark points count toward victory', () => {
    const s = fixtureState(523);
    const corners = Object.keys(s.board.corners);
    const p1 = s.players[0]!;
    p1.settlements = corners.slice(0, 5); // 5 public
    p1.devVictoryPoints = 4; // 4 hidden
    expect(victoryPoints(p1, s).public).toBe(5);
    expect(victoryPoints(p1, s).total).toBe(9);
    p1.devVictoryPoints = 5;
    // any VP-changing command re-checks: build a road on a legal edge
    let built = false;
    for (const eid of Object.keys(s.board.edges)) {
      try {
        runCmd(s, { type: 'BUILD_ROAD', playerId: 'p1', edgeId: eid });
        built = true;
        break;
      } catch {
        /* keep looking */
      }
    }
    expect(built).toBe(true);
    expect(s.phase).toBe('gameover');
    expect(s.winnerId).toBe('p1');
  });
});
