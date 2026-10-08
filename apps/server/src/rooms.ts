/**
 * RoomManager — lobby rooms for multiplayer games.
 *
 * A room holds 3–4 seats (the engine's player-count contract). Humans join
 * with a name; the host may fill empty seats with AI opponents. No public
 * matchmaking in Milestone 4: rooms are joined via short codes.
 */

import { PLAYER_COLORS, type PlayerColor } from '@isleforge/game-engine';
import type {
  Difficulty,
  Personality,
  RoomPlayerView,
  RoomStatus,
  RoomView,
} from '@isleforge/protocol';

import { generateRoomCode } from './roomCode.js';

export interface RoomPlayer {
  playerId: string;
  name: string;
  color: PlayerColor;
  ready: boolean;
  isBot: boolean;
  connected: boolean;
  /** Set when the seat is AI-piloted after a disconnect (reconnect clears it). */
  aiTakeover: boolean;
  disconnectAt: number | null;
  difficulty?: Difficulty;
  personality?: Personality;
}

export interface Room {
  code: string;
  hostPlayerId: string;
  status: RoomStatus;
  roomSize: number;
  players: RoomPlayer[];
  /** Set once the game starts; cleared never (history). */
  gameId: string | null;
  createdAt: number;
  /** Monotonic seat counter — playerIds are stable even when seats are removed. */
  nextSeat: number;
}

export type RoomError =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'ROOM_FULL'
  | 'NAME_TAKEN'
  | 'GAME_ALREADY_STARTED'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'PLAYER_NOT_FOUND'
  | 'SEATS_FULL'
  | 'NOT_A_BOT'
  | 'INVALID_STATE';

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: RoomError };

const AI_NAMES = [
  'Coral',
  'Marina',
  'Reef',
  'Pearl',
  'Kai',
  'Nixie',
  'Barnacle',
  'Drift',
];

const DEFAULT_AI: { difficulty: Difficulty; personality: Personality } = {
  difficulty: 'normal',
  personality: 'balanced',
};

export class RoomManager {
  private rooms = new Map<string, Room>();

  exists(code: string): boolean {
    return this.rooms.has(code);
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  createRoom(hostName: string, roomSize: 3 | 4 = 4): { room: Room; host: RoomPlayer } {
    const code = generateRoomCode((c) => this.rooms.has(c));
    const host: RoomPlayer = {
      playerId: 'p1',
      name: hostName,
      color: PLAYER_COLORS[0]!,
      ready: false,
      isBot: false,
      connected: true,
      aiTakeover: false,
      disconnectAt: null,
    };
    const room: Room = {
      code,
      hostPlayerId: host.playerId,
      status: 'WAITING',
      roomSize,
      players: [host],
      gameId: null,
      createdAt: Date.now(),
      nextSeat: 2,
    };
    this.rooms.set(code, room);
    return { room, host };
  }

  joinRoom(code: string, name: string): RoomResult<{ room: Room; player: RoomPlayer }> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.status === 'CLOSED') return { ok: false, error: 'ROOM_CLOSED' };
    if (room.status !== 'WAITING') return { ok: false, error: 'GAME_ALREADY_STARTED' };
    if (room.players.length >= room.roomSize) return { ok: false, error: 'ROOM_FULL' };
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: 'NAME_TAKEN' };
    }
    const seatIndex = room.nextSeat++;
    const player: RoomPlayer = {
      playerId: `p${seatIndex}`,
      name,
      color: this.nextColor(room),
      ready: false,
      isBot: false,
      connected: true,
      aiTakeover: false,
      disconnectAt: null,
    };
    room.players.push(player);
    return { ok: true, value: { room, player } };
  }

  /**
   * Remove a player from a WAITING room. During a game the seat is kept
   * (the server layer marks the player disconnected instead).
   */
  leaveRoom(code: string, playerId: string): RoomResult<Room> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    const idx = room.players.findIndex((p) => p.playerId === playerId);
    if (idx === -1) return { ok: false, error: 'NOT_IN_ROOM' };
    room.players.splice(idx, 1);
    if (room.players.length === 0) {
      room.status = 'CLOSED';
      this.rooms.delete(code);
      return { ok: true, value: room };
    }
    if (room.hostPlayerId === playerId) {
      const nextHost = room.players.find((p) => !p.isBot) ?? room.players[0]!;
      room.hostPlayerId = nextHost.playerId;
    }
    return { ok: true, value: room };
  }

  closeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (room) room.status = 'CLOSED';
    this.rooms.delete(code);
  }

  setReady(code: string, playerId: string, ready: boolean): RoomResult<Room> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.status !== 'WAITING') return { ok: false, error: 'INVALID_STATE' };
    const player = room.players.find((p) => p.playerId === playerId);
    if (!player) return { ok: false, error: 'NOT_IN_ROOM' };
    if (player.isBot) return { ok: false, error: 'INVALID_STATE' };
    player.ready = ready;
    return { ok: true, value: room };
  }

  addAI(
    code: string,
    requesterId: string,
    difficulty?: Difficulty,
    personality?: Personality,
  ): RoomResult<{ room: Room; player: RoomPlayer }> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.hostPlayerId !== requesterId) return { ok: false, error: 'NOT_HOST' };
    if (room.status !== 'WAITING') return { ok: false, error: 'INVALID_STATE' };
    if (room.players.length >= room.roomSize) return { ok: false, error: 'SEATS_FULL' };
    const seatIndex = room.nextSeat++;
    const aiCount = room.players.filter((p) => p.isBot).length;
    const player: RoomPlayer = {
      playerId: `p${seatIndex}`,
      name: AI_NAMES[aiCount % AI_NAMES.length]!,
      color: this.nextColor(room),
      ready: true,
      isBot: true,
      connected: true,
      aiTakeover: false,
      disconnectAt: null,
      difficulty: difficulty ?? DEFAULT_AI.difficulty,
      personality: personality ?? DEFAULT_AI.personality,
    };
    room.players.push(player);
    return { ok: true, value: { room, player } };
  }

  removeAI(code: string, requesterId: string, playerId: string): RoomResult<Room> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.hostPlayerId !== requesterId) return { ok: false, error: 'NOT_HOST' };
    if (room.status !== 'WAITING') return { ok: false, error: 'INVALID_STATE' };
    const idx = room.players.findIndex((p) => p.playerId === playerId);
    if (idx === -1) return { ok: false, error: 'PLAYER_NOT_FOUND' };
    if (!room.players[idx]!.isBot) return { ok: false, error: 'NOT_A_BOT' };
    room.players.splice(idx, 1);
    // PlayerIds are stable (never renumbered), so sessions stay valid.
    return { ok: true, value: room };
  }

  /** Conditions for START_GAME. Human-vs-human is the primary path. */
  canStart(code: string, requesterId: string): RoomResult<Room> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.hostPlayerId !== requesterId) return { ok: false, error: 'NOT_HOST' };
    if (room.status !== 'WAITING') return { ok: false, error: 'INVALID_STATE' };
    const humans = room.players.filter((p) => !p.isBot);
    if (humans.length < 2) return { ok: false, error: 'INVALID_STATE' };
    if (room.players.length !== room.roomSize) return { ok: false, error: 'INVALID_STATE' };
    if (humans.some((p) => !p.ready)) return { ok: false, error: 'INVALID_STATE' };
    return { ok: true, value: room };
  }

  markGameStarted(code: string, gameId: string): void {
    const room = this.rooms.get(code);
    if (room) {
      room.status = 'IN_GAME';
      room.gameId = gameId;
    }
  }

  markGameFinished(code: string): void {
    const room = this.rooms.get(code);
    if (room) room.status = 'FINISHED';
  }

  setConnected(code: string, playerId: string, connected: boolean): void {
    const room = this.rooms.get(code);
    const player = room?.players.find((p) => p.playerId === playerId);
    if (player) {
      player.connected = connected;
      player.disconnectAt = connected ? null : Date.now();
      if (connected) player.aiTakeover = false;
    }
  }

  setAiTakeover(code: string, playerId: string, takeover: boolean): void {
    const room = this.rooms.get(code);
    const player = room?.players.find((p) => p.playerId === playerId);
    if (player) player.aiTakeover = takeover;
  }

  private nextColor(room: Room): PlayerColor {
    const used = new Set(room.players.map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? 'ember';
  }

  toView(room: Room): RoomView {
    return {
      code: room.code,
      status: room.status,
      roomSize: room.roomSize,
      players: room.players.map(
        (p): RoomPlayerView => ({
          playerId: p.playerId,
          name: p.name,
          color: p.color,
          ready: p.ready,
          isBot: p.isBot,
          connected: p.connected,
          isHost: p.playerId === room.hostPlayerId,
          ...(p.difficulty !== undefined ? { difficulty: p.difficulty } : {}),
          ...(p.personality !== undefined ? { personality: p.personality } : {}),
        }),
      ),
      hostPlayerId: room.hostPlayerId,
      gameId: room.gameId,
      createdAt: room.createdAt,
    };
  }
}
