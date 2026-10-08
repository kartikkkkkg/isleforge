/**
 * Pure board/state analysis for the AI. No engine mutation, no randomness.
 * Everything here is public information (board geometry, visible buildings,
 * public VP, resource *totals*). Opponent dev-card types and exact resource
 * breakdowns are never read — use the masked public view for those.
 */

import {
  cornersOfEdge,
  edgesAdjacentToCorner,
  tileResource,
  victoryPoints,
  type Board,
  type GameState,
  type PlayerState,
  type PublicGameState,
  type ResourceCount,
  type ResourceType,
  type Tile,
} from '@isleforge/game-engine';

export type AnyState = GameState | PublicGameState;

/** Probability weight of a dice number (2..12), proportional to pips. */
export function pips(n: number): number {
  if (n < 2 || n > 12) return 0;
  return 6 - Math.abs(7 - n);
}

/** Expected resource per turn from one tile (0 when raided or numberless). */
export function tileExpected(tile: Tile, raiderTileKey: string): number {
  if (tile.key === raiderTileKey) return 0;
  if (tile.number === null) return 0;
  return pips(tile.number) / 36;
}

export interface CornerYield {
  cornerId: string;
  /** Expected resources/turn per type from adjacent tiles. */
  perResource: ResourceCount;
  /** Total expected resources/turn. */
  total: number;
  /** Distinct resource types produced. */
  diversity: number;
  /** Tiles touching the corner. */
  tiles: Tile[];
}

const EMPTY: ResourceCount = { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 };

export function cornerYield(
  board: Board,
  cornerId: string,
  raiderTileKey: string,
): CornerYield {
  const perResource: ResourceCount = { ...EMPTY };
  const tiles: Tile[] = [];
  for (const key of board.corners[cornerId]?.tiles ?? []) {
    const t = board.tileByKey[key];
    if (!t) continue;
    tiles.push(t);
    const r = tileResource(t);
    if (r) perResource[r] += tileExpected(t, raiderTileKey);
  }
  let total = 0;
  let diversity = 0;
  for (const k of Object.keys(perResource) as ResourceType[]) {
    if (perResource[k] > 0) {
      total += perResource[k];
      diversity++;
    }
  }
  return { cornerId, perResource, total, diversity, tiles };
}

/** Expected resources/turn for a player from current buildings. */
export function playerProduction(state: AnyState, playerId: string): ResourceCount {
  const out: ResourceCount = { ...EMPTY };
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return out;
  const add = (cornerId: string, mult: number) => {
    const y = cornerYield(state.board, cornerId, state.raiderTileKey);
    for (const k of Object.keys(y.perResource) as ResourceType[]) {
      out[k] += y.perResource[k] * mult;
    }
  };
  for (const c of p.settlements) add(c, 1);
  for (const c of p.cities) add(c, 2);
  return out;
}

export function resourceTotal(r: ResourceCount): number {
  return r.wood + r.brick + r.grain + r.wool + r.ore;
}

/** Port serving a corner, if any. */
export function portAtCorner(
  board: Board,
  cornerId: string,
): { kind: string; } | null {
  const port = board.ports.find((x) => x.cornerIds.includes(cornerId));
  return port ? { kind: port.kind } : null;
}

function playerById(state: AnyState, id: string): PlayerState | undefined {
  return state.players.find((p) => p.id === id) as PlayerState | undefined;
}

export function publicVp(state: AnyState, playerId: string): number {
  const p = playerById(state, playerId);
  return p ? victoryPoints(p, state as GameState).public : 0;
}

export interface OpponentThreat {
  playerId: string;
  name: string;
  vp: number;
  /** Rough VP rate per turn from board position. */
  vpRate: number;
  /** Estimated turns until they could win (Infinity when stalled). */
  turnsToWin: number;
  production: number;
  cities: number;
  settlements: number;
}

/**
 * Threat assessment from public information only: visible VP, board
 * production, building counts. Never reads hidden dev cards or exact
 * opponent resources.
 */
export function assessThreats(state: AnyState, playerId: string): OpponentThreat[] {
  const out: OpponentThreat[] = [];
  for (const p of state.players) {
    if (p.id === playerId || p.resigned) continue;
    const vp = publicVp(state, p.id);
    const prod = playerProduction(state, p.id);
    const prodTotal = resourceTotal(prod);
    // ~4 resources ≈ 1 VP of progress in the mid-game; clamp the estimate.
    const vpRate = Math.min(0.6, prodTotal / 9);
    const turnsToWin = vpRate > 0.02 ? (10 - vp) / vpRate : Infinity;
    out.push({
      playerId: p.id,
      name: p.name,
      vp,
      vpRate,
      turnsToWin,
      production: prodTotal,
      cities: p.cities.length,
      settlements: p.settlements.length,
    });
  }
  out.sort((a, b) => a.turnsToWin - b.turnsToWin);
  return out;
}

/** Corners one road-segment away from my network (expansion frontier). */
export function frontierCorners(state: AnyState, playerId: string): Set<string> {
  const p = playerById(state, playerId);
  const out = new Set<string>();
  if (!p) return out;
  const occupied = new Set<string>();
  for (const q of state.players) {
    for (const c of [...q.settlements, ...q.cities]) occupied.add(c);
  }
  const myCorners = new Set<string>([...p.settlements, ...p.cities]);
  for (const e of p.roads) {
    const ends = cornersOfEdge(state.board, e);
    if (ends) for (const c of ends) myCorners.add(c);
  }
  for (const c of myCorners) {
    for (const n of state.board.corners[c]?.neighbors ?? []) {
      if (!occupied.has(n)) out.add(n);
    }
  }
  // A corner is only a real frontier if some neighbor-of-neighbor is also
  // open (room to actually place later) — keep it simple: any open neighbor.
  return out;
}

/** Does this corner touch an opponent's road network (blocking value)? */
export function touchesOpponentRoad(
  state: AnyState,
  playerId: string,
  cornerId: string,
): boolean {
  for (const q of state.players) {
    if (q.id === playerId || q.resigned) continue;
    for (const e of q.roads) {
      const ends = cornersOfEdge(state.board, e);
      if (ends && (ends[0] === cornerId || ends[1] === cornerId)) return true;
    }
  }
  return false;
}

/** Edges adjacent to a corner (helper re-export for the agent). */
export function adjacentEdges(board: Board, cornerId: string): string[] {
  return edgesAdjacentToCorner(board, cornerId);
}

/** How contested the longest-road race is (0 = nobody close, 1 = tight). */
export function roadRaceTension(state: AnyState, playerId: string): number {
  const me = playerById(state, playerId);
  if (!me) return 0;
  const myLen = me.roads.length;
  let best = 0;
  for (const q of state.players) {
    if (q.id !== playerId && !q.resigned) best = Math.max(best, q.roads.length);
  }
  if (best < 3 && myLen < 3) return 0;
  return Math.min(1, Math.max(myLen, best) / 7);
}

/** How contested the largest-army race is. */
export function armyRaceTension(state: AnyState, playerId: string): number {
  const me = playerById(state, playerId);
  if (!me) return 0;
  let best = 0;
  for (const q of state.players) {
    if (q.id !== playerId && !q.resigned) best = Math.max(best, q.guardiansPlayed);
  }
  if (best < 2 && me.guardiansPlayed < 2) return 0;
  return Math.min(1, Math.max(me.guardiansPlayed, best) / 4);
}
