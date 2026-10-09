/**
 * PostgreSQL connection pool. Reads DATABASE_URL (or per-field PG* env vars
 * via node-postgres defaults). One pool per process.
 */
import { Pool, type PoolConfig } from 'pg';

let pool: Pool | null = null;

export function getPool(config?: PoolConfig): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    ...config,
  });
  pool.on('error', (err) => {
    // Never log credentials; pg errors don't include them.
    console.error('[db] pool error:', err.message);
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** For tests: build an isolated pool against a specific database. */
export function createPool(config: PoolConfig): Pool {
  return new Pool({ max: 5, idleTimeoutMillis: 10_000, ...config });
}
