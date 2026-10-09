/**
 * Game history db tests: games, players, events, completion, stats, pagination.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  GamesRepo,
  migrate,
  migrationStatus,
  resetTestDatabase,
  startEmbeddedPostgres,
  UsersRepo,
  type EmbeddedPostgresHandle,
} from '../src/index.js';

describe('game history db', () => {
  let pg: EmbeddedPostgresHandle;
  let pool: Pool;
  let adminPool: Pool;
  let games: GamesRepo;
  let users: UsersRepo;
  let userId: string;

  beforeAll(async () => {
    pg = await startEmbeddedPostgres({ database: 'postgres', port: 5582 });
    adminPool = new Pool({ connectionString: pg.connectionString, max: 2 });
    await resetTestDatabase(adminPool, 'isleforge_games_test');
    const testCs = pg.connectionString.replace(/\/[^/]*$/, '/isleforge_games_test');
    pool = new Pool({ connectionString: testCs, max: 5 });
    await migrate(pool);
    const status = await migrationStatus(pool);
    expect(status.applied).toEqual([1, 2]);

    games = new GamesRepo(pool);
    users = new UsersRepo(pool);
    const { user } = await users.create({
      email: 'gamer@example.com',
      emailNormalized: 'gamer@example.com',
      username: 'gamer',
      usernameNormalized: 'gamer',
      passwordHash: 'x',
      displayName: 'Gamer',
      avatarId: 'compass',
    });
    userId = user.id;
  }, 120000);

  afterAll(async () => {
    await pool.end();
    await adminPool.end();
    await pg.stop();
  });

  it('creates a game and records players idempotently', async () => {
    const g = await games.insertGame({ id: 'game-1', gameType: 'ONLINE', playerCount: 3 });
    expect(g.status).toBe('STARTED');
    // Idempotent re-insert.
    const g2 = await games.insertGame({ id: 'game-1', gameType: 'ONLINE', playerCount: 3 });
    expect(g2.id).toBe('game-1');

    await games.insertPlayers('game-1', [
      { seat: 0, playerId: 'p1', userId, displayNameSnapshot: 'Gamer', playerColor: 'red', isAi: false },
      { seat: 1, playerId: 'p2', userId: null, displayNameSnapshot: 'Guest', playerColor: 'blue', isAi: false },
      { seat: 2, playerId: 'p3', userId: null, displayNameSnapshot: 'HardBot', playerColor: 'green', isAi: true, aiDifficulty: 'hard', aiPersonality: 'aggressive' },
    ]);
    const players = await games.listPlayers('game-1');
    expect(players).toHaveLength(3);
    expect(players[2]!.isAi).toBe(true);
    expect(players[2]!.aiDifficulty).toBe('hard');
    expect(players[1]!.userId).toBeNull();
  });

  it('completes a game exactly once (idempotent finalization)', async () => {
    const finishedAt = new Date();
    const ok1 = await games.completeGame({
      id: 'game-1',
      winnerUserId: userId,
      winnerPlayerId: 'p1',
      finishedAt,
      durationSeconds: 600,
    });
    expect(ok1).toBe(true);
    // Second completion is a no-op.
    const ok2 = await games.completeGame({
      id: 'game-1',
      winnerUserId: userId,
      winnerPlayerId: 'p1',
      finishedAt,
      durationSeconds: 600,
    });
    expect(ok2).toBe(false);

    await games.finalizePlayers('game-1', [
      { seat: 0, finishPosition: 1, victoryPoints: 10, won: true },
      { seat: 1, finishPosition: 2, victoryPoints: 8, won: false },
      { seat: 2, finishPosition: 3, victoryPoints: 5, won: false },
    ]);
    await games.insertPlayerStats('game-1', [
      { userId, seat: 0, vp: 10, finishPosition: 1, won: true, roadsBuilt: 5, settlementsBuilt: 4, citiesBuilt: 1, devCardsBought: 2, devCardsPlayed: 1 },
    ]);

    const g = await games.findById('game-1');
    expect(g!.status).toBe('COMPLETED');
    expect(g!.winner_user_id).toBe(userId);
    expect(g!.duration_seconds).toBe(600);
  });

  it('persists ordered events with unique sequences', async () => {
    await games.insertEvents('game-1', [
      { sequence: 0, eventType: 'GAME_CREATED', actorSeat: null, payload: { seed: 1 } },
      { sequence: 1, eventType: 'TURN_STARTED', actorSeat: 0, payload: { turnNumber: 1 } },
      { sequence: 2, eventType: 'DICE_ROLLED', actorSeat: 0, payload: { value: 8 } },
    ]);
    // Duplicate insert is safe.
    await games.insertEvents('game-1', [
      { sequence: 1, eventType: 'TURN_STARTED', actorSeat: 0, payload: { turnNumber: 1 } },
    ]);
    const events = await games.listEvents('game-1');
    expect(events.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(events[1]!.eventType).toBe('TURN_STARTED');
  });

  it('computes statistics from fixtures', async () => {
    // 2 more completed games: 1 win, 1 loss → totals: 3 games, 2 wins, 1 loss.
    for (const [gid, won, vp, pos] of [['game-2', true, 10, 1], ['game-3', false, 7, 2]] as const) {
      await games.insertGame({ id: gid, gameType: 'ONLINE', playerCount: 2 });
      await games.insertPlayers(gid, [
        { seat: 0, playerId: 'p1', userId, displayNameSnapshot: 'Gamer', playerColor: 'red', isAi: false },
        { seat: 1, playerId: 'p2', userId: null, displayNameSnapshot: 'Bot', playerColor: 'blue', isAi: true },
      ]);
      await games.completeGame({ id: gid, winnerUserId: won ? userId : null, winnerPlayerId: won ? 'p1' : 'p2', finishedAt: new Date(), durationSeconds: 300 });
      await games.insertPlayerStats(gid, [
        { userId, seat: 0, vp, finishPosition: pos, won, roadsBuilt: 3, settlementsBuilt: 3, citiesBuilt: 0, devCardsBought: 1, devCardsPlayed: 0 },
      ]);
    }
    const s = await games.getStats(userId);
    expect(s.gamesPlayed).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 4);
    expect(s.averageVp).toBeCloseTo((10 + 10 + 7) / 3, 4);
    expect(s.averageFinish).toBeCloseTo((1 + 1 + 2) / 3, 4);
    expect(s.bestVp).toBe(10);
    expect(s.totalPlayTimeSeconds).toBe(600 + 300 + 300);
  });

  it('returns zero stats for a user with no games (no NaN)', async () => {
    const { user } = await users.create({
      email: 'newbie@example.com',
      emailNormalized: 'newbie@example.com',
      username: 'newbie',
      usernameNormalized: 'newbie',
      passwordHash: 'x',
      displayName: 'Newbie',
      avatarId: 'anchor',
    });
    const s = await games.getStats(user.id);
    expect(s.gamesPlayed).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.averageVp).toBe(0);
    expect(s.averageFinish).toBe(0);
    expect(Number.isNaN(s.winRate)).toBe(false);
  });

  it('paginates history with a cursor', async () => {
    const page1 = await games.listGamesForUser(userId, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const cursor = JSON.parse(Buffer.from(page1.nextCursor!, 'base64url').toString('utf8'));
    const page2 = await games.listGamesForUser(userId, 2, {
      finishedAt: new Date(cursor.f),
      id: cursor.i,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    // No overlap.
    const ids1 = new Set(page1.items.map((g) => g.id));
    for (const g of page2.items) expect(ids1.has(g.id)).toBe(false);
  });

  it('marks games abandoned without counting them as wins/losses', async () => {
    await games.insertGame({ id: 'game-ab', gameType: 'ONLINE', playerCount: 2 });
    await games.insertPlayers('game-ab', [
      { seat: 0, playerId: 'p1', userId, displayNameSnapshot: 'Gamer', playerColor: 'red', isAi: false },
      { seat: 1, playerId: 'p2', userId: null, displayNameSnapshot: 'Bot', playerColor: 'blue', isAi: true },
    ]);
    expect(await games.markAbandoned('game-ab', new Date())).toBe(true);
    const g = await games.findById('game-ab');
    expect(g!.status).toBe('ABANDONED');
    // Stats unchanged — abandoned games don't count.
    const s = await games.getStats(userId);
    expect(s.gamesPlayed).toBe(3);
  });
});
