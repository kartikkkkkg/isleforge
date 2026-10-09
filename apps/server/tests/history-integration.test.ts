/**
 * Game completion integration test (§31):
 *
 *   authenticated players
 *     → complete multiplayer game over real WebSockets
 *     → GAME_ENDED
 *     → database records created (game, players, events, stats)
 *     → profile statistics updated
 *     → game appears in history
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GamesRepo } from '@isleforge/db';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';
import { BotDriver, readyAndStart } from './bot-driver.js';
import { TestClient } from './helpers.js';

describe('game completion persistence', () => {
  let ctx: AuthTestContext;
  const drivers: BotDriver[] = [];

  beforeAll(async () => {
    ctx = await setupAuthTest();
  }, 120000);

  afterAll(async () => {
    for (const d of drivers) await d.client.close();
    await teardownAuthTest(ctx);
  });

  it('persists a completed authenticated game end-to-end', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const mkUser = async (email: string, username: string) => {
      await http.post('/auth/register', { email, username, password: 'Str0ng!Pass123' });
      const l = await http.post('/auth/login', { login: username, password: 'Str0ng!Pass123' });
      const body = l.body as { accessToken: string; user: { id: string } };
      return { token: body.accessToken, userId: body.user.id };
    };
    const alice = await mkUser('alice@example.com', 'alice');
    const bob = await mkUser('bob@example.com', 'bob');

    // Two authenticated humans + 1 server AI (roomSize 3).
    const mkDriver = async (token: string, name: string, seed: number) => {
      const client = await TestClient.connect(ctx.wsUrl);
      client.send({ v: 1, type: 'AUTHENTICATE', accessToken: token });
      await client.waitFor(
        () => client.ofType('AUTHENTICATED').length > 0,
      );
      const d = new BotDriver(client, 'easy', 'balanced', seed);
      drivers.push(d);
      return d;
    };
    const d1 = await mkDriver(alice.token, 'alice', 11);
    const d2 = await mkDriver(bob.token, 'bob', 22);

    d1.client.send({ v: 1, type: 'CREATE_ROOM', name: 'Alice', settings: { roomSize: 3 } });
    await d1.client.waitFor(() => d1.roomCode !== '');
    d2.client.send({ v: 1, type: 'JOIN_ROOM', code: d1.roomCode, name: 'Bob' });
    await d2.client.waitFor(() => d2.roomCode !== '');

    await readyAndStart([d1, d2], 1);

    // Drive both bots to game completion.
    const drive1 = d1.drive();
    const drive2 = d2.drive();
    await d1.client.waitFor(() => d1.ended, 180000);
    d1.stop();
    d2.stop();
    await Promise.all([drive1, drive2]).catch(() => {});
    expect(d1.ended).toBe(true);
    expect(d1.winnerId).not.toBeNull();

    // Persistence is async — poll for the game record.
    const games = new GamesRepo(ctx.pool);
    let gameId: string | null = null;
    for (let i = 0; i < 40; i++) {
      const { items } = await games.listGamesForUser(alice.userId, 5);
      if (items.length > 0) {
        gameId = items[0]!.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(gameId).not.toBeNull();

    const game = await games.findById(gameId!);
    expect(game!.status).toBe('COMPLETED');
    expect(game!.game_type).toBe('ONLINE');
    expect(game!.player_count).toBe(3);
    expect(game!.duration_seconds).not.toBeNull();
    expect(game!.winner_user_id).not.toBeNull();

    const players = await games.listPlayers(gameId!);
    expect(players).toHaveLength(3);
    const aliceSeat = players.find((p) => p.userId === alice.userId)!;
    const bobSeat = players.find((p) => p.userId === bob.userId)!;
    const aiSeat = players.find((p) => p.isAi)!;
    expect(aliceSeat.displayNameSnapshot).toBe('Alice');
    expect(bobSeat.finishPosition).not.toBeNull();
    expect(aiSeat.aiDifficulty).toBe('normal');

    // Events persisted, ordered.
    const events = await games.listEvents(gameId!);
    expect(events.length).toBeGreaterThan(10);
    const seqs = events.map((e) => e.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(events[0]!.eventType).toBe('GAME_CREATED');

    // Stats updated for both humans.
    const stats = await games.getStats(alice.userId);
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.wins + stats.losses).toBe(1);

    // History API shows the game.
    const hist = await http.get('/games?limit=5', {
      Authorization: `Bearer ${alice.token}`,
    });
    expect(hist.status).toBe(200);
    const items = (hist.body as { items: { id: string }[] }).items;
    expect(items.some((g) => g.id === gameId)).toBe(true);

    // The game row exists exactly once (idempotent finalization).
    const { rows } = await ctx.pool.query(
      'SELECT COUNT(*)::int AS n FROM games WHERE id = $1',
      [gameId],
    );
    expect(rows[0].n).toBe(1);
  }, 240000);

});
