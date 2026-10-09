/**
 * M8 leaderboard tests: ordering, pagination, personal position, privacy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';
import { RatingsRepo } from '@isleforge/db';

describe('leaderboard', () => {
  let ctx: AuthTestContext;
  const tokens: string[] = [];

  beforeAll(async () => {
    ctx = await setupAuthTest();
    const http = new HttpClient(ctx.baseUrl);
    // Create 5 users with different ratings.
    const ratings = [1500, 1200, 1800, 1000, 1350];
    for (let i = 0; i < 5; i++) {
      await http.post('/auth/register', {
        email: `lb${i}@example.com`,
        username: `lbuser${i}`,
        password: 'Str0ng!Pass123',
      });
      const l = await http.post('/auth/login', { login: `lbuser${i}`, password: 'Str0ng!Pass123' });
      tokens.push((l.body as { accessToken: string }).accessToken);
      // Set rating directly.
      const me = await http.get('/auth/me', { Authorization: `Bearer ${tokens[i]}` });
      const userId = (me.body as { user: { id: string } }).user.id;
      await ctx.pool.query(`INSERT INTO player_ratings (user_id, rating, games_rated) VALUES ($1, $2, 20) ON CONFLICT (user_id) DO UPDATE SET rating = $2, games_rated = 20`, [userId, ratings[i]]);
    }
  }, 120000);

  afterAll(async () => {
    await teardownAuthTest(ctx);
  });

  function auth(i: number) {
    return { Authorization: `Bearer ${tokens[i]}` };
  }

  it('returns leaderboard ordered by rating DESC', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.get('/leaderboard?limit=50', auth(0));
    expect(r.status).toBe(200);
    const body = r.body as { leaderboard: { rating: number }[] };
    const ratings = body.leaderboard.map((e) => e.rating);
    expect(ratings).toEqual([1800, 1500, 1350, 1200, 1000]);
  });

  it('paginates with cursor', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r1 = await http.get('/leaderboard?limit=2', auth(0));
    const b1 = r1.body as { leaderboard: unknown[]; nextCursor: string | null };
    expect(b1.leaderboard).toHaveLength(2);
    expect(b1.nextCursor).not.toBeNull();

    const r2 = await http.get(`/leaderboard?limit=2&before=${b1.nextCursor}`, auth(0));
    const b2 = r2.body as { leaderboard: { rating: number }[] };
    expect(b2.leaderboard).toHaveLength(2);
    expect(b2.leaderboard[0]!.rating).toBe(1350);
  });

  it('includes personal position', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.get('/leaderboard?limit=50', auth(3)); // 1000 rating = #5
    const body = r.body as { personalPosition: { position: number; rating: number } };
    expect(body.personalPosition.position).toBe(5);
    expect(body.personalPosition.rating).toBe(1000);
  });

  it('exposes only public fields', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.get('/leaderboard?limit=1', auth(0));
    const entry = (r.body as { leaderboard: Record<string, unknown>[] }).leaderboard[0]!;
    expect(entry['email']).toBeUndefined();
    expect(entry['userId']).toBeDefined();
    expect(entry['username']).toBeDefined();
    expect(entry['rating']).toBeDefined();
  });

  it('rejects invalid cursor', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.get('/leaderboard?before=invalid!', auth(0));
    expect(r.status).toBe(400);
  });
});
