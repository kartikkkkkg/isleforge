/**
 * Player ratings repository. The Elo math lives in the server; this owns
 * persistence. Rating updates are transactional and idempotent per game.
 */
import type { Pool, PoolClient } from 'pg';

export type Db = Pool | PoolClient;

export interface RatingRow {
  user_id: string;
  rating: number;
  games_rated: number;
  wins: number;
  losses: number;
  updated_at: Date;
}

export interface RatingResultInput {
  userId: string;
  placement: number;
  won: boolean;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  opponentAverageRating: number;
}

export const INITIAL_RATING = 1000;
export const RATING_FLOOR = 100;

export class RatingsRepo {
  constructor(private db: Db) {}

  /** Get or create the rating row (new players start at 1000). */
  async ensure(userId: string): Promise<RatingRow> {
    const { rows } = await this.db.query<RatingRow>(
      `INSERT INTO player_ratings (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
      [userId],
    );
    if (rows[0]) return rows[0];
    const existing = await this.db.query<RatingRow>(
      `SELECT * FROM player_ratings WHERE user_id = $1`,
      [userId],
    );
    return existing.rows[0]!;
  }

  async get(userId: string): Promise<RatingRow | null> {
    const { rows } = await this.db.query<RatingRow>(
      `SELECT * FROM player_ratings WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Apply one game's rating changes. Idempotent: if this game was already
   * rated for a user (UNIQUE user_id+game_id), that user is skipped.
   * Must be called inside a transaction with the caller's game persistence.
   */
  async applyGameResults(gameId: string, results: RatingResultInput[]): Promise<boolean[]> {
    const applied: boolean[] = [];
    for (const r of results) {
      // Idempotency check first.
      const seen = await this.db.query(
        `SELECT 1 FROM rating_history WHERE user_id = $1 AND game_id = $2`,
        [r.userId, gameId],
      );
      if (seen.rows.length > 0) {
        applied.push(false);
        continue;
      }
      const ratingAfter = Math.max(RATING_FLOOR, r.ratingAfter);
      await this.db.query(
        `UPDATE player_ratings
         SET rating = $2, games_rated = games_rated + 1,
             wins = wins + $3, losses = losses + $4, updated_at = now()
         WHERE user_id = $1`,
        [r.userId, ratingAfter, r.won ? 1 : 0, r.won ? 0 : 1],
      );
      await this.db.query(
        `INSERT INTO rating_history
           (user_id, game_id, rating_before, rating_after, rating_delta,
            placement, opponent_average_rating)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, game_id) DO NOTHING`,
        [r.userId, gameId, r.ratingBefore, ratingAfter, ratingAfter - r.ratingBefore,
         r.placement, r.opponentAverageRating],
      );
      applied.push(true);
    }
    return applied;
  }

  async historyForUser(userId: string, limit = 50): Promise<unknown[]> {
    const { rows } = await this.db.query(
      `SELECT game_id, rating_before, rating_after, rating_delta, placement,
              opponent_average_rating, created_at
       FROM rating_history WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(limit, 100)],
    );
    return rows;
  }

  /**
   * Global ranked leaderboard: rating DESC, gamesRated DESC, user_id ASC.
   * Cursor is base64url { rating, gamesRated, userId }.
   */
  async leaderboard(limit: number, before?: string | null): Promise<{
    rows: {
      userId: string;
      username: string;
      displayName: string;
      avatarId: string;
      rating: number;
      gamesRated: number;
      wins: number;
    }[];
    nextCursor: string | null;
  }> {
    let cursor: { rating: number; gamesRated: number; userId: string } | null = null;
    if (before) {
      try {
        cursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
      } catch {
        throw new Error('INVALID_CURSOR');
      }
      if (
        typeof cursor?.rating !== 'number' ||
        typeof cursor?.gamesRated !== 'number' ||
        typeof cursor?.userId !== 'string'
      ) {
        throw new Error('INVALID_CURSOR');
      }
    }

    const params: unknown[] = [limit + 1];
    let where = '';
    if (cursor) {
      where = `WHERE (pr.rating, pr.games_rated, pr.user_id) < ($2, $3, $4)`;
      params.push(cursor.rating, cursor.gamesRated, cursor.userId);
    }
    const { rows } = await this.db.query(
      `SELECT pr.user_id AS "userId", u.username, p.display_name AS "displayName",
              p.avatar_id AS "avatarId", pr.rating, pr.games_rated AS "gamesRated",
              pr.wins
       FROM player_ratings pr
       JOIN users u ON u.id = pr.user_id
       JOIN account_profiles p ON p.user_id = pr.user_id
       ${where}
       ORDER BY pr.rating DESC, pr.games_rated DESC, pr.user_id ASC
       LIMIT $1`,
      params,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(
          JSON.stringify({ rating: last.rating, gamesRated: last.gamesRated, userId: last.userId }),
        ).toString('base64url')
      : null;
    return { rows: page, nextCursor };
  }

  /** 1-based rank position of a user (efficient COUNT query). */
  async rankPosition(userId: string): Promise<number | null> {
    const me = await this.get(userId);
    if (!me) return null;
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM player_ratings
       WHERE (rating, games_rated, user_id) > ($1, $2, $3)`,
      [me.rating, me.games_rated, userId],
    );
    return rows[0].n + 1;
  }
}
