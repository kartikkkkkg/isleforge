/**
 * PlayerSessionManager — session credentials that survive disconnects.
 *
 * A session binds (sessionId) -> (roomCode, playerId). It is issued on
 * CREATE_ROOM / JOIN_ROOM and presented on RECONNECT. Sessions are revoked
 * when the player leaves the room or the room closes.
 *
 * The server never trusts a client-supplied playerId: after RECONNECT, the
 * playerId comes from the session, not from the message.
 */

import { randomUUID } from 'node:crypto';

export interface PlayerSession {
  sessionId: string;
  playerId: string;
  roomCode: string;
  createdAt: number;
}

export class SessionManager {
  private sessions = new Map<string, PlayerSession>();

  create(playerId: string, roomCode: string): PlayerSession {
    const session: PlayerSession = {
      sessionId: randomUUID(),
      playerId,
      roomCode,
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): PlayerSession | undefined {
    return this.sessions.get(sessionId);
  }

  revoke(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  revokeForRoom(roomCode: string): void {
    for (const [id, s] of this.sessions) {
      if (s.roomCode === roomCode) this.sessions.delete(id);
    }
  }

  revokeForPlayer(roomCode: string, playerId: string): void {
    for (const [id, s] of this.sessions) {
      if (s.roomCode === roomCode && s.playerId === playerId) {
        this.sessions.delete(id);
      }
    }
  }
}
