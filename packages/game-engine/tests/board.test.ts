import { describe, expect, it } from 'vitest';
import {
  generateBoard,
  hexDistance,
  tileResource,
  type Board,
  type TerrainType,
} from '../src/index.js';

function neighborKeys(board: Board, key: string): string[] {
  const t = board.tileByKey[key];
  if (!t) return [];
  const offs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  return offs.map(([dq = 0, dr = 0]) => `${t.q + dq},${t.r + dr}`).filter((k) => board.tileByKey[k]);
}

describe('board generation', () => {
  it('creates 19 tiles on a radius-2 hex grid', () => {
    const b = generateBoard(1);
    expect(b.tiles).toHaveLength(19);
    for (const t of b.tiles) expect(hexDistance(t.q, t.r)).toBeLessThanOrEqual(2);
  });

  it('uses the classic terrain mix', () => {
    const b = generateBoard(7);
    const counts = {} as Record<TerrainType, number>;
    for (const t of b.tiles) counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;
    expect(counts).toEqual({ forest: 4, hills: 3, fields: 4, pasture: 4, mountains: 3, desert: 1 });
  });

  it('places 18 number tokens with the standard distribution (desert excluded)', () => {
    const b = generateBoard(11);
    const tokens = b.tiles.map((t) => t.number).filter((n): n is number => n !== null);
    expect(tokens).toHaveLength(18);
    expect([...tokens].sort((x, y) => x - y)).toEqual(
      [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    );
    const desert = b.tiles.find((t) => t.terrain === 'desert');
    expect(desert?.number).toBeNull();
  });

  it('never places 6/8 on adjacent tiles (many seeds)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const b = generateBoard(seed);
      const hot = new Set(b.tiles.filter((t) => t.number === 6 || t.number === 8).map((t) => t.key));
      for (const key of hot) {
        for (const n of neighborKeys(b, key)) {
          expect(hot.has(n), `seed ${seed}: adjacent 6/8 at ${key} / ${n}`).toBe(false);
        }
      }
    }
  });

  it('builds a consistent topology: 54 corners, 72 edges', () => {
    const b = generateBoard(3);
    expect(Object.keys(b.corners)).toHaveLength(54);
    expect(Object.keys(b.edges)).toHaveLength(72);
    // every edge references real corners; neighbor links are symmetric
    for (const [eid, info] of Object.entries(b.edges)) {
      expect(b.corners[info.corners[0]]).toBeDefined();
      expect(b.corners[info.corners[1]]).toBeDefined();
      expect(info.tiles.length).toBeGreaterThanOrEqual(1);
      expect(info.tiles.length).toBeLessThanOrEqual(2);
      void eid;
    }
    for (const [cid, info] of Object.entries(b.corners)) {
      for (const n of info.neighbors) {
        expect(b.corners[n]?.neighbors).toContain(cid);
      }
      expect(b.cornerEdges[cid]?.length).toBe(info.neighbors.length);
    }
  });

  it('places 9 ports on coastal edges with the standard mix', () => {
    const b = generateBoard(5);
    expect(b.ports).toHaveLength(9);
    const kinds = b.ports.map((p) => p.kind).sort();
    expect(kinds).toEqual(['brick', 'grain', 'ore', 'three', 'three', 'three', 'three', 'wood', 'wool']);
    for (const p of b.ports) {
      const edge = b.edges[p.edgeId];
      expect(edge?.tiles).toHaveLength(1); // coastal
      expect(p.cornerIds).toEqual(edge?.corners);
    }
  });

  it('maps terrain to the right resource', () => {
    const b = generateBoard(9);
    for (const t of b.tiles) {
      const res = tileResource(t);
      if (t.terrain === 'desert') expect(res).toBeNull();
      else expect(res).not.toBeNull();
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = JSON.stringify(generateBoard(42));
    const b = JSON.stringify(generateBoard(42));
    expect(a).toBe(b);
    expect(JSON.stringify(generateBoard(43))).not.toBe(a);
  });

  it('rejects unknown map ids', () => {
    expect(() => generateBoard(1, 'nope')).toThrow();
  });
});
