/**
 * GameState construction helpers. The state itself is plain JSON data;
 * all transitions happen through events (see events.ts).
 */

import { generateBoard, CLASSIC_MAP_ID } from './board.js';
import { mulberry32, shuffled } from './rng.js';
import {
  BANK_STARTING_STOCK,
  DEV_DECK_COMPOSITION,
  emptyResources,
  type Board,
  type DevCardType,
  type GameState,
  type PlayerColor,
  type PlayerState,
} from './types.js';

export function blankBoard(): Board {
  return { tiles: [], tileByKey: {}, corners: {}, edges: {}, cornerEdges: {}, ports: [] };
}

export function blankState(): GameState {
  return {
    version: 1,
    seed: 0,
    mapId: CLASSIC_MAP_ID,
    board: blankBoard(),
    players: [],
    playerOrder: [],
    bank: emptyResources(),
    devDeck: [],
    raiderTileKey: '',
    turnNumber: 0,
    currentPlayerId: null,
    phase: 'setup',
    dice: null,
    pendingDiscards: null,
    raiderReason: null,
    pendingSteal: false,
    pendingTrades: [],
    longestRoad: { playerId: null, length: 0 },
    largestArmy: { playerId: null, count: 0 },
    winnerId: null,
    devCardPlayedThisTurn: false,
    setup: null,
    nextCardUid: 1,
    nextTradeId: 1,
    events: [],
  };
}

export function freshPlayer(id: string, name: string, color: PlayerColor): PlayerState {
  return {
    id,
    name,
    color,
    resources: emptyResources(),
    settlements: [],
    cities: [],
    roads: [],
    devCards: [],
    guardiansPlayed: 0,
    devVictoryPoints: 0,
    freeRoads: 0,
    resigned: false,
  };
}

/** Deterministic initial development deck from the seed. */
export function initialDevDeck(seed: number): DevCardType[] {
  const cards: DevCardType[] = [];
  for (const [type, count] of Object.entries(DEV_DECK_COMPOSITION) as [DevCardType, number][]) {
    for (let i = 0; i < count; i++) cards.push(type);
  }
  return shuffled(cards, mulberry32((seed ^ 0xdec0de) >>> 0));
}

export function initialBank(): ReturnType<typeof emptyResources> {
  return {
    wood: BANK_STARTING_STOCK,
    brick: BANK_STARTING_STOCK,
    grain: BANK_STARTING_STOCK,
    wool: BANK_STARTING_STOCK,
    ore: BANK_STARTING_STOCK,
  };
}

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) throw new Error(`Unknown player: ${playerId}`);
  return p;
}

export function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.resigned);
}

/** Next non-resigned player id after `playerId` in turn order. */
export function nextActivePlayerId(state: GameState, playerId: string): string | null {
  const order = state.playerOrder;
  const idx = order.indexOf(playerId);
  if (idx === -1) return null;
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(idx + i) % order.length] as string;
    const p = state.players.find((pl) => pl.id === candidate);
    if (p && !p.resigned) return candidate;
  }
  return null;
}
