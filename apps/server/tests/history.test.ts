/**
 * Game history API tests (§31, §33): GET /games, /games/:id, /games/:id/events,
 * /me/stats — pagination, authorization, security.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GamesRepo } from '@isleforge/db';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';

async function seedGame(ctx: AuthTestContext, userId: string, gameId: string, won: boolean) {
  const games = new GamesRepo(ctx.pool);
  await games.insertGame({ id: gameId, gameType: 'ONLINE', playerCount: 2 });
  await games.insertPlayers(gameId, [
    { seat: 0, playerId: 'p1', userId, displayNameSnapshot: 'Alice', playerColor: 'red', isAi: false },
    { seat: 1, playerId: 'p2', userId: null, displayNameSnapshot: 'Bot', playerColor: 'blue', isAi: true, aiDifficulty: 'normal' },
  ]);
  await games.completeGame({
    id: gameId,
    winnerUserId: won ? userId : null,
    winnerPlayerId: won ? 'p1' : 'p2',
    finishedAt: new Date(),
    durationSeconds: 300,
  });
  await games.insertPlayerStats(gameId, [
    { userId, seat: 0, vp: won ? 10 : 7, finishPosition: won ? 1 : 2, won, roadsBuilt: 3, settlementsBuilt: 3, citiesBuilt: 0, devCardsBought: 1, devCardsPlayed: 0 },
  ]);
  await games.insertEvents(gameId, [
    { sequence: 0, eventType: 'GAME_CREATED', actorSeat: null, payload: {} },
    { sequence: 1, eventType: 'GAME_ENDED', actorSeat: null, payload: {} },
  ]);
}

describe('game history API', () => {
  let ctx: AuthTestContext;
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;

  beforeAll(async () => {
    ctx = await setupAuthTest();
    const http = new HttpClient(ctx.baseUrl);
    const mk = async (email: string, username: string) => {
      await http.post('/auth/register', { email, username, password: 'Str0ng!Pass123' });
      const l = await http.post('/auth/login', { login: username, password: 'Str0ng!Pass123' });
      const body = l.body as { accessToken: string; user: { id: string } };
      return { token: body.accessToken, userId: body.user.id };
    };
    const alice = await mk('alice@example.com', 'alice');
    aliceToken = alice.token;
    aliceId = alice.userId;
    const bob = await mk('bob@example.com', 'bob');
    bobToken = bob.token;

    await seedGame(ctx, aliceId, 'hist-game-1', true);
    await seedGame(ctx, aliceId, 'hist-game-2', false);
    await seedGame(ctx, aliceId, 'hist-game-3', true);
  }, 120000);

  afterAll(async () => {
    await teardownAuthTest(ctx);
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('requires authentication', async () => {
    const http = new HttpClient(ctx.baseUrl);
    expect((await http.get('/games')).status).toBe(401);
    expect((await http.get('/me/stats')).status).toBe(401);
  });

  it('lists own games with cursor pagination', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const p1 = await http.get('/games?limit=2', auth(aliceToken));
    expect(p1.status).toBe(200);
    const b1 = p1.body as { items: unknown[]; nextCursor: string | null; hasMore: boolean };
    expect(b1.items).toHaveLength(2);
    expect(b1.hasMore).toBe(true);
    expect(b1.nextCursor).not.toBeNull();

    const p2 = await http.get(`/games?limit=2&before=${encodeURIComponent(b1.nextCursor!)}`, auth(aliceToken));
    const b2 = p2.body as { items: unknown[]; hasMore: boolean };
    expect(b2.items).toHaveLength(1);
    expect(b2.hasMore).toBe(false);
  });

  it('rejects invalid cursors and clamps limits', async () => {
    const http = new HttpClient(ctx.baseUrl);
    expect((await http.get('/games?before=!!!', auth(aliceToken))).status).toBe(400);
    const r = await http.get('/games?limit=99999', auth(aliceToken));
    expect(r.status).toBe(200);
    expect((r.body as { items: unknown[] }).items.length).toBeLessThanOrEqual(100);
  });

  it('returns game detail for participants only', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const ok = await http.get('/games/hist-game-1', auth(aliceToken));
    expect(ok.status).toBe(200);
    const body = ok.body as { game: { id: string }; players: { displayName: string; isAi: boolean }[] };
    expect(body.game.id).toBe('hist-game-1');
    expect(body.players).toHaveLength(2);
    expect(body.players[0]!.displayName).toBe('Alice');
    expect(body.players[1]!.isAi).toBe(true);

    // Bob is not a participant → 404 (not 403; don't reveal existence).
    expect((await http.get('/games/hist-game-1', auth(bobToken))).status).toBe(404);
    expect((await http.get('/games/nope', auth(aliceToken))).status).toBe(404);
  });

  it('returns ordered events for participants only', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const ok = await http.get('/games/hist-game-1/events', auth(aliceToken));
    expect(ok.status).toBe(200);
    const events = (ok.body as { events: { sequence: number }[] }).events;
    expect(events.map((e) => e.sequence)).toEqual([0, 1]);
    expect((await http.get('/games/hist-game-1/events', auth(bobToken))).status).toBe(404);
  });

  it('returns statistics', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.get('/me/stats', auth(aliceToken));
    expect(r.status).toBe(200);
    const s = (r.body as { stats: Record<string, number> }).stats;
    expect(s.gamesPlayed).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 4);
  });

  it('resists SQL injection in game ids', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.get("/games/' OR '1'='1", auth(aliceToken));
    expect([400, 404]).toContain(r.status);
    const { rows } = await ctx.pool.query('SELECT COUNT(*)::int AS n FROM games');
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
