/**
 * Embedded PostgreSQL for development and tests.
 *
 * Production uses a real PostgreSQL via DATABASE_URL. For local development
 * and CI without a Postgres server, this manages real PostgreSQL binaries
 * (shipped via @embedded-postgres) directly: initdb + postgres as an
 * unprivileged user (Postgres refuses to run as root).
 */
import { spawn } from 'node:child_process';
import { chmod, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function binDir(): string {
  // Resolve @embedded-postgres binary dir from the workspace root.
  // packages/db/dist/embedded.js -> ../../.. = package root of isleforge
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/embedded.js -> packages/db/dist -> up 3 = isleforge root
  let dir = here;
  for (let i = 0; i < 3; i++) dir = dirname(dir);
  return join(dir, 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'bin');
}

export interface EmbeddedOptions {
  database?: string;
  port?: number;
  username?: string;
  password?: string;
  dataDir?: string;
}

export interface EmbeddedPostgresHandle {
  connectionString: string;
  port: number;
  stop: () => Promise<void>;
}

function runAsPostgres(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    // sudo -u postgres keeps us unprivileged for the postgres binaries.
    const child = spawn('sudo', ['-u', 'postgres', cmd, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`postgres cmd failed (${code}): ${stderr.slice(-500)}`));
    });
  });
}

export async function startEmbeddedPostgres(
  opts: EmbeddedOptions = {},
): Promise<EmbeddedPostgresHandle> {
  // Best-effort cleanup of orphaned data dirs from crashed runs.
  // Dir names embed the creator pid: only remove those whose pid is dead.
  try {
    const entries = await readdir(tmpdir());
    for (const e of entries) {
      const m = /^isleforge-pg-(\d+)-/.exec(e);
      if (!m || e.includes('pw-')) continue;
      const pid = parseInt(m[1]!, 10);
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      if (!alive) {
        await rm(join(tmpdir(), e), { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }

  const username = opts.username ?? 'postgres';
  const password = opts.password ?? 'postgres';
  const database = opts.database ?? 'isleforge';
  const port = opts.port ?? 5433;
  // Default data dir: workspace-local (durable) unless overridden. /tmp is a
  // small tmpfs in many environments — avoid filling it.
  const dataDir =
    opts.dataDir ?? join(tmpdir(), `isleforge-pg-${process.pid}-${Date.now()}`);
  const bins = binDir();
  const pwfile = join(tmpdir(), `isleforge-pg-pw-${process.pid}`);

  await writeFile(pwfile, password + '\n');
  await chmod(pwfile, 0o644); // initdb runs as the postgres user; must be readable

  const env = { LC_MESSAGES: 'C' };
  await runAsPostgres(join(bins, 'initdb'), [
    `--pgdata=${dataDir}`,
    '--auth=password',
    `--username=${username}`,
    `--pwfile=${pwfile}`,
  ], env);
  // Allow local TCP connections with password.
  await runAsPostgres(join(bins, 'pg_ctl'), [
    '-D', dataDir,
    '-l', join(dataDir, 'logfile'),
    '-o', `-p ${port} -c listen_addresses='127.0.0.1'`,
    'start',
  ], env);

  // initdb creates a database named after the user; create the requested one
  // via node-postgres (the bundle ships no psql client binary).
  if (database !== username) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(database)) {
      throw new Error('Invalid database name');
    }
    const { Client } = await import('pg');
    const admin = new Client({
      host: '127.0.0.1',
      port,
      user: username,
      password,
      database: 'postgres',
    });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  }

  const stop = async (): Promise<void> => {
    try {
      await runAsPostgres(join(bins, 'pg_ctl'), ['-D', dataDir, '-m', 'fast', 'stop'], env);
    } catch {
      /* already stopped */
    }
  };
  // Best-effort cleanup on process exit.
  process.once('exit', () => {
    try {
      spawn('sudo', ['-u', 'postgres', join(bins, 'pg_ctl'), '-D', dataDir, '-m', 'fast', 'stop'], {
        stdio: 'ignore',
      });
    } catch {
      /* ignore */
    }
  });

  return {
    connectionString: `postgresql://${username}:${password}@127.0.0.1:${port}/${database}`,
    port,
    stop,
  };
}
