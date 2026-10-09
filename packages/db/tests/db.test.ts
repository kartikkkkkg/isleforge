/**
 * @isleforge/db tests: migrations, repositories. Isolated embedded Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  AuditRepo,
  migrate,
  migrationStatus,
  resetTestDatabase,
  SessionsRepo,
  startEmbeddedPostgres,
  UsersRepo,
  type EmbeddedPostgresHandle,
} from '../src/index.js';

describe('db', () => {
  let pg: EmbeddedPostgresHandle;
  let pool: Pool;
  let adminPool: Pool;

  beforeAll(async () => {
    pg = await startEmbeddedPostgres({ database: 'postgres', port: 5581 });
    adminPool = new Pool({ connectionString: pg.connectionString, max: 2 });
    await resetTestDatabase(adminPool, 'isleforge_db_test');
    // Derive the test-db connection string by replacing the trailing database.
    const testCs = pg.connectionString.replace(/\/[^/]*$/, '/isleforge_db_test');
    pool = new Pool({ connectionString: testCs, max: 5 });
    await migrate(pool);
  }, 120000);

  afterAll(async () => {
    await pool.end();
    await adminPool.end();
    await pg.stop();
  });

  it('applies migrations once and reports status', async () => {
    const again = await migrate(pool);
    expect(again).toEqual([]);
    const status = await migrationStatus(pool);
    expect(status.applied).toEqual([1]);
    expect(status.pending).toEqual([]);
  });

  it('creates users with profiles and enforces uniqueness', async () => {
    const users = new UsersRepo(pool);
    const { user, profile } = await users.create({
      email: 'db@example.com',
      emailNormalized: 'db@example.com',
      username: 'dbuser',
      usernameNormalized: 'dbuser',
      passwordHash: 'scrypt$fake',
      displayName: 'Db User',
      avatarId: 'compass',
    });
    expect(user.id).toMatch(/^usr_/);
    expect(profile.display_name).toBe('Db User');

    expect(await users.findByEmailNormalized('db@example.com')).not.toBeNull();
    expect(await users.findByUsernameNormalized('dbuser')).not.toBeNull();
    expect(await users.findByLogin('DBUSER')).not.toBeNull();
    expect(await users.findById('usr_nope')).toBeNull();

    // Duplicate normalized email -> unique violation.
    await expect(
      users.create({
        email: 'DB@example.com',
        emailNormalized: 'db@example.com',
        username: 'other',
        usernameNormalized: 'other',
        passwordHash: 'x',
        displayName: 'Other',
        avatarId: 'compass',
      }),
    ).rejects.toThrow();
  });

  it('manages sessions with rotation', async () => {
    const users = new UsersRepo(pool);
    const sessions = new SessionsRepo(pool);
    const { user } = await users.create({
      email: 'sess@example.com',
      emailNormalized: 'sess@example.com',
      username: 'sessuser',
      usernameNormalized: 'sessuser',
      passwordHash: 'x',
      displayName: 'Sess',
      avatarId: 'anchor',
    });
    const s1 = await sessions.create({
      userId: user.id,
      refreshTokenHash: 'hash1',
      expiresAt: new Date(Date.now() + 100000),
      deviceLabel: 'test',
    });
    expect(s1.id).toMatch(/^ses_/);
    const s2 = await sessions.rotate(s1, {
      refreshTokenHash: 'hash2',
      expiresAt: new Date(Date.now() + 100000),
      deviceLabel: 'test',
    });
    expect(s2.family_id).toBe(s1.family_id);
    const old = await sessions.findById(s1.id);
    expect(old?.revoked_at).not.toBeNull();
    expect((await sessions.listActiveForUser(user.id)).map((s) => s.id)).toEqual([s2.id]);
    expect(await sessions.revokeAllForUser(user.id)).toBe(1);
    expect(await sessions.listActiveForUser(user.id)).toEqual([]);
  });

  it('refuses to audit-log secrets', async () => {
    const audit = new AuditRepo(pool);
    await expect(audit.log('login_success', null, { password: 'x' })).rejects.toThrow();
    await audit.log('login_success', null, { reason: 'ok' });
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM auth_audit_log');
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
