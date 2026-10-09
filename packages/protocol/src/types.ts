/**
 * @isleforge/protocol — versioned WebSocket protocol for Isleforge multiplayer.
 *
 * The wire format is JSON. Every message carries `v` (protocol version).
 * Clients must send v === PROTOCOL_VERSION; the server rejects anything else.
 *
 * Validation is structural here (shapes, lengths, value sets). Semantic
 * validation — turn ownership, legality, affordability — is done by the
 * authoritative server via @isleforge/game-engine.
 */

import type {
  Command,
  GameEvent,
  PlayerColor,
  PublicGameState,
} from '@isleforge/game-engine';

export const PROTOCOL_VERSION = 1;

/** Hard cap on a single inbound WebSocket message (bytes of UTF-8 text). */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** Player display names. */
export const MAX_NAME_LENGTH = 24;
/** Chat message body. */
export const MAX_CHAT_LENGTH = 200;
/** Client-generated idempotency key for GAME_COMMAND. */
export const MAX_COMMAND_ID_LENGTH = 64;

/* ------------------------------------------------------------------ */
/* AI configuration (mirrors @isleforge/ai value sets)                */
/* ------------------------------------------------------------------ */

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export type Personality =
  | 'balanced'
  | 'aggressive'
  | 'builder'
  | 'trader'
  | 'opportunist';

export const DIFFICULTIES: readonly Difficulty[] = [
  'easy',
  'normal',
  'hard',
  'expert',
];
export const PERSONALITIES: readonly Personality[] = [
  'balanced',
  'aggressive',
  'builder',
  'trader',
  'opportunist',
];

/* ------------------------------------------------------------------ */
/* Error codes (server -> client)                                     */
/* ------------------------------------------------------------------ */

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'INVALID_PROTOCOL_VERSION'
  | 'MESSAGE_TOO_LARGE'
  | 'INVALID_COMMAND'
  | 'NOT_AUTHORIZED'
  | 'NOT_HOST'
  | 'NOT_YOUR_TURN'
  | 'NOT_IN_ROOM'
  | 'ALREADY_IN_ROOM'
  | 'GAME_NOT_FOUND'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'ROOM_FULL'
  | 'SEATS_FULL'
  | 'GAME_ALREADY_STARTED'
  | 'GAME_NOT_STARTED'
  | 'PLAYER_NOT_FOUND'
  | 'INVALID_GAME_STATE'
  | 'RECONNECT_FAILED'
  | 'RATE_LIMITED'
  | 'NAME_TAKEN'
  | 'DUPLICATE_COMMAND'
  | 'INTERNAL_ERROR';

/* ------------------------------------------------------------------ */
/* Rooms                                                              */
/* ------------------------------------------------------------------ */

export type RoomStatus = 'WAITING' | 'STARTING' | 'IN_GAME' | 'FINISHED' | 'CLOSED';

export interface RoomPlayerView {
  playerId: string;
  name: string;
  color: PlayerColor;
  ready: boolean;
  isBot: boolean;
  connected: boolean;
  isHost: boolean;
  difficulty?: Difficulty;
  personality?: Personality;
}

/** The room as clients are allowed to see it. Never carries secrets. */
export interface RoomView {
  code: string;
  status: RoomStatus;
  /** Total seats (3 or 4 — the engine's player-count contract). */
  roomSize: number;
  players: RoomPlayerView[];
  hostPlayerId: string;
  gameId: string | null;
  createdAt: number;
}

export interface CreateRoomSettings {
  /** Total seats in the room; engine requires 3–4 players. Default 4. */
  roomSize?: 3 | 4;
}

/* ------------------------------------------------------------------ */
/* Client -> server messages                                          */
/* ------------------------------------------------------------------ */

/**
 * A game command as sent over the wire. Structurally identical to the
 * engine's Command; the server re-validates it structurally on receipt and
 * the engine validates it semantically on dispatch.
 */
export type WireCommand = Command;

export type ClientMessage =
  | { v: 1; type: 'CREATE_ROOM'; name: string; settings?: CreateRoomSettings }
  | { v: 1; type: 'JOIN_ROOM'; code: string; name: string }
  | { v: 1; type: 'LEAVE_ROOM' }
  | { v: 1; type: 'SET_READY'; ready: boolean }
  | {
      v: 1;
      type: 'ADD_AI';
      difficulty?: Difficulty;
      personality?: Personality;
    }
  | { v: 1; type: 'REMOVE_AI'; playerId: string }
  | { v: 1; type: 'START_GAME' }
  | { v: 1; type: 'GAME_COMMAND'; commandId: string; command: WireCommand }
  | { v: 1; type: 'PING'; ts: number }
  | { v: 1; type: 'RECONNECT'; sessionId: string; lastSeq?: number }
  | { v: 1; type: 'GAME_CHAT'; text: string }
  | { v: 1; type: 'AUTHENTICATE'; accessToken: string }
  | { v: 1; type: 'QUEUE_JOIN' }
  | { v: 1; type: 'QUEUE_LEAVE' }
  | { v: 1; type: 'QUEUE_STATUS' };

export const CLIENT_MESSAGE_TYPES: readonly string[] = [
  'CREATE_ROOM',
  'JOIN_ROOM',
  'LEAVE_ROOM',
  'SET_READY',
  'ADD_AI',
  'REMOVE_AI',
  'START_GAME',
  'GAME_COMMAND',
  'PING',
  'RECONNECT',
  'GAME_CHAT',
  'AUTHENTICATE',
  'QUEUE_JOIN',
  'QUEUE_LEAVE',
  'QUEUE_STATUS',
];

/* ------------------------------------------------------------------ */
/* Server -> client messages                                          */
/* ------------------------------------------------------------------ */

export type ServerMessage =
  | {
      v: 1;
      type: 'ROOM_CREATED';
      room: RoomView;
      sessionId: string;
      playerId: string;
    }
  | { v: 1; type: 'ROOM_STATE'; room: RoomView }
  | { v: 1; type: 'PLAYER_JOINED'; player: RoomPlayerView }
  | { v: 1; type: 'PLAYER_LEFT'; playerId: string }
  | { v: 1; type: 'GAME_STARTED'; gameId: string; playerId: string }
  | { v: 1; type: 'GAME_EVENT'; seq: number; event: GameEvent }
  | { v: 1; type: 'GAME_STATE'; state: PublicGameState; lastSeq: number }
  | { v: 1; type: 'COMMAND_ACCEPTED'; commandId: string; seqs: number[] }
  | {
      v: 1;
      type: 'CHAT_MESSAGE';
      from: string;
      fromName: string;
      text: string;
      ts: number;
    }
  | { v: 1; type: 'ERROR'; code: ErrorCode; message: string; commandId?: string }
  | { v: 1; type: 'PONG'; ts: number }
  | {
      v: 1;
      type: 'RECONNECT_SUCCESS';
      playerId: string;
      room: RoomView;
      /** Events the client missed while away (after lastSeq). */
      missedEvents: GameEvent[];
    }
  | { v: 1; type: 'GAME_ENDED'; winnerId: string | null; reason: string }
  | { v: 1; type: 'AUTHENTICATED'; userId: string }
  | { v: 1; type: 'QUEUE_JOINED'; queuedAt: number }
  | {
      v: 1;
      type: 'QUEUE_STATUS';
      status: 'QUEUED' | 'NOT_QUEUED';
      queuedAt: number | null;
      playersSearching: number;
      estimatedWaitMs: number;
    }
  | { v: 1; type: 'QUEUE_LEFT' }
  | {
      v: 1;
      type: 'MATCH_FOUND';
      players: { userId: string; displayName: string }[];
    }
  | { v: 1; type: 'MATCH_STARTING'; roomCode: string; sessionId: string; playerId: string }
  | { v: 1; type: 'MATCH_ERROR'; code: string; message: string };

/* ------------------------------------------------------------------ */
/* Chat                                                               */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  from: string;
  fromName: string;
  text: string;
  ts: number;
}
