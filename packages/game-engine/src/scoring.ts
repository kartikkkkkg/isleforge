/**
 * Scoring: victory points, longest road, largest army.
 * Pure functions over state — no randomness, no side effects.
 */

import { cornersOfEdge, occupiedCorners, playerBuildingCorners, playerRoadCorners } from './board.js';
import {
  LARGEST_ARMY_MINIMUM,
  LONGEST_ROAD_MINIMUM,
  type Board,
  type GameState,
  type PlayerState,
} from './types.js';

export interface VictoryPoints {
  /** Points visible to opponents (settlements/cities + road/army bonuses). */
  public: number;
  /** Includes hidden Landmark card points. */
  total: number;
}

export function victoryPoints(player: PlayerState, state: GameState): VictoryPoints {
  const base = player.settlements.length + player.cities.length * 2;
  const road = state.longestRoad.playerId === player.id ? 2 : 0;
  const army = state.largestArmy.playerId === player.id ? 2 : 0;
  const pub = base + road + army;
  return { public: pub, total: pub + player.devVictoryPoints };
}

/**
 * Longest continuous road for a set of road edges.
 * Opponent settlements/cities block *passing through* a corner, but a road
 * may still end at (or start from) such a corner — matching the classic rule.
 */
export function longestRoadLength(
  roads: readonly string[],
  board: Board,
  blockedCorners: Set<string>,
): number {
  if (roads.length === 0) return 0;
  const adj = new Map<string, { to: string; edge: string }[]>();
  const add = (from: string, to: string, edge: string): void => {
    const list = adj.get(from) ?? [];
    list.push({ to, edge });
    adj.set(from, list);
  };
  for (const e of roads) {
    const corners = cornersOfEdge(board, e);
    if (!corners) continue;
    add(corners[0], corners[1], e);
    add(corners[1], corners[0], e);
  }

  const used = new Set<string>();
  const dfs = (v: string, depth: number): number => {
    // A blocked corner may only be a path endpoint, never passed through.
    if (blockedCorners.has(v) && depth > 0) return depth;
    let best = depth;
    for (const { to, edge } of adj.get(v) ?? []) {
      if (used.has(edge)) continue;
      used.add(edge);
      const len = dfs(to, depth + 1);
      if (len > best) best = len;
      used.delete(edge);
    }
    return best;
  };

  let best = 0;
  for (const v of adj.keys()) {
    const len = dfs(v, 0);
    if (len > best) best = len;
  }
  return best;
}

/** Corners no road may pass through for `playerId` (opponents' buildings). */
export function blockedCornersFor(state: GameState, playerId: string): Set<string> {
  const blocked = new Set<string>();
  for (const p of state.players) {
    if (p.id === playerId) continue;
    for (const c of p.settlements) blocked.add(c);
    for (const c of p.cities) blocked.add(c);
  }
  return blocked;
}

export function roadLengthForPlayer(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  return longestRoadLength(player.roads, state.board, blockedCornersFor(state, playerId));
}

/**
 * Recompute the longest-road holder. Ties keep the current holder; a holder
 * who drops below the minimum loses the title to the longest qualifier
 * (ties broken by turn order).
 */
export function computeLongestRoadHolder(state: GameState): { playerId: string | null; length: number } {
  const lengths = new Map<string, number>();
  for (const p of state.players) {
    if (p.resigned) continue;
    lengths.set(p.id, roadLengthForPlayer(state, p.id));
  }
  let holder: string | null = null;
  let best = 0;
  const current = state.longestRoad.playerId;
  const currentLen = current ? (lengths.get(current) ?? 0) : 0;
  if (current && currentLen >= LONGEST_ROAD_MINIMUM) {
    holder = current;
    best = currentLen;
  }
  for (const id of state.playerOrder) {
    const len = lengths.get(id) ?? 0;
    if (len >= LONGEST_ROAD_MINIMUM && len > best) {
      holder = id;
      best = len;
    }
  }
  return { playerId: holder, length: best };
}

/** Same tie rules as longest road, driven by guardians played (>= 3). */
export function computeLargestArmyHolder(state: GameState): { playerId: string | null; count: number } {
  let holder: string | null = null;
  let best = 0;
  const current = state.largestArmy.playerId;
  const currentCount = state.players.find((p) => p.id === current)?.guardiansPlayed ?? 0;
  if (current && currentCount >= LARGEST_ARMY_MINIMUM) {
    holder = current;
    best = currentCount;
  }
  for (const id of state.playerOrder) {
    const count = state.players.find((p) => p.id === id)?.guardiansPlayed ?? 0;
    if (count >= LARGEST_ARMY_MINIMUM && count > best) {
      holder = id;
      best = count;
    }
  }
  return { playerId: holder, count: best };
}
