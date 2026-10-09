/**
 * M9 presence: server-authoritative, multi-tab correct.
 *
 *   OFFLINE — no active connections (after grace period)
 *   ONLINE  — at least one active connection
 *   IN_GAME — at least one connection is seated in a room with a live game
 *
 * Multiple tabs: the user stays ONLINE until the LAST connection closes.
 * A short grace period avoids flicker during reconnects.
 */

export type PresenceState = 'OFFLINE' | 'ONLINE' | 'IN_GAME';

export interface PresenceInfo {
  state: PresenceState;
  /** High-level activity, e.g. 'IN RANKED GAME'. Never carries room codes. */
  activity: string;
  /** Last time the user was seen connected (for "last seen"). */
  lastSeenAt: number;
}

const GRACE_MS = 15_000;

export class PresenceManager {
  /** userId -> set of connection ids. */
  private conns = new Map<string, Set<string>>();
  /** userId -> timer for offline grace. */
  private graceTimers = new Map<string, NodeJS.Timeout>();
  /** userId -> room code where they're in a live game (or null). */
  private inGame = new Map<string, string | null>();
  private listeners = new Set<(userId: string, info: PresenceInfo) => void>();

  /** Subscribe to presence changes (server fans out to authorized viewers). */
  onChange(fn: (userId: string, info: PresenceInfo) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(userId: string): void {
    const info = this.get(userId);
    for (const fn of this.listeners) {
      try {
        fn(userId, info);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  /** A connection authenticated as userId came up. */
  connect(userId: string, connId: string): void {
    const timer = this.graceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(userId);
    }
    let set = this.conns.get(userId);
    if (!set) {
      set = new Set();
      this.conns.set(userId, set);
    }
    const wasEmpty = set.size === 0;
    set.add(connId);
    if (wasEmpty) this.emit(userId);
  }

  /** A connection closed. OFFLINE only after the last one + grace. */
  disconnect(userId: string, connId: string): void {
    const set = this.conns.get(userId);
    if (!set) return;
    set.delete(connId);
    if (set.size > 0) return;
    this.conns.delete(userId);
    // Grace period: reconnects within GRACE_MS don't flicker to OFFLINE.
    const timer = setTimeout(() => {
      this.graceTimers.delete(userId);
      if (!this.conns.has(userId)) this.emit(userId);
    }, GRACE_MS);
    timer.unref?.();
    this.graceTimers.set(userId, timer);
  }

  /** Mark the user's game participation (called when games start/end). */
  setInGame(userId: string, gameKind: 'CASUAL' | 'RANKED' | 'PRIVATE' | null): void {
    const prev = this.inGame.get(userId) ?? null;
    const next = gameKind;
    if (prev === next) return;
    if (next === null) this.inGame.delete(userId);
    else this.inGame.set(userId, next);
    this.emit(userId);
  }

  get(userId: string): PresenceInfo {
    const connected = this.conns.has(userId);
    const game = this.inGame.get(userId);
    const now = Date.now();
    if (!connected) {
      return { state: 'OFFLINE', activity: 'OFFLINE', lastSeenAt: now };
    }
    if (game) {
      const activity =
        game === 'RANKED' ? 'IN RANKED GAME' : game === 'CASUAL' ? 'IN CASUAL GAME' : 'IN GAME';
      return { state: 'IN_GAME', activity, lastSeenAt: now };
    }
    return { state: 'ONLINE', activity: 'ONLINE', lastSeenAt: now };
  }

  /** For tests: clear all state. */
  reset(): void {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.conns.clear();
    this.inGame.clear();
  }
}
