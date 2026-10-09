/**
 * Versioned migration runner. Applies pending *.sql files from the
 * migrations directory in numeric order, recording each in
 * schema_migrations. Never drops anything.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
// dist/ layout mirrors src/; migrations ship at the package root.
const MIGRATIONS_DIR = join(here, '..', 'migrations');

export interface MigrationStatus {
  applied: number[];
  pending: number[];
}

export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<number[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const applied = new Set(rows.map((r) => r.version));

    const files = (await readdir(dir))
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();
    const newlyApplied: number[] = [];
    for (const file of files) {
      const version = parseInt(file.split('_')[0]!, 10);
      if (applied.has(version)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      newlyApplied.push(version);
    }
    await client.query('COMMIT');
    return newlyApplied;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrationStatus(pool: Pool, dir = MIGRATIONS_DIR): Promise<MigrationStatus> {
  const { rows } = await pool.query<{ version: number }>(
    `SELECT version FROM schema_migrations ORDER BY version`,
  ).catch(() => ({ rows: [] as { version: number }[] }));
  const applied = rows.map((r) => r.version);
  const files = await readdir(dir).catch(() => [] as string[]);
  const all = files
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .map((f) => parseInt(f.split('_')[0]!, 10))
    .sort((a, b) => a - b);
  return { applied, pending: all.filter((v) => !applied.includes(v)) };
}

/** Test helper: drop + recreate a database, then migrate it. */
export async function resetTestDatabase(adminPool: Pool, dbName: string): Promise<void> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
    throw new Error('Invalid database name');
  }
  await adminPool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await adminPool.query(`CREATE DATABASE "${dbName}"`);
}
