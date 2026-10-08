/**
 * Isleforge game engine — core domain types.
 *
 * Original game: "Archipelago" (the Isleforge base game).
 * All terminology, names and rules text in this package are original.
 */

export type ResourceType = 'wood' | 'brick' | 'grain' | 'wool' | 'ore';
export const RESOURCES: readonly ResourceType[] = ['wood', 'brick', 'grain', 'wool', 'ore'];

export type ResourceCount = Record<ResourceType, number>;

export function emptyResources(): ResourceCount {
  return { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 };
}

export function totalResources(hand: ResourceCount): number {
  return RESOURCES.reduce((sum, r) => sum + hand[r], 0);
}

export function addResources(a: ResourceCount, b: ResourceCount): ResourceCount {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = a[r] + b[r];
  return out;
}

export type TerrainType = 'forest' | 'hills' | 'fields' | 'pasture' | 'mountains' | 'desert';

export const TERRAIN_RESOURCE: Record<TerrainType, ResourceType | null> = {
  forest: 'wood',
  hills: 'brick',
  fields: 'grain',
  pasture: 'wool',
  mountains: 'ore',
  desert: null,
};

export type DevCardType = 'guardian' | 'trailblazer' | 'harvest' | 'embargo' | 'landmark';

/** Base-game development deck composition: 25 cards. */
export const DEV_DECK_COMPOSITION: Record<DevCardType, number> = {
  guardian: 14,
  trailblazer: 2,
  harvest: 2,
  embargo: 2,
  landmark: 5,
};

export interface DevCard {
  uid: string;
  type: DevCardType;
  /** A card bought this turn cannot be played until the next turn. */
  playable: boolean;
}

/** Original Isleforge player colors (not tied to any existing brand). */
export type PlayerColor = 'ember' | 'tide' | 'moss' | 'dune' | 'orchid' | 'slate';
export const PLAYER_COLORS: readonly PlayerColor[] = ['ember', 'tide', 'moss', 'dune', 'orchid', 'slate'];

export type Phase = 'setup' | 'roll' | 'discard' | 'raider' | 'play' | 'gameover';

/** Build costs for the base game. */
export const COSTS: Record<'road' | 'settlement' | 'city' | 'devCard', ResourceCount> = {
  road: { wood: 1, brick: 1, grain: 0, wool: 0, ore: 0 },
  settlement: { wood: 1, brick: 1, grain: 1, wool: 1, ore: 0 },
  city: { wood: 0, brick: 0, grain: 2, wool: 0, ore: 3 },
  devCard: { wood: 0, brick: 0, grain: 1, wool: 1, ore: 1 },
};

export const VICTORY_POINT_TARGET = 10;
export const LONGEST_ROAD_MINIMUM = 5;
export const LARGEST_ARMY_MINIMUM = 3;
export const BANK_STARTING_STOCK = 19;

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export interface HexCoord {
  q: number;
  r: number;
}

export interface Tile {
  key: string;
  q: number;
  r: number;
  terrain: TerrainType;
  /** Dice number token; null for the desert. */
  number: number | null;
}

export type PortKind = 'three' | ResourceType;

export interface Port {
  edgeId: string;
  cornerIds: [string, string];
  kind: PortKind;
}

export interface CornerInfo {
  /** Tile keys touching this corner. */
  tiles: string[];
  /** Neighboring corner ids (share an edge). */
  neighbors: string[];
}

export interface EdgeInfo {
  corners: [string, string];
  /** Tile keys touching this edge (1 for coastal edges). */
  tiles: string[];
}

/**
 * Board topology stored as plain records so the whole game state is
 * JSON-serializable (event sourcing, future server/client transfer).
 */
export interface Board {
  tiles: Tile[];
  tileByKey: Record<string, Tile>;
  corners: Record<string, CornerInfo>;
  edges: Record<string, EdgeInfo>;
  /** cornerId -> edgeIds touching it */
  cornerEdges: Record<string, string[]>;
  ports: Port[];
}

/* ------------------------------------------------------------------ */
/* Players & game state                                                */
/* ------------------------------------------------------------------ */

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  offer: ResourceCount;
  request: ResourceCount;
}

export interface PlayerState {
  id: string;
  name: string;
  color: PlayerColor;
  resources: ResourceCount;
  settlements: string[];
  cities: string[];
  roads: string[];
  devCards: DevCard[];
  guardiansPlayed: number;
  /** Silent victory points from Landmark cards (hidden until they decide the game). */
  devVictoryPoints: number;
  /** Free road placements granted by a Trailblazer card. */
  freeRoads: number;
  resigned: boolean;
}

export interface SetupState {
  /** Snake order of player ids: [p0..pn, pn..p0]. */
  order: string[];
  cursor: number;
  expecting: 'settlement' | 'road';
}

export interface GameState {
  version: 1;
  seed: number;
  mapId: string;
  board: Board;
  players: PlayerState[];
  /** Fixed turn order (player ids). */
  playerOrder: string[];
  bank: ResourceCount;
  devDeck: DevCardType[];
  raiderTileKey: string;
  turnNumber: number;
  currentPlayerId: string | null;
  phase: Phase;
  dice: [number, number] | null;
  /** playerId -> cards that player must discard (7 rolled). */
  pendingDiscards: Record<string, number> | null;
  /** True when the current player still owes a steal after moving the raider. */
  /** Why the raider phase was entered (for RAIDER_MOVED reason + UI). */
  raiderReason: 'dice' | 'guardian' | null;
  pendingSteal: boolean;
  pendingTrades: TradeOffer[];
  longestRoad: { playerId: string | null; length: number };
  largestArmy: { playerId: string | null; count: number };
  winnerId: string | null;
  devCardPlayedThisTurn: boolean;
  setup: SetupState | null;
  nextCardUid: number;
  nextTradeId: number;
  events: GameEvent[];
}

/* ------------------------------------------------------------------ */
/* Commands (client/engine input — always validated, never trusted)     */
/* ------------------------------------------------------------------ */

export type Command =
  | { type: 'PLACE_SETTLEMENT'; playerId: string; cornerId: string }
  | { type: 'PLACE_ROAD'; playerId: string; edgeId: string }
  | { type: 'ROLL_DICE'; playerId: string }
  | { type: 'DISCARD_RESOURCES'; playerId: string; resources: ResourceCount }
  | { type: 'MOVE_RAIDER'; playerId: string; tileKey: string }
  | { type: 'STEAL_RESOURCE'; playerId: string; targetPlayerId: string }
  | { type: 'BUILD_ROAD'; playerId: string; edgeId: string }
  | { type: 'BUILD_SETTLEMENT'; playerId: string; cornerId: string }
  | { type: 'BUILD_CITY'; playerId: string; cornerId: string }
  | { type: 'BUY_DEVELOPMENT_CARD'; playerId: string }
  | {
      type: 'PLAY_DEVELOPMENT_CARD';
      playerId: string;
      cardUid: string;
      params?: { resources?: [ResourceType, ResourceType]; resource?: ResourceType };
    }
  | { type: 'TRADE_BANK'; playerId: string; give: ResourceType; receive: ResourceType }
  | {
      type: 'TRADE_PROPOSE';
      playerId: string;
      toPlayerId: string;
      offer: ResourceCount;
      request: ResourceCount;
    }
  | { type: 'TRADE_ACCEPT'; playerId: string; tradeId: string }
  | { type: 'TRADE_DECLINE'; playerId: string; tradeId: string }
  | { type: 'END_TURN'; playerId: string }
  | { type: 'RESIGN'; playerId: string };

/* ------------------------------------------------------------------ */
/* Events (the single source of truth — immutable, replayable)         */
/* ------------------------------------------------------------------ */

export interface GameEventBase {
  seq: number;
  playerId?: string;
}

export type GameEvent =
  | (GameEventBase & {
      type: 'GAME_CREATED';
      data: { seed: number; mapId: string; players: { id: string; name: string; color: PlayerColor }[] };
    })
  | (GameEventBase & { type: 'TURN_STARTED'; data: { turnNumber: number } })
  | (GameEventBase & { type: 'TURN_PHASE_CHANGED'; data: { phase: Phase } })
  | (GameEventBase & {
      type: 'SETUP_PLACED';
      data: { kind: 'settlement' | 'road'; cornerId?: string; edgeId?: string };
    })
  | (GameEventBase & { type: 'DICE_ROLLED'; data: { d1: number; d2: number; total: number } })
  | (GameEventBase & {
      type: 'RESOURCE_GRANTED';
      data: { resource: ResourceType; amount: number; reason: 'production' | 'setup' | 'harvest' | 'embargo' | 'trade' };
    })
  | (GameEventBase & {
      type: 'RESOURCES_PAID';
      data: { resources: ResourceCount; reason: 'build' | 'card' | 'bank-trade' | 'player-trade' };
    })
  | (GameEventBase & { type: 'DISCARDS_REQUIRED'; data: { required: Record<string, number> } })
  | (GameEventBase & { type: 'RESOURCES_DISCARDED'; data: { resources: ResourceCount } })
  | (GameEventBase & {
      type: 'RAIDER_MOVED';
      data: { fromTileKey: string; toTileKey: string; reason: 'dice' | 'guardian' };
    })
  | (GameEventBase & {
      type: 'RESOURCE_STOLEN';
      data: { resource: ResourceType | null; amount: number; reason: 'raider' | 'embargo'; fromPlayerId?: string };
    })
  | (GameEventBase & { type: 'ROAD_BUILT'; data: { edgeId: string; free: boolean } })
  | (GameEventBase & { type: 'SETTLEMENT_BUILT'; data: { cornerId: string } })
  | (GameEventBase & { type: 'CITY_BUILT'; data: { cornerId: string } })
  | (GameEventBase & { type: 'CARD_PURCHASED'; data: { cardUid: string; cardType: DevCardType } })
  | (GameEventBase & {
      type: 'CARD_PLAYED';
      data: { cardUid: string; cardType: DevCardType; params?: { resources?: [ResourceType, ResourceType]; resource?: ResourceType } };
    })
  | (GameEventBase & {
      type: 'TRADE_PROPOSED';
      data: { tradeId: string; toPlayerId: string; offer: ResourceCount; request: ResourceCount };
    })
  | (GameEventBase & { type: 'TRADE_ACCEPTED'; data: { tradeId: string } })
  | (GameEventBase & { type: 'TRADE_DECLINED'; data: { tradeId: string } })
  | (GameEventBase & {
      type: 'BANK_TRADED';
      data: { give: ResourceType; giveCount: number; receive: ResourceType };
    })
  | (GameEventBase & { type: 'LONGEST_ROAD_CHANGED'; data: { playerId: string | null; length: number } })
  | (GameEventBase & { type: 'LARGEST_ARMY_CHANGED'; data: { playerId: string | null; count: number } })
  | (GameEventBase & { type: 'VICTORY_ACHIEVED'; data: { victoryPoints: number } })
  | (GameEventBase & { type: 'PLAYER_RESIGNED'; data: Record<string, never> })
  | (GameEventBase & {
      type: 'GAME_ENDED';
      data: { winnerId: string | null; reason: 'victory' | 'resignation' };
    });

export type GameEventType = GameEvent['type'];

/** Validation / rule errors thrown by dispatch(). Never trust the caller. */
export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
