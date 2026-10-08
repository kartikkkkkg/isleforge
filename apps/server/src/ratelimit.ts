/**
 * Fixed-window rate limiter, keyed per (category, key).
 * Protects room creation/joining, commands, chat, and reconnect attempts
 * from flooding. Limits are intentionally modest for Milestone 4.
 */

export interface RateLimit {
  windowMs: number;
  max: number;
}

export const DEFAULT_LIMITS: Record<string, RateLimit> = {
  /** Room creation per connection. */
  room_create: { windowMs: 60_000, max: 5 },
  /** Room joining per connection. */
  room_join: { windowMs: 60_000, max: 10 },
  /** Game commands per player. */
  command: { windowMs: 10_000, max: 40 },
  /** Chat messages per player. */
  chat: { windowMs: 10_000, max: 5 },
  /** Reconnect attempts per session id. */
  reconnect: { windowMs: 60_000, max: 10 },
};

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private limits: Record<string, RateLimit> = DEFAULT_LIMITS) {}

  /** Returns true when the hit is allowed (and records it). */
  check(key: string, category: string): boolean {
    const limit = this.limits[category];
    if (!limit) return true;
    const now = Date.now();
    const mapKey = `${category}:${key}`;
    const windowStart = now - limit.windowMs;
    const existing = this.hits.get(mapKey) ?? [];
    const fresh = existing.filter((t) => t > windowStart);
    if (fresh.length >= limit.max) {
      this.hits.set(mapKey, fresh);
      return false;
    }
    fresh.push(now);
    this.hits.set(mapKey, fresh);
    return true;
  }
}
