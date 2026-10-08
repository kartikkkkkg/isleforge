/**
 * Hex board: axial-coordinate tiles, corner (settlement) and edge (road)
 * topology, seeded terrain / number-token / port placement.
 *
 * Pointy-top hexes, size 1. Corner ids are rounded world positions, which
 * makes shared corners/edges from neighboring tiles hash identically.
 */

import { mulberry32, shuffled, type Rng } from './rng.js';
import {
  TERRAIN_RESOURCE,
  type Board,
  type CornerInfo,
  type EdgeInfo,
  type HexCoord,
  type Port,
  type PortKind,
  type ResourceType,
  type TerrainType,
  type Tile,
} from './types.js';

export const CLASSIC_MAP_ID = 'archipelago-classic';
export const BOARD_RADIUS = 2;

const SQRT3 = Math.sqrt(3);

/** All axial coords with hex-distance <= radius from origin. */
export function hexCoords(radius: number): HexCoord[] {
  const coords: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= radius) {
        coords.push({ q, r });
      }
    }
  }
  return coords;
}

export function tileKey(q: number, r: number): string {
  return `${q},${r}`;
}

function hexCenter(q: number, r: number): { x: number; y: number } {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

function coordKey(v: number): string {
  // +0 normalizes -0 so "-0.000" and "0.000" hash identically.
  return (Math.round(v * 1000) / 1000 + 0).toFixed(3);
}

function cornerIdFor(q: number, r: number, i: number): string {
  const c = hexCenter(q, r);
  const angle = (Math.PI / 180) * (60 * i - 30);
  const x = c.x + Math.cos(angle);
  const y = c.y + Math.sin(angle);
  return `${coordKey(x)},${coordKey(y)}`;
}

function edgeIdFor(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const TERRAIN_COUNTS: Record<TerrainType, number> = {
  forest: 4,
  hills: 3,
  fields: 4,
  pasture: 4,
  mountains: 3,
  desert: 1,
};

const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/** Spiral placement order: outer ring first, by angle. Deterministic. */
function spiralOrder(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => {
    const ra = hexDistance(a.q, a.r);
    const rb = hexDistance(b.q, b.r);
    if (ra !== rb) return rb - ra;
    const aa = Math.atan2(1.5 * a.r, SQRT3 * (a.q + a.r / 2));
    const ab = Math.atan2(1.5 * b.r, SQRT3 * (b.q + b.r / 2));
    return aa - ab;
  });
}

export function hexDistance(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

const NEIGHBOR_OFFSETS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function neighborKeys(key: string): string[] {
  const [q, r] = key.split(',').map(Number) as [number, number];
  return NEIGHBOR_OFFSETS.map((o) => tileKey(q + o.q, r + o.r));
}

/**
 * Generate the classic 19-tile board deterministically from a seed.
 * Pure function: same seed -> identical board.
 */
export function generateBoard(seed: number, mapId: string = CLASSIC_MAP_ID): Board {
  if (mapId !== CLASSIC_MAP_ID) {
    throw new Error(`Unknown mapId: ${mapId} (milestone 1 supports ${CLASSIC_MAP_ID} only)`);
  }
  const rng: Rng = mulberry32(seed);

  // Tiles + terrain -------------------------------------------------
  const coords = hexCoords(BOARD_RADIUS).sort((a, b) => a.r - b.r || a.q - b.q);
  const terrainPool: TerrainType[] = [];
  for (const [terrain, count] of Object.entries(TERRAIN_COUNTS) as [TerrainType, number][]) {
    for (let i = 0; i < count; i++) terrainPool.push(terrain);
  }
  const terrains = shuffled(terrainPool, rng);
  const tiles: Tile[] = coords.map((c, i) => ({
    key: tileKey(c.q, c.r),
    q: c.q,
    r: c.r,
    terrain: terrains[i] as TerrainType,
    number: null,
  }));
  const tileByKey: Record<string, Tile> = {};
  for (const t of tiles) tileByKey[t.key] = t;

  // Number tokens ---------------------------------------------------
  const tokens = shuffled(NUMBER_TOKENS, rng);
  const order = spiralOrder(tiles);
  const numbered = order.filter((t) => t.terrain !== 'desert');
  numbered.forEach((t, i) => {
    t.number = tokens[i] as number;
  });
  fixAdjacentSixEight(tiles, tileByKey);

  // Topology --------------------------------------------------------
  const corners: Record<string, CornerInfo> = {};
  const edges: Record<string, EdgeInfo> = {};
  const cornerEdges: Record<string, string[]> = {};

  for (const t of tiles) {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = cornerIdFor(t.q, t.r, i);
      ids.push(id);
      const info = corners[id] ?? { tiles: [], neighbors: [] };
      if (!info.tiles.includes(t.key)) info.tiles.push(t.key);
      corners[id] = info;
    }
    for (let i = 0; i < 6; i++) {
      const a = ids[i] as string;
      const b = ids[(i + 1) % 6] as string;
      const eid = edgeIdFor(a, b);
      const info = edges[eid] ?? { corners: a < b ? [a, b] : [b, a], tiles: [] };
      if (!info.tiles.includes(t.key)) info.tiles.push(t.key);
      edges[eid] = info;
    }
  }
  for (const [eid, info] of Object.entries(edges)) {
    const [a, b] = info.corners;
    corners[a]?.neighbors.push(b);
    corners[b]?.neighbors.push(a);
    (cornerEdges[a] ??= []).push(eid);
    (cornerEdges[b] ??= []).push(eid);
  }

  // Ports: 9 coastal edges, spread around the rim --------------------
  const coastal = Object.entries(edges)
    .filter(([, info]) => info.tiles.length === 1)
    .map(([eid, info]) => {
      const [a, b] = info.corners;
      const [ax, ay] = a.split(',').map(Number) as [number, number];
      const [bx, by] = b.split(',').map(Number) as [number, number];
      return { eid, info, angle: Math.atan2((ay + by) / 2, (ax + bx) / 2) };
    })
    .sort((x, y) => x.angle - y.angle);

  const portKinds = shuffled<PortKind>(
    ['three', 'three', 'three', 'three', 'wood', 'brick', 'grain', 'wool', 'ore'],
    rng,
  );
  const ports: Port[] = [];
  for (let i = 0; i < 9; i++) {
    const idx = Math.round((i * (coastal.length - 1)) / 8);
    const picked = coastal[idx];
    if (!picked) continue;
    // Avoid picking the same edge twice (rounding can collide on small rims).
    if (ports.some((p) => p.edgeId === picked.eid)) continue;
    ports.push({ edgeId: picked.eid, cornerIds: picked.info.corners, kind: portKinds[i] as PortKind });
  }

  return { tiles, tileByKey, corners, edges, cornerEdges, ports };
}

/** Ensure no two adjacent tiles both carry 6 or 8 (classic balance rule). */
function fixAdjacentSixEight(tiles: Tile[], tileByKey: Record<string, Tile>): void {
  const isHot = (n: number | null): boolean => n === 6 || n === 8;
  for (let pass = 0; pass < 60; pass++) {
    let fixed = true;
    for (const t of tiles) {
      if (!isHot(t.number)) continue;
      const hotNeighbor = neighborKeys(t.key).some((k) => isHot(tileByKey[k]?.number ?? null));
      if (!hotNeighbor) continue;
      fixed = false;
      // Find a swap partner holding a cold token: after the swap `t` is cold
      // (so its violations vanish) and `c` must have no hot neighbors left.
      const partner = tiles.find((c) => {
        if (c.key === t.key || isHot(c.number)) return false;
        const cHotNeighbor = neighborKeys(c.key).some(
          (k) => k !== t.key && isHot(tileByKey[k]?.number ?? null),
        );
        return !cHotNeighbor;
      });
      if (partner) {
        const tmp = t.number;
        t.number = partner.number;
        partner.number = tmp;
      }
    }
    if (fixed) return;
  }
}

/* ------------------------------------------------------------------ */
/* Topology queries                                                    */
/* ------------------------------------------------------------------ */

export function tilesAdjacentToCorner(board: Board, cornerId: string): Tile[] {
  const info = board.corners[cornerId];
  if (!info) return [];
  return info.tiles.map((k) => board.tileByKey[k]).filter((t): t is Tile => Boolean(t));
}

export function edgesAdjacentToCorner(board: Board, cornerId: string): string[] {
  return board.cornerEdges[cornerId] ?? [];
}

export function cornersAdjacentToCorner(board: Board, cornerId: string): string[] {
  return board.corners[cornerId]?.neighbors ?? [];
}

export function cornersOfEdge(board: Board, edgeId: string): [string, string] | null {
  return board.edges[edgeId]?.corners ?? null;
}

/** Resource a tile produces (null for desert / raider-blocked handled by caller). */
export function tileResource(tile: Tile): ResourceType | null {
  return TERRAIN_RESOURCE[tile.terrain];
}

/** All corners where `playerId` has a building. */
export function playerBuildingCorners(
  player: { settlements: string[]; cities: string[] },
): Set<string> {
  return new Set([...player.settlements, ...player.cities]);
}

/** All corners incident to any of the player's roads. */
export function playerRoadCorners(board: Board, roads: string[]): Set<string> {
  const out = new Set<string>();
  for (const e of roads) {
    const corners = cornersOfEdge(board, e);
    if (corners) {
      out.add(corners[0]);
      out.add(corners[1]);
    }
  }
  return out;
}

/** Corners occupied by any player's building. */
export function occupiedCorners(players: { settlements: string[]; cities: string[] }[]): Set<string> {
  const out = new Set<string>();
  for (const p of players) {
    for (const c of p.settlements) out.add(c);
    for (const c of p.cities) out.add(c);
  }
  return out;
}
