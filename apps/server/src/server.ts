/**
 * IsleforgeServer — authoritative realtime multiplayer server.
 *
 * Architecture:
 *   WebSocket (ws) -> MessageRouter (this file) -> RoomManager / ServerGame
 *   The engine (@isleforge/game-engine) is the ONLY place game rules live.
 *   Browsers are untrusted: every inbound message is validated structurally
 *   (@isleforge/protocol) and semantically (engine dispatch).
 *
 * Per-connection state (Conn) is separate from game state. Player identity
 * always comes from the session, never from client-supplied playerIds.
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type RoomView,
  type ServerMessage,
} from '@isleforge/protocol';
import type { GameEvent, PlayerColor } from '@isleforge/game-engine';

import { RoomManager, type Room } from './rooms.js';
import { SessionManager, type PlayerSession } from './sessions.js';
import { RateLimiter, DEFAULT_LIMITS, type RateLimit } from './ratelimit.js';
import { ServerGame, maskEventForViewer, type AiSeatConfig } from './game.js';
import { AuthService, type AuthConfig } from './auth/service.js';
import { createAuthRouter } from './auth/http.js';
import { verifyAccessToken } from './auth/tokens.js';
import { getPool, migrate } from '@isleforge/db';
import type { Pool } from 'pg';

export interface ServerOptions {
  port: number;
  /** How long a disconnected player keeps their seat before AI takeover. */
  reconnectGraceMs?: number;
  /** WebSocket heartbeat interval. */
  heartbeatMs?: number;
  /** Override specific rate-limit categories (merged over defaults). */
  rateLimits?: Record<string, RateLimit>;
  /**
   * Auth configuration (M5). When omitted, the server runs without auth
   * (guest-only, M4 behavior). When provided, /auth/* is served and WS
   * AUTHENTICATE is accepted.
   */
  auth?: AuthConfig & {
    /** Run migrations on start. */
    autoMigrate?: boolean;
    /** Secure cookie flag (production https). */
    secureCookies?: boolean;
    /** Expose reset tokens in dev responses (no email provider). */
    devExposeResetTokens?: boolean;
  };
}

interface Conn {
  id: string;
  ws: WebSocket;
  sessionId: string | null;
  playerId: string | null;
  roomCode: string | null;
  /** Authenticated user id (M5). Null for guests / unauthenticated. */
  userId: string | null;
  /** Set when this connection was superseded by a RECONNECT (skip close logic). */
  replaced: boolean;
  alive: boolean;
  lastPongAt: number;
}

const DEFAULT_GRACE_MS = 120_000;
const HEARTBEAT_MS = 25_000;
const DEAD_CONN_MS = 60_000;

export class IsleforgeServer {
  readonly rooms = new RoomManager();
  readonly sessions = new SessionManager();
  private games = new Map<string, ServerGame>();
  private limiter = new RateLimiter();
  private conns = new Map<string, Conn>();
  /** roomCode:playerId -> Conn */
  private playerConns = new Map<string, Conn>();
  private graceTimers = new Map<string, NodeJS.Timeout>();
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly graceMs: number;
  private readonly heartbeatMs: number;
  private boundPort = 0;
  /** M5 auth. Null when the server runs without a database (guest-only). */
  private dbPool: Pool | null = null;
  private authService: AuthService | null = null;
  private authRouter: ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>) | null = null;
  private authSecret: string | null = null;

  constructor(private opts: ServerOptions) {
    this.graceMs = opts.reconnectGraceMs ?? DEFAULT_GRACE_MS;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    this.limiter = new RateLimiter({ ...DEFAULT_LIMITS, ...opts.rateLimits });
  }

  get port(): number {
    return this.boundPort;
  }

  /** For tests: the authoritative game of a room. */
  getGame(roomCode: string): ServerGame | undefined {
    return this.games.get(roomCode);
  }

  async start(): Promise<void> {
    // M5: optional auth. Needs DATABASE_URL (or equivalent PG* env).
    if (this.opts.auth) {
      const secret = this.opts.auth.accessTokenSecret;
      this.dbPool = getPool();
      if (this.opts.auth.autoMigrate !== false) {
        await migrate(this.dbPool);
      }
      this.authService = new AuthService(this.dbPool, this.opts.auth);
      this.authSecret = secret;
      const router = createAuthRouter(this.authService, secret, {
        secureCookies: this.opts.auth.secureCookies ?? false,
        devExposeResetTokens: this.opts.auth.devExposeResetTokens ?? false,
        checkRateLimit: (key, endpoint) =>
          this.limiter.check(key, `auth_${endpoint}`),
        clientKey: (req) => {
          const fwd = req.headers['x-forwarded-for'];
          const ip = (Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0])?.trim();
          return ip || req.socket.remoteAddress || 'unknown';
        },
      });
      this.authRouter = router;
    }

    this.http = createServer((req, res) => {
      if (this.authRouter) {
        // Auth routes are async; fire and let them respond.
        const router = this.authRouter;
        void router(req, res).then((handled) => {
          if (!handled) {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('isleforge multiplayer server\n');
          }
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('isleforge multiplayer server\n');
    });
    this.wss = new WebSocketServer({
      server: this.http,
      maxPayload: MAX_MESSAGE_BYTES + 1024,
    });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    await new Promise<void>((resolve) => {
      this.http!.listen(this.opts.port, () => {
        const addr = this.http!.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        resolve();
      });
    });
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const conn of this.conns.values()) {
      try {
        conn.ws.terminate();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    this.playerConns.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
    this.wss = null;
    this.http = null;
  }

  /* ---------------------------------------------------------------- */
  /* Connections                                                      */
  /* ---------------------------------------------------------------- */

  private onConnection(ws: WebSocket): void {
    const conn: Conn = {
      id: randomUUID(),
      ws,
      sessionId: null,
      playerId: null,
      roomCode: null,
      userId: null,
      replaced: false,
      alive: true,
      lastPongAt: Date.now(),
    };
    this.conns.set(conn.id, conn);
    ws.on('message', (data) => this.onMessage(conn, data as Buffer));
    ws.on('pong', () => {
      conn.alive = true;
      conn.lastPongAt = Date.now();
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => {
      /* close follows */
    });
  }

  private onMessage(conn: Conn, data: Buffer): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString('utf8'));
    } catch {
      this.sendError(conn, 'INVALID_MESSAGE', 'Message must be valid JSON.');
      return;
    }
    const res = parseClientMessage(parsed, data.length);
    if (!res.ok) {
      this.sendError(conn, res.code, res.message);
      return;
    }
    try {
      this.route(conn, res.message);
    } catch (e) {
      this.sendError(conn, 'INTERNAL_ERROR', 'Server error handling message.');
    }
  }

  private onClose(conn: Conn): void {
    this.conns.delete(conn.id);
    if (conn.replaced) return;
    const { roomCode, playerId } = conn;
    if (conn.sessionId && roomCode && playerId) {
      this.playerConns.delete(this.playerKey(roomCode, playerId));
    }
    if (!roomCode || !playerId) return;
    const room = this.rooms.getRoom(roomCode);
    if (!room || room.status === 'CLOSED') return;
    this.rooms.setConnected(roomCode, playerId, false);
    this.broadcastRoomState(roomCode);
    this.clearGraceTimer(roomCode, playerId);
    const timer = setTimeout(
      () => this.onGraceExpired(roomCode, playerId),
      this.graceMs,
    );
    timer.unref?.();
    this.graceTimers.set(this.graceKey(roomCode, playerId), timer);
  }

  private onGraceExpired(roomCode: string, playerId: string): void {
    this.graceTimers.delete(this.graceKey(roomCode, playerId));
    const room = this.rooms.getRoom(roomCode);
    const player = room?.players.find((p) => p.playerId === playerId);
    if (!room || !player || player.connected) return;
    if (room.status === 'WAITING') {
      // Lobby seats don't stall forever: free the seat after the grace period.
      this.detachSession(roomCode, playerId);
      this.rooms.leaveRoom(roomCode, playerId);
      const updated = this.rooms.getRoom(roomCode);
      if (updated) this.broadcastRoomState(roomCode);
      else this.sessions.revokeForRoom(roomCode);
      return;
    }
    if (room.status === 'IN_GAME') {
      // The game must not stall: a server AI pilots the seat until they return.
      // The takeover lives on the ServerGame so every AI cascade — including
      // the ones inside handleCommand — keeps the game moving.
      const game = this.games.get(roomCode);
      game?.setTakeover(playerId, { difficulty: 'normal', personality: 'balanced' });
      this.rooms.setAiTakeover(roomCode, playerId, true);
      this.broadcastRoomState(roomCode);
      this.pumpRoom(roomCode);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Heartbeat                                                        */
  /* ---------------------------------------------------------------- */

  private heartbeat(): void {
    const now = Date.now();
    for (const conn of this.conns.values()) {
      if (!conn.alive || now - conn.lastPongAt > DEAD_CONN_MS) {
        try {
          conn.ws.terminate();
        } catch {
          /* ignore */
        }
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        /* ignore */
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Message routing                                                  */
  /* ---------------------------------------------------------------- */

  private route(conn: Conn, msg: ClientMessage): void {
    switch (msg.type) {
      case 'CREATE_ROOM':
        this.onCreateRoom(conn, msg);
        break;
      case 'JOIN_ROOM':
        this.onJoinRoom(conn, msg);
        break;
      case 'RECONNECT':
        this.onReconnect(conn, msg);
        break;
      case 'LEAVE_ROOM':
        this.onLeaveRoom(conn, msg);
        break;
      case 'SET_READY':
        this.onSetReady(conn, msg);
        break;
      case 'ADD_AI':
        this.onAddAi(conn, msg);
        break;
      case 'REMOVE_AI':
        this.onRemoveAi(conn, msg);
        break;
      case 'START_GAME':
        this.onStartGame(conn, msg);
        break;
      case 'GAME_COMMAND':
        this.onGameCommand(conn, msg);
        break;
      case 'PING':
        this.send(conn, { v: 1, type: 'PONG', ts: msg.ts });
        break;
      case 'GAME_CHAT':
        this.onChat(conn, msg);
        break;
      case 'AUTHENTICATE':
        void this.onAuthenticate(conn, msg);
        break;
    }
  }

  /**
   * M5: bind an authenticated user id to this WebSocket connection.
   * The server verifies the access token itself — the client never asserts
   * its own user id.
   */
  private async onAuthenticate(
    conn: Conn,
    msg: Extract<ClientMessage, { type: 'AUTHENTICATE' }>,
  ): Promise<void> {
    if (!this.authService || !this.authSecret) {
      this.sendError(conn, 'INVALID_MESSAGE', 'Authentication is not enabled on this server.');
      return;
    }
    if (!this.limiter.check(conn.id, 'auth_ws')) {
      this.sendError(conn, 'RATE_LIMITED', 'Too many authentication attempts.');
      return;
    }
    const claims = verifyAccessToken(this.authSecret, msg.accessToken);
    if (!claims) {
      this.sendError(conn, 'INVALID_MESSAGE', 'Invalid or expired access token.');
      return;
    }
    const ok = await this.authService.verifyAccess(claims.sub, claims.sid);
    if (!ok) {
      this.sendError(conn, 'INVALID_MESSAGE', 'Session revoked or expired.');
      return;
    }
    conn.userId = claims.sub;
    this.send(conn, { v: 1, type: 'AUTHENTICATED', userId: claims.sub });
  }

  private requireSeat(conn: Conn): { room: Room; playerId: string } | null {
    if (!conn.roomCode || !conn.playerId || !conn.sessionId) {
      this.sendError(conn, 'NOT_IN_ROOM', 'Join a room first.');
      return null;
    }
    const session = this.sessions.get(conn.sessionId);
    if (!session || session.roomCode !== conn.roomCode || session.playerId !== conn.playerId) {
      this.sendError(conn, 'NOT_AUTHORIZED', 'Invalid session.');
      return null;
    }
    const room = this.rooms.getRoom(conn.roomCode);
    if (!room) {
      this.sendError(conn, 'ROOM_NOT_FOUND', 'Room no longer exists.');
      return null;
    }
    const player = room.players.find((p) => p.playerId === conn.playerId);
    if (!player) {
      this.sendError(conn, 'NOT_IN_ROOM', 'You are not in this room.');
      return null;
    }
    return { room, playerId: conn.playerId };
  }

  private onCreateRoom(conn: Conn, msg: Extract<ClientMessage, { type: 'CREATE_ROOM' }>): void {
    if (conn.roomCode) {
      this.sendError(conn, 'ALREADY_IN_ROOM', 'Leave your current room first.');
      return;
    }
    if (!this.limiter.check(conn.id, 'room_create')) {
      this.sendError(conn, 'RATE_LIMITED', 'Creating rooms too fast. Slow down.');
      return;
    }
    const { room, host } = this.rooms.createRoom(msg.name, msg.settings?.roomSize ?? 4);
    const session = this.sessions.create(host.playerId, room.code, conn.userId);
    this.attach(conn, room.code, host.playerId, session.sessionId);
    this.send(conn, {
      v: 1,
      type: 'ROOM_CREATED',
      room: this.rooms.toView(room),
      sessionId: session.sessionId,
      playerId: host.playerId,
    });
  }

  private onJoinRoom(conn: Conn, msg: Extract<ClientMessage, { type: 'JOIN_ROOM' }>): void {
    if (conn.roomCode) {
      this.sendError(conn, 'ALREADY_IN_ROOM', 'Leave your current room first.');
      return;
    }
    if (!this.limiter.check(conn.id, 'room_join')) {
      this.sendError(conn, 'RATE_LIMITED', 'Joining rooms too fast. Slow down.');
      return;
    }
    const res = this.rooms.joinRoom(msg.code, msg.name);
    if (!res.ok) {
      this.sendError(conn, this.mapRoomError(res.error), this.roomErrorText(res.error));
      return;
    }
    const { room, player } = res.value;
    const session = this.sessions.create(player.playerId, room.code, conn.userId);
    this.attach(conn, room.code, player.playerId, session.sessionId);
    this.send(conn, {
      v: 1,
      type: 'ROOM_CREATED',
      room: this.rooms.toView(room),
      sessionId: session.sessionId,
      playerId: player.playerId,
    });
    this.broadcast(room.code, {
      v: 1,
      type: 'PLAYER_JOINED',
      player: this.rooms.toView(room).players.find((p) => p.playerId === player.playerId)!,
    });
    this.broadcastRoomState(room.code);
  }

  private onReconnect(conn: Conn, msg: Extract<ClientMessage, { type: 'RECONNECT' }>): void {
    if (!this.limiter.check(msg.sessionId, 'reconnect')) {
      this.sendError(conn, 'RATE_LIMITED', 'Too many reconnect attempts.');
      return;
    }
    const fail = (message: string): void => {
      this.sendError(conn, 'RECONNECT_FAILED', message);
    };
    const session = this.sessions.get(msg.sessionId);
    if (!session) return fail('Session not found. The room may have closed.');
    const room = this.rooms.getRoom(session.roomCode);
    if (!room || room.status === 'CLOSED') {
      this.sessions.revoke(msg.sessionId);
      return fail('Room no longer exists.');
    }
    const player = room.players.find((p) => p.playerId === session.playerId);
    if (!player || player.isBot) return fail('Player not found in room.');

    // M5: an authenticated seat can only be reclaimed by the same user.
    // The client AUTHENTICATEs first; the server compares, never trusts.
    if (session.userId !== null && conn.userId !== session.userId) {
      return fail('This seat belongs to a different account. Authenticate as the seat owner first.');
    }
    // Bind the (possibly freshly authenticated) user to the connection.
    if (session.userId !== null) conn.userId = session.userId;

    // Supersede any stale connection for this seat.
    const old = this.playerConns.get(this.playerKey(room.code, player.playerId));
    if (old && old !== conn) {
      old.replaced = true;
      try {
        old.ws.terminate();
      } catch {
        /* ignore */
      }
      this.conns.delete(old.id);
    }
    this.clearGraceTimer(room.code, player.playerId);
    this.attach(conn, room.code, player.playerId, session.sessionId);
    this.rooms.setConnected(room.code, player.playerId, true);

    const game = this.games.get(room.code);
    if (game) {
      // A returning human takes their seat back from the server AI.
      game.setTakeover(player.playerId, null);
    }
    const missedEvents = game
      ? game.eventsAfter(msg.lastSeq ?? -1).map((e) => maskEventForViewer(e, player.playerId))
      : [];
    this.send(conn, {
      v: 1,
      type: 'RECONNECT_SUCCESS',
      playerId: player.playerId,
      room: this.rooms.toView(room),
      missedEvents,
    });
    if (game) {
      const snap = game.snapshotFor(player.playerId);
      this.send(conn, { v: 1, type: 'GAME_STATE', state: snap.state, lastSeq: snap.lastSeq });
    }
    this.broadcastRoomState(room.code);
  }

  private onLeaveRoom(conn: Conn, _msg: Extract<ClientMessage, { type: 'LEAVE_ROOM' }>): void {
    const seat = this.requireSeat(conn);
    if (!seat) return;
    const { room, playerId } = seat;
    this.detach(conn);
    this.detachSession(room.code, playerId);
    if (room.status === 'WAITING') {
      this.rooms.leaveRoom(room.code, playerId);
      const updated = this.rooms.getRoom(room.code);
      if (updated) {
        this.broadcast(updated.code, { v: 1, type: 'PLAYER_LEFT', playerId });
        this.broadcastRoomState(updated.code);
      } else {
        this.sessions.revokeForRoom(room.code);
      }
    } else {
      // Mid-game leave: keep the seat; treat like a disconnect (AI takeover
      // after the grace period so the game doesn't stall).
      this.rooms.setConnected(room.code, playerId, false);
      this.broadcastRoomState(room.code);
      this.clearGraceTimer(room.code, playerId);
      const timer = setTimeout(() => this.onGraceExpired(room.code, playerId), this.graceMs);
      timer.unref?.();
      this.graceTimers.set(this.graceKey(room.code, playerId), timer);
    }
  }

  private onSetReady(conn: Conn, msg: Extract<ClientMessage, { type: 'SET_READY' }>): void {
    const seat = this.requireSeat(conn);
    if (!seat) return;
    const res = this.rooms.setReady(seat.room.code, seat.playerId, msg.ready);
    if (!res.ok) {
      this.sendError(conn, this.mapRoomError(res.error), this.roomErrorText(res.error));
      return;
    }
    this.broadcastRoomState(seat.room.code);
  }

  private onAddAi(conn: Conn, msg: Extract<ClientMessage, { type: 'ADD_AI' }>): void {
    const seat = this.requireSeat(conn);
    if (!seat) return;
    const res = this.rooms.addAI(seat.room.code, seat.playerId, msg.difficulty, msg.personality);
    if (!res.ok) {
      this.sendError(conn, this.mapRoomError(res.error), this.roomErrorText(res.error));
      return;
    }
    this.broadcastRoomState(seat.room.code);
  }

  private onRemoveAi(conn: Conn, msg: Extract<ClientMessage, { type: 'REMOVE_AI' }>): void {
    const seat = this.requireSeat(conn);
    if (!seat) return;
    const res = this.rooms.removeAI(seat.room.code, seat.playerId, msg.playerId);
    if (!res.ok) {
      this.sendError(conn, this.mapRoomError(res.error), this.roomErrorText(res.error));
      return;
    }
    this.broadcastRoomState(seat.room.code);
  }

  private onStartGame(conn: Conn, _msg: Extract<ClientMessage, { type: 'START_GAME' }>): void {
    const seat = this.requireSeat(conn);
    if (!seat) return;
    const res = this.rooms.canStart(seat.room.code, seat.playerId);
    if (!res.ok) {
      this.sendError(
        conn,
        'INVALID_GAME_STATE',
        'Need 2+ humans, all ready, and every seat filled.',
      );
      return;
    }
    const room = res.value;
    const gameId = `g${randomBytes(8).toString('hex')}`;
    const aiSeats = new Map<string, AiSeatConfig>();
    for (const p of room.players) {
      if (p.isBot) {
        aiSeats.set(p.playerId, {
          difficulty: p.difficulty ?? 'normal',
          personality: p.personality ?? 'balanced',
        });
      }
    }
    const game = new ServerGame({
      gameId,
      players: room.players.map((p) => ({ id: p.playerId, name: p.name, color: p.color })),
      aiSeats,
      seed: Math.floor(Math.random() * 2 ** 31),
    });
    this.games.set(room.code, game);
    this.rooms.markGameStarted(room.code, gameId);

    for (const p of room.players) {
      if (p.isBot) continue;
      const target = this.playerConns.get(this.playerKey(room.code, p.playerId));
      if (!target) continue;
      this.send(target, { v: 1, type: 'GAME_STARTED', gameId, playerId: p.playerId });
    }
    // Genesis events (GAME_CREATED) so every client's stream starts at seq 0 —
    // required for gapless sequencing and replay reconstruction.
    this.broadcastEvents(room.code, game, game.eventsAfter(-1));
    this.snapshotToAll(room.code, game);
    // Opening AI moves (e.g. an AI places first in setup).
    const aiEvents = game.pumpAi();
    if (aiEvents.length > 0) {
      this.broadcastEvents(room.code, game, aiEvents);
      this.snapshotToAll(room.code, game);
    }
  }

  private onGameCommand(conn: Conn, msg: Extract<ClientMessage, { type: 'GAME_COMMAND' }>): void {
    const seat = this.requireSeat(conn);
    if (!seat) return;
    const { room, playerId } = seat;
    if (room.status !== 'IN_GAME') {
      this.sendError(conn, 'GAME_NOT_STARTED', 'The game has not started.', msg.commandId);
      return;
    }
    const game = this.games.get(room.code);
    if (!game) {
      this.sendError(conn, 'GAME_NOT_FOUND', 'Game not found.', msg.commandId);
      return;
    }
    if (!this.limiter.check(`${room.code}:${playerId}`, 'command')) {
      this.sendError(conn, 'RATE_LIMITED', 'Too many commands. Slow down.', msg.commandId);
      return;
    }
    const outcome = game.handleCommand(playerId, msg.commandId, msg.command);
    if (!outcome.ok) {
      this.sendError(conn, outcome.code, outcome.message, msg.commandId);
      return;
    }
    this.send(conn, { v: 1, type: 'COMMAND_ACCEPTED', commandId: msg.commandId, seqs: outcome.seqs });
    if (outcome.events.length > 0) {
      this.broadcastEvents(room.code, game, outcome.events);
    }
    this.snapshotToAll(room.code, game);
    if (outcome.ended) {
      this.rooms.markGameFinished(room.code);
      this.broadcast(room.code, {
        v: 1,
        type: 'GAME_ENDED',
        winnerId: outcome.winnerId,
        reason: 'victory',
      });
      this.broadcastRoomState(room.code);
    }
  }

  private onChat(conn: Conn, msg: Extract<ClientMessage, { type: 'GAME_CHAT' }>): void {
    const seat = this.requireSeat(conn);
    if (!seat) return;
    if (!this.limiter.check(`${seat.room.code}:${seat.playerId}`, 'chat')) {
      this.sendError(conn, 'RATE_LIMITED', 'Chatting too fast. Slow down.');
      return;
    }
    const player = seat.room.players.find((p) => p.playerId === seat.playerId)!;
    this.broadcast(seat.room.code, {
      v: 1,
      type: 'CHAT_MESSAGE',
      from: player.playerId,
      fromName: player.name,
      text: msg.text,
      ts: Date.now(),
    });
  }

  /* ---------------------------------------------------------------- */
  /* AI progress (takeover seats)                                     */
  /* ---------------------------------------------------------------- */

  /** Run server AI for bot seats and disconnected humans past their grace. */
  private pumpRoom(roomCode: string): void {
    const room = this.rooms.getRoom(roomCode);
    const game = this.games.get(roomCode);
    if (!room || !game || room.status !== 'IN_GAME' || game.isEnded()) return;
    // Takeover seats are registered on the ServerGame (setTakeover), so a
    // plain pumpAi covers configured AI seats and AI-piloted humans alike.
    const events = game.pumpAi();
    if (events.length > 0) {
      this.broadcastEvents(roomCode, game, events);
      this.snapshotToAll(roomCode, game);
      if (game.isEnded()) {
        this.rooms.markGameFinished(roomCode);
        this.broadcast(roomCode, {
          v: 1,
          type: 'GAME_ENDED',
          winnerId: game.getWinnerId(),
          reason: 'victory',
        });
        this.broadcastRoomState(roomCode);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Sending                                                          */
  /* ---------------------------------------------------------------- */

  private send(conn: Conn, msg: ServerMessage): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch {
      /* broken pipe — close handler will clean up */
    }
  }

  private sendError(conn: Conn, code: ErrorCode, message: string, commandId?: string): void {
    this.send(conn, {
      v: 1,
      type: 'ERROR',
      code,
      message,
      ...(commandId !== undefined ? { commandId } : {}),
    });
  }

  /** Broadcast to every connected human in the room. */
  private broadcast(roomCode: string, msg: ServerMessage, exceptPlayerId?: string): void {
    const room = this.rooms.getRoom(roomCode);
    if (!room) return;
    for (const p of room.players) {
      if (p.isBot || (exceptPlayerId !== undefined && p.playerId === exceptPlayerId)) continue;
      const target = this.playerConns.get(this.playerKey(roomCode, p.playerId));
      if (target) this.send(target, msg);
    }
  }

  /** Broadcast engine events, masked per viewer. */
  private broadcastEvents(roomCode: string, game: ServerGame, events: GameEvent[]): void {
    const room = this.rooms.getRoom(roomCode);
    if (!room) return;
    for (const p of room.players) {
      if (p.isBot) continue;
      const target = this.playerConns.get(this.playerKey(roomCode, p.playerId));
      if (!target) continue;
      for (const e of events) {
        this.send(target, {
          v: 1,
          type: 'GAME_EVENT',
          seq: e.seq,
          event: maskEventForViewer(e, p.playerId),
        });
      }
    }
  }

  /** Authoritative masked snapshot to every connected human. */
  private snapshotToAll(roomCode: string, game: ServerGame): void {
    const room = this.rooms.getRoom(roomCode);
    if (!room) return;
    for (const p of room.players) {
      if (p.isBot) continue;
      const target = this.playerConns.get(this.playerKey(roomCode, p.playerId));
      if (!target) continue;
      const snap = game.snapshotFor(p.playerId);
      this.send(target, { v: 1, type: 'GAME_STATE', state: snap.state, lastSeq: snap.lastSeq });
    }
  }

  private broadcastRoomState(roomCode: string): void {
    const room = this.rooms.getRoom(roomCode);
    if (!room) return;
    const view: RoomView = this.rooms.toView(room);
    this.broadcast(roomCode, { v: 1, type: 'ROOM_STATE', room: view });
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                          */
  /* ---------------------------------------------------------------- */

  private attach(conn: Conn, roomCode: string, playerId: string, sessionId: string): void {
    conn.roomCode = roomCode;
    conn.playerId = playerId;
    conn.sessionId = sessionId;
    this.playerConns.set(this.playerKey(roomCode, playerId), conn);
  }

  private detach(conn: Conn): void {
    if (conn.roomCode && conn.playerId) {
      this.playerConns.delete(this.playerKey(conn.roomCode, conn.playerId));
    }
    conn.roomCode = null;
    conn.playerId = null;
    conn.sessionId = null;
  }

  private detachSession(roomCode: string, playerId: string): void {
    this.sessions.revokeForPlayer(roomCode, playerId);
  }

  private playerKey(roomCode: string, playerId: string): string {
    return `${roomCode}:${playerId}`;
  }

  private graceKey(roomCode: string, playerId: string): string {
    return `${roomCode}:${playerId}`;
  }

  private clearGraceTimer(roomCode: string, playerId: string): void {
    const key = this.graceKey(roomCode, playerId);
    const t = this.graceTimers.get(key);
    if (t) {
      clearTimeout(t);
      this.graceTimers.delete(key);
    }
  }

  private mapRoomError(error: string): ErrorCode {
    switch (error) {
      case 'ROOM_NOT_FOUND':
        return 'ROOM_NOT_FOUND';
      case 'ROOM_CLOSED':
        return 'ROOM_CLOSED';
      case 'ROOM_FULL':
      case 'SEATS_FULL':
        return 'ROOM_FULL';
      case 'NAME_TAKEN':
        return 'NAME_TAKEN';
      case 'GAME_ALREADY_STARTED':
        return 'GAME_ALREADY_STARTED';
      case 'NOT_HOST':
        return 'NOT_HOST';
      case 'NOT_IN_ROOM':
        return 'NOT_IN_ROOM';
      case 'PLAYER_NOT_FOUND':
        return 'PLAYER_NOT_FOUND';
      default:
        return 'INVALID_MESSAGE';
    }
  }

  private roomErrorText(error: string): string {
    switch (error) {
      case 'ROOM_NOT_FOUND':
        return 'Room not found. Check the code.';
      case 'ROOM_CLOSED':
        return 'That room is closed.';
      case 'ROOM_FULL':
      case 'SEATS_FULL':
        return 'Room is full.';
      case 'NAME_TAKEN':
        return 'That name is taken in this room.';
      case 'GAME_ALREADY_STARTED':
        return 'The game already started.';
      case 'NOT_HOST':
        return 'Only the host can do that.';
      case 'NOT_IN_ROOM':
        return 'You are not in this room.';
      case 'PLAYER_NOT_FOUND':
        return 'Player not found.';
      default:
        return 'Invalid request.';
    }
  }
}
