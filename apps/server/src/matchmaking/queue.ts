/**
 * In-memory casual matchmaking queue (M7).
 *
 * Single-process: one matchmaking loop is authoritative. The interface is
 * designed so a Redis/distributed queue can replace this later.
 *
 * Fairness: players are considered oldest-first; each player matches within
 * a rating window that expands with wait time. Atomic formation: a player is
 * never in two matches.
 */

export interface QueueEntry {
  userId: string;
  rating: number;
  queuedAt: number;
  gameMode: 'CASUAL';
  /** Connection ids currently watching this queue entry (multi-tab). */
  connIds: Set<string>;
}

export interface MatchmakingConfig {
  /** Players per match (2-8). */
  matchSize: number;
  /** Rating window by wait time: [maxWaitMs, range]. */
  ratingWindows: [number, number][];
  /** How often the match loop runs. */
  tickMs: number;
}

export const DEFAULT_MATCHMAKING_CONFIG: MatchmakingConfig = {
  matchSize: 4,
  ratingWindows: [
    [30_000, 100],
    [60_000, 150],
    [120_000, 250],
    [Number.POSITIVE_INFINITY, 400],
  ],
  tickMs: 1000,
};

export interface FormedMatch {
  userIds: string[];
}

export class Matchmaker {
  private queue = new Map<string, QueueEntry>();
  private timer: NodeJS.Timeout | null = null;
  /** Recent match formation times for wait estimation. */
  private recentMatchTimes: number[] = [];

  constructor(
    private config: MatchmakingConfig = DEFAULT_MATCHMAKING_CONFIG,
    private onMatch: (match: FormedMatch) => void = () => {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.config.tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get size(): number {
    return this.queue.size;
  }

  /** Join the queue. Returns false if already queued (ALREADY_QUEUED). */
  join(entry: Omit<QueueEntry, 'connIds'> & { connId: string }): boolean {
    const existing = this.queue.get(entry.userId);
    if (existing) {
      existing.connIds.add(entry.connId);
      return false;
    }
    this.queue.set(entry.userId, { ...entry, connIds: new Set([entry.connId]) });
    return true;
  }

  /** Leave the queue. Returns true if an entry was removed. */
  leave(userId: string, connId?: string): boolean {
    const existing = this.queue.get(userId);
    if (!existing) return false;
    if (connId) {
      existing.connIds.delete(connId);
      // Only remove when the last watching connection leaves.
      if (existing.connIds.size > 0) return false;
    }
    this.queue.delete(userId);
    return true;
  }

  /** Remove unconditionally (disconnect cleanup). */
  remove(userId: string): boolean {
    return this.queue.delete(userId);
  }

  getEntry(userId: string): QueueEntry | undefined {
    return this.queue.get(userId);
  }

  /** Rating window for a wait time in ms. */
  ratingRange(waitMs: number): number {
    for (const [maxWait, range] of this.config.ratingWindows) {
      if (waitMs <= maxWait) return range;
    }
    return this.config.ratingWindows[this.config.ratingWindows.length - 1]![1];
  }

  /** Estimated wait: heuristic from queue size and recent match times. */
  estimatedWaitMs(): number {
    const avgMatchMs =
      this.recentMatchTimes.length > 0
        ? this.recentMatchTimes.reduce((a, b) => a + b, 0) / this.recentMatchTimes.length
        : 20_000;
    const batches = Math.ceil(this.queue.size / this.config.matchSize);
    return Math.round(Math.min(batches * avgMatchMs * 0.5, 120_000) / 5000) * 5000;
  }

  /** One matchmaking tick: form as many matches as possible. */
  tick(now = Date.now()): FormedMatch[] {
    const formed: FormedMatch[] = [];
    // Oldest-first for fairness.
    const entries = [...this.queue.values()].sort((a, b) => a.queuedAt - b.queuedAt);
    const used = new Set<string>();

    for (const entry of entries) {
      if (used.has(entry.userId)) continue;
      const group = this.findGroup(entry, entries, used, now);
      if (group.length === this.config.matchSize) {
        for (const u of group) {
          used.add(u.userId);
          this.queue.delete(u.userId);
        }
        const match: FormedMatch = { userIds: group.map((g) => g.userId) };
        formed.push(match);
        this.recentMatchTimes.push(now - entry.queuedAt);
        if (this.recentMatchTimes.length > 20) this.recentMatchTimes.shift();
      }
    }

    for (const m of formed) this.onMatch(m);
    return formed;
  }

  /**
   * Find a compatible group for `entry`. Candidates must be within the
   * *mutual* rating window (both players' ranges), preferring closest rating
   * among those waiting longest.
   */
  private findGroup(
    entry: QueueEntry,
    entries: QueueEntry[],
    used: Set<string>,
    now: number,
  ): QueueEntry[] {
    const group: QueueEntry[] = [entry];
    const entryRange = this.ratingRange(now - entry.queuedAt);

    // Candidates sorted by wait time (oldest first), then rating proximity.
    const candidates = entries
      .filter((e) => e.userId !== entry.userId && !used.has(e.userId))
      .filter((e) => {
        const range = this.ratingRange(now - e.queuedAt);
        const diff = Math.abs(e.rating - entry.rating);
        return diff <= entryRange && diff <= range;
      })
      .sort((a, b) => a.queuedAt - b.queuedAt || Math.abs(a.rating - entry.rating) - Math.abs(b.rating - entry.rating));

    for (const c of candidates) {
      if (group.length >= this.config.matchSize) break;
      // Ensure the candidate is compatible with everyone already in the group.
      const ok = group.every((g) => {
        const gr = this.ratingRange(now - g.queuedAt);
        const cr = this.ratingRange(now - c.queuedAt);
        const diff = Math.abs(g.rating - c.rating);
        return diff <= gr && diff <= cr;
      });
      if (ok) group.push(c);
    }
    return group;
  }
}
