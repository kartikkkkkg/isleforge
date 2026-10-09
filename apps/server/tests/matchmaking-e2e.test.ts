/**
 * M7 full integration: 4 authenticated players queue → match forms →
 * game plays to completion → ratings updated exactly once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';
import { BotDriver, setupLobby } from './bot-driver.js';
import { RatingsRepo } from '@isleforge/db';

describe('matchmaking full game', () => {
  let ctx: AuthTestContext;

  beforeAll(async () => {
    ctx = await setupAuthTest();
  }, 120000);

  afterAll(async () => {
    await teardownAuthTest(ctx);
  });

  it('queues 4 players, forms a match, completes the game, updates ratings once', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const tokens: string[] = [];
    const userIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      await http.post('/auth/register', {
        email: `e2e${i}@example.com`,
        username: `e2euser${i}`,
        password: 'Str0ng!Pass123',
      });
      const l = await http.post('/auth/login', { login: `e2euser${i}`, password: 'Str0ng!Pass123' });
      tokens.push((l.body as { accessToken: string }).accessToken);
      const me = await new HttpClient(ctx.baseUrl).get('/auth/me', {
        Authorization: `Bearer ${tokens[i]}`,
      });
      userIds.push((me.body as { user: { id: string } }).user.id);
    }

    // All start at 1000.
    const ratings = new RatingsRepo(ctx.pool);
    for (const uid of userIds) {
      const r = await ratings.ensure(uid);
      expect(r.rating).toBe(1000);
    }

    // Queue all four via real WebSockets (reuse BotDriver's client).
    const drivers: BotDriver[] = [];
    const { TestClient } = await import('./helpers.js');
    for (let i = 0; i < 4; i++) {
      const client = await TestClient.connect(ctx.wsUrl);
      client.send({ v: 1, type: 'AUTHENTICATE', accessToken: tokens[i]! });
      await client.waitFor(() => client.ofType('AUTHENTICATED').length > 0);
      const d = new BotDriver(client, 'easy', 'balanced', 3000 + i);
      // Override name for matchmaking.
      (d as unknown as { name: string }).name = `e2euser${i}`;
      drivers.push(d);
    }

    // Join the queue.
    for (const d of drivers) {
      d.client.send({ v: 1, type: 'QUEUE_JOIN' });
    }
    for (const d of drivers) {
      await d.client.waitFor(() => d.client.ofType('MATCH_FOUND').length > 0, 30000);
      await d.client.waitFor(() => d.client.ofType('GAME_STARTED').length > 0, 30000);
    }

    // Drive the game to completion.
    const drives = drivers.map((d) => d.drive());
    await drivers[0]!.client.waitFor(() => drivers[0]!.ended, 240000);
    for (const d of drivers) d.stop();
    await Promise.all(drives).catch(() => {});
    expect(drivers[0]!.ended).toBe(true);

    // Ratings updated exactly once per player.
    await new Promise((r) => setTimeout(r, 2000)); // allow async rating write
    for (const uid of userIds) {
      const r = await ratings.get(uid);
      expect(r).not.toBeNull();
      expect(r!.games_rated).toBe(1);
      const hist = await ctx.pool.query(
        `SELECT COUNT(*)::int AS n FROM rating_history WHERE user_id = $1`,
        [uid],
      );
      expect(hist.rows[0].n).toBe(1);
    }

    // Winner gained rating, loser lost (or at least ratings changed).
    const after = await Promise.all(userIds.map((uid) => ratings.get(uid)));
    const changed = after.filter((r, i) => r!.rating !== 1000);
    expect(changed.length).toBeGreaterThan(0);

    // Game persisted as MATCHMADE.
    const games = await ctx.pool.query(
      `SELECT match_type FROM games WHERE match_type = 'MATCHMADE'`,
    );
    expect(games.rows.length).toBeGreaterThanOrEqual(1);

    for (const d of drivers) d.client.close();
  }, 300000);
});
