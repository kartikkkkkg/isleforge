/**
 * Game history repositories: games, game_players, game_events, player_game_stats.
 *
 * The engine is authoritative — these only record outcomes the server derives
 * from engine state. All writes go through explicit transactions in the
 * service layer; repos stay single-statement.
 */
import type { Pool, PoolClient } from 'pg';

export type Db = Pool | PoolClient;

export interface GameRow {
  id: string;
  game_type: 'ONLINE' | 'LOCAL';
  game_mode: 'CASUAL' | 'RANKED' | 'RUSH' | 'CUSTOM';
  status: 'CREATED' | 'STARTED' | 'COMPLETED' | 'ABANDONED' | 'CANCELLED';
  map_id: string;
  player_count: number;
  started_at: Date | null;
  finished_at: Date | null;
  duration_seconds: number | null;
  winner_user_id: string | null;
  winner_player_id: string | null;
  created_at: Date;
}

export interface GamePlayerInput {
  seat: number;
  playerId: string;
  userId: string | null;
  displayNameSnapshot: string;
  playerColor: string;
  isAi: boolean;
  aiDifficulty?: string | null;
  aiPersonality?: string | null;
}

export interface GamePlayerRow extends GamePlayerInput {
  gameId: string;
  finishPosition: number | null;
  victoryPoints: number | null;
  won: boolean | null;
  joinedAt: Date;
  leftAt: Date | null;
}

export interface PersistedEvent {
  sequence: number;
  eventType: string;
  actorSeat: number | null;
  payload: unknown;
}

export interface PlayerGameStatsInput {
  userId: string;
  seat: number;
  vp: number;
  finishPosition: number;
  won: boolean;
  roadsBuilt: number;
  settlementsBuilt: number;
  citiesBuilt: number;
  devCardsBought: number;
  devCardsPlayed: number;
}

export class GamesRepo {
  constructor(private db: Db) {}

  async insertGame(input: {
    id: string;
    gameType: 'ONLINE' | 'LOCAL';
    gameMode?: 'CASUAL' | 'RANKED' | 'RUSH' | 'CUSTOM' | undefined;
    mapId?: string | undefined;
    playerCount: number;
    startedAt?: Date | null | undefined;
  }): Promise<GameRow> {
    const { rows } = await this.db.query<GameRow>(
      `INSERT INTO games (id, game_type, game_mode, status, map_id, player_count, started_at)
       VALUES ($1, $2, $3, 'STARTED', $4, $5, COALESCE($6, now()))
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [input.id, input.gameType, input.gameMode ?? 'CASUAL', input.mapId ?? 'archipelago', input.playerCount, input.startedAt ?? null],
    );
    if (rows[0]) return rows[0];
    // Already existed (idempotent start) — return the existing row.
    return (await this.findById(input.id))!;
  }

  async findById(id: string): Promise<GameRow | null> {
    const { rows } = await this.db.query<GameRow>(`SELECT * FROM games WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  /**
   * Idempotent completion: only transitions STARTED → COMPLETED. A second
   * call for the same game is a no-op (returns false).
   */
  async completeGame(input: {
    id: string;
    winnerUserId: string | null;
    winnerPlayerId: string | null;
    finishedAt: Date;
    durationSeconds: number;
  }): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE games
       SET status = 'COMPLETED', winner_user_id = $2, winner_player_id = $3,
           finished_at = $4, duration_seconds = $5
       WHERE id = $1 AND status = 'STARTED'`,
      [input.id, input.winnerUserId, input.winnerPlayerId, input.finishedAt, input.durationSeconds],
    );
    return (rowCount ?? 0) > 0;
  }

  async markAbandoned(id: string, finishedAt: Date): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE games SET status = 'ABANDONED', finished_at = $2
       WHERE id = $1 AND status IN ('CREATED','STARTED')`,
      [id, finishedAt],
    );
    return (rowCount ?? 0) > 0;
  }

  async insertPlayers(gameId: string, players: GamePlayerInput[]): Promise<void> {
    for (const p of players) {
      await this.db.query(
        `INSERT INTO game_players
           (game_id, seat, player_id, user_id, display_name_snapshot, player_color,
            is_ai, ai_difficulty, ai_personality)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (game_id, seat) DO NOTHING`,
        [gameId, p.seat, p.playerId, p.userId, p.displayNameSnapshot, p.playerColor,
         p.isAi, p.aiDifficulty ?? null, p.aiPersonality ?? null],
      );
    }
  }

  async finalizePlayers(
    gameId: string,
    results: { seat: number; finishPosition: number; victoryPoints: number; won: boolean }[],
  ): Promise<void> {
    for (const r of results) {
      await this.db.query(
        `UPDATE game_players
         SET finish_position = $3, victory_points = $4, won = $5
         WHERE game_id = $1 AND seat = $2`,
        [gameId, r.seat, r.finishPosition, r.victoryPoints, r.won],
      );
    }
  }

  async listPlayers(gameId: string): Promise<GamePlayerRow[]> {
    const { rows } = await this.db.query(
      `SELECT game_id AS "gameId", seat, player_id AS "playerId", user_id AS "userId",
              display_name_snapshot AS "displayNameSnapshot", player_color AS "playerColor",
              is_ai AS "isAi", ai_difficulty AS "aiDifficulty", ai_personality AS "aiPersonality",
              finish_position AS "finishPosition", victory_points AS "victoryPoints",
              won, joined_at AS "joinedAt", left_at AS "leftAt"
       FROM game_players WHERE game_id = $1 ORDER BY seat`,
      [gameId],
    );
    return rows as GamePlayerRow[];
  }

  async isParticipant(gameId: string, userId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM game_players WHERE game_id = $1 AND user_id = $2 LIMIT 1`,
      [gameId, userId],
    );
    return rows.length > 0;
  }

  /**
   * Cursor-paginated history for one user. Cursor = finished_at of the last
   * seen row (plus id tiebreak). Returns items + nextCursor + hasMore.
   */
  async listGamesForUser(
    userId: string,
    limit: number,
    before?: { finishedAt: Date; id: string },
  ): Promise<{ items: GameRow[]; nextCursor: string | null; hasMore: boolean }> {
    const lim = Math.min(Math.max(limit, 1), 100);
    const params: unknown[] = [userId];
    let where = `WHERE gp.user_id = $1 AND g.status = 'COMPLETED'`;
    if (before) {
      params.push(before.finishedAt, before.id);
      where += ` AND (g.finished_at, g.id) < ($2, $3)`;
    }
    params.push(lim + 1);
    const { rows } = await this.db.query<GameRow>(
      `SELECT g.* FROM games g
       JOIN game_players gp ON gp.game_id = g.id
       ${where}
       ORDER BY g.finished_at DESC, g.id DESC
       LIMIT $${params.length}`,
      params as (string | number | Date)[],
    );
    const hasMore = rows.length > lim;
    const items = rows.slice(0, lim);
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last?.finished_at
        ? Buffer.from(JSON.stringify({ f: last.finished_at.toISOString(), i: last.id })).toString('base64url')
        : null;
    return { items, nextCursor, hasMore };
  }

  async insertEvents(gameId: string, events: PersistedEvent[]): Promise<void> {
    for (const e of events) {
      await this.db.query(
        `INSERT INTO game_events (game_id, sequence, event_type, actor_seat, payload)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (game_id, sequence) DO NOTHING`,
        [gameId, e.sequence, e.eventType, e.actorSeat, JSON.stringify(e.payload)],
      );
    }
  }

  async listEvents(gameId: string, limit = 1000): Promise<PersistedEvent[]> {
    const { rows } = await this.db.query(
      `SELECT sequence, event_type AS "eventType", actor_seat AS "actorSeat", payload
       FROM game_events WHERE game_id = $1 ORDER BY sequence ASC LIMIT $2`,
      [gameId, Math.min(limit, 5000)],
    );
    return rows as PersistedEvent[];
  }

  async insertPlayerStats(gameId: string, stats: PlayerGameStatsInput[]): Promise<void> {
    for (const s of stats) {
      await this.db.query(
        `INSERT INTO player_game_stats
           (game_id, user_id, seat, vp, finish_position, won,
            roads_built, settlements_built, cities_built,
            dev_cards_bought, dev_cards_played)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (game_id, user_id) DO NOTHING`,
        [gameId, s.userId, s.seat, s.vp, s.finishPosition, s.won,
         s.roadsBuilt, s.settlementsBuilt, s.citiesBuilt,
         s.devCardsBought, s.devCardsPlayed],
      );
    }
  }

  /** Aggregates for one user, from COMPLETED games only. */
  async getStats(userId: string): Promise<{
    gamesPlayed: number;
    wins: number;
    losses: number;
    winRate: number;
    averageVp: number;
    averageFinish: number;
    bestVp: number;
    totalPlayTimeSeconds: number;
  }> {
    const { rows } = await this.db.query(
      `SELECT
         COUNT(*)::int AS games_played,
         COUNT(*) FILTER (WHERE s.won)::int AS wins,
         COUNT(*) FILTER (WHERE NOT s.won)::int AS losses,
         COALESCE(AVG(s.vp), 0)::float AS average_vp,
         COALESCE(AVG(s.finish_position), 0)::float AS average_finish,
         COALESCE(MAX(s.vp), 0)::int AS best_vp,
         COALESCE(SUM(g.duration_seconds), 0)::int AS total_play_time
       FROM player_game_stats s
       JOIN games g ON g.id = s.game_id
       WHERE s.user_id = $1 AND g.status = 'COMPLETED'`,
      [userId],
    );
    const r = rows[0] as {
      games_played: number; wins: number; losses: number;
      average_vp: number; average_finish: number; best_vp: number; total_play_time: number;
    };
    const gamesPlayed = r.games_played;
    return {
      gamesPlayed,
      wins: r.wins,
      losses: r.losses,
      winRate: gamesPlayed > 0 ? r.wins / gamesPlayed : 0,
      averageVp: gamesPlayed > 0 ? r.average_vp : 0,
      averageFinish: gamesPlayed > 0 ? r.average_finish : 0,
      bestVp: r.best_vp,
      totalPlayTimeSeconds: r.total_play_time,
    };
  }
}
