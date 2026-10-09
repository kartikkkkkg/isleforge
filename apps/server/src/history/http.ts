/**
 * Game history HTTP API (M6).
 *
 *   GET /games?limit=20&before=<cursor>   — own completed games, cursor-paginated
 *   GET /games/:gameId                    — game detail (participants only)
 *   GET /games/:gameId/events             — ordered engine events (participants only)
 *   GET /me/stats                         — own statistics
 *
 * Authorization: every route requires a Bearer access token; users can only
 * see games they participated in. Never rely on UI hiding.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GameRecorder } from './recorder.js';
import type { GameRow, GamePlayerRow, PersistedEvent, RatingsRepo } from '@isleforge/db';

async function getLeaderboard(
  deps: HistoryRouterDeps,
  userId: string,
  limit: number,
  before: string | null,
): Promise<{
  rows: unknown[];
  nextCursor: string | null;
  personalPosition: { position: number; rating: number } | null;
}> {
  const { rows, nextCursor } = await deps.ratings!.leaderboard(limit, before);
  const position = await deps.ratings!.rankPosition(userId);
  const me = await deps.ratings!.get(userId);
  // Attach rank tiers (derived, not stored).
  const { rankFor, rankName } = await import('../rating/rank.js');
  const withRanks = rows.map((r: { rating: number; gamesRated: number }) => {
    const rank = rankFor(r.rating, r.gamesRated);
    return { ...r, rankName: rankName(rank), tier: rank.tier };
  });
  return {
    rows: withRanks,
    nextCursor,
    personalPosition: position != null && me ? { position, rating: me.rating } : null,
  };
}

export interface HistoryRouterDeps {
  recorder: GameRecorder;
  ratings: RatingsRepo | null;
  verifyToken: (token: string) => { userId: string } | null;
  checkRateLimit: (key: string) => boolean;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function bearerUserId(req: IncomingMessage, verify: HistoryRouterDeps['verifyToken']): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const payload = verify(h.slice(7));
  return payload?.userId ?? null;
}

function parseCursor(before: string | null): { finishedAt: Date; id: string } | null {
  if (!before) return null;
  try {
    const c = JSON.parse(Buffer.from(before, 'base64url').toString('utf8')) as { f: string; i: string };
    if (typeof c.f !== 'string' || typeof c.i !== 'string') return null;
    return { finishedAt: new Date(c.f), id: c.i };
  } catch {
    return null;
  }
}

export function createHistoryRouter(deps: HistoryRouterDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const params = url.searchParams;
    if (req.method !== 'GET') return false;
    if (!path.startsWith('/games') && path !== '/me/stats' && path !== '/me/rating' && path !== '/me/rating-history' && path !== '/leaderboard') return false;

    const userId = bearerUserId(req, deps.verifyToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!deps.checkRateLimit(`history:${userId}`)) {
      json(res, 429, { error: 'RATE_LIMITED' });
      return true;
    }

    const games = deps.recorder.games;

    // GET /me/stats
    if (path === '/me/stats') {
      const stats = await games.getStats(userId);
      json(res, 200, { stats });
      return true;
    }

    // GET /me/rating — current MMR (labeled MMR, not Rank).
    if (path === '/me/rating') {
      if (!deps.ratings) {
        json(res, 503, { error: 'RATINGS_UNAVAILABLE' });
        return true;
      }
      const row = await deps.ratings.ensure(userId);
      const { rankFor, rankName } = await import('../rating/rank.js');
      const rank = rankFor(row.rating, row.games_rated);
      json(res, 200, {
        rating: row.rating,
        gamesRated: row.games_rated,
        wins: row.wins,
        rank: {
          tier: rank.tier,
          division: rank.division,
          name: rankName(rank),
          provisional: rank.provisional,
          progress: rank.progress,
          nextThreshold: rank.nextThreshold,
        },
      });
      return true;
    }

    // GET /me/rating-history
    if (path === '/me/rating-history') {
      if (!deps.ratings) {
        json(res, 503, { error: 'RATINGS_UNAVAILABLE' });
        return true;
      }
      const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '20', 10) || 20, 1), 100);
      const history = await deps.ratings.historyForUser(userId, limit);
      json(res, 200, { history });
      return true;
    }

    // GET /leaderboard?limit=50&before=<cursor>
    if (path === '/leaderboard') {
      if (!deps.ratings) {
        json(res, 503, { error: 'RATINGS_UNAVAILABLE' });
        return true;
      }
      const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '50', 10) || 50, 1), 100);
      const before = params.get('before');
      try {
        const { rows, nextCursor, personalPosition } = await getLeaderboard(
          deps,
          userId,
          limit,
          before,
        );
        json(res, 200, { leaderboard: rows, nextCursor, personalPosition });
      } catch (e) {
        if ((e as Error).message === 'INVALID_CURSOR') {
          json(res, 400, { error: 'INVALID_CURSOR' });
        } else {
          throw e;
        }
      }
      return true;
    }

    // GET /games?limit=&before=
    if (path === '/games') {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100);
      const before = parseCursor(url.searchParams.get('before'));
      if (url.searchParams.get('before') && !before) {
        json(res, 400, { error: 'INVALID_CURSOR' });
        return true;
      }
      const { items, nextCursor, hasMore } = await games.listGamesForUser(userId, limit, before ?? undefined);
      json(res, 200, {
        items: items.map((g: GameRow) => ({
          id: g.id,
          gameType: g.game_type,
          gameMode: g.game_mode,
          status: g.status,
          mapId: g.map_id,
          playerCount: g.player_count,
          startedAt: g.started_at?.toISOString() ?? null,
          finishedAt: g.finished_at?.toISOString() ?? null,
          durationSeconds: g.duration_seconds,
          winnerUserId: g.winner_user_id,
          matchType: g.match_type,
        })),
        nextCursor,
        hasMore,
      });
      return true;
    }

    // GET /games/:id  and  GET /games/:id/events
    const m = /^\/games\/([A-Za-z0-9_-]+)(\/events)?$/.exec(path);
    if (!m) {
      // Malformed game id path — 404, never fall through to the banner.
      json(res, 404, { error: 'GAME_NOT_FOUND' });
      return true;
    }
    const gameId = m[1]!;
    const wantEvents = !!m[2];

    const game = await games.findById(gameId);
    if (!game) {
      json(res, 404, { error: 'GAME_NOT_FOUND' });
      return true;
    }
    if (!(await games.isParticipant(gameId, userId))) {
      // Same 404 — do not reveal that the game exists.
      json(res, 404, { error: 'GAME_NOT_FOUND' });
      return true;
    }

    if (wantEvents) {
      const events = await games.listEvents(gameId);
      json(res, 200, {
        gameId,
        events: events.map((e: PersistedEvent) => ({
          sequence: e.sequence,
          eventType: e.eventType,
          actorSeat: e.actorSeat,
          payload: e.payload,
        })),
      });
      return true;
    }

    const players = await games.listPlayers(gameId);
    json(res, 200, {
      game: {
        id: game.id,
        gameType: game.game_type,
        gameMode: game.game_mode,
        status: game.status,
        mapId: game.map_id,
        playerCount: game.player_count,
        startedAt: game.started_at?.toISOString() ?? null,
        finishedAt: game.finished_at?.toISOString() ?? null,
        durationSeconds: game.duration_seconds,
        winnerUserId: game.winner_user_id,
        winnerPlayerId: game.winner_player_id,
        matchType: game.match_type,
      },
      players: players.map((p: GamePlayerRow) => ({
        seat: p.seat,
        playerId: p.playerId,
        userId: p.userId,
        displayName: p.displayNameSnapshot,
        playerColor: p.playerColor,
        isAi: p.isAi,
        aiDifficulty: p.aiDifficulty,
        aiPersonality: p.aiPersonality,
        finishPosition: p.finishPosition,
        victoryPoints: p.victoryPoints,
        won: p.won,
      })),
    });
    return true;
  };
}
