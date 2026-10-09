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
}
