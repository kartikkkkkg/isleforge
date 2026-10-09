/**
 * Auth test helpers: isolated embedded PostgreSQL per file, migrated schema,
 * AuthService instance, and a real HTTP+WS server with auth enabled.
 */
import { afterAll, beforeAll } from 'vitest';
import { Pool } from 'pg';
import {
  migrate,
  startEmbeddedPostgres,
  type EmbeddedPostgresHandle,
} from '@isleforge/db';
import { AuthService } from '../src/auth/service.js';
import { IsleforgeServer } from '../src/server.js';

export const TEST_SECRET = 'test-access-secret-0123456789abcdef-test-access-secret';

export interface AuthTestContext {
  pg: EmbeddedPostgresHandle;
  pool: Pool;
  auth: AuthService;
  server: IsleforgeServer;
  baseUrl: string; // http://127.0.0.1:PORT
  wsUrl: string; // ws://127.0.0.1:PORT
}

let portCounter = 5570;

export async function setupAuthTest(): Promise<AuthTestContext> {
  const port = portCounter++;
  const pg = await startEmbeddedPostgres({
    database: `isleforge_test_${port}`,
    port: 5600 + port,
  });
  const pool = new Pool({ connectionString: pg.connectionString, max: 5 });
  await migrate(pool);
  const auth = new AuthService(pool, { accessTokenSecret: TEST_SECRET });

  // Point the server at this database via DATABASE_URL.
  process.env.DATABASE_URL = pg.connectionString;
  const server = new IsleforgeServer({
    port,
    auth: {
      accessTokenSecret: TEST_SECRET,
      autoMigrate: false, // already migrated
      secureCookies: false,
      devExposeResetTokens: true,
    },
    // Relax rate limits for functional tests (security tests set their own).
    rateLimits: {
      auth_register: { windowMs: 60_000, max: 1000 },
      auth_login: { windowMs: 60_000, max: 1000 },
      auth_refresh: { windowMs: 60_000, max: 1000 },
      // Bot-driven integration tests act far faster than humans.
      command: { windowMs: 10_000, max: 1000 },
    },
  });
  await server.start();
  return {
    pg,
    pool,
    auth,
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
    wsUrl: `ws://127.0.0.1:${server.port}`,
  };
}

export async function teardownAuthTest(ctx: AuthTestContext): Promise<void> {
  await ctx.server.stop();
  await ctx.pool.end();
  await ctx.pg.stop();
  delete process.env.DATABASE_URL;
}

/** Minimal HTTP client for the auth API (handles cookies). */
export class HttpClient {
  private cookies = new Map<string, string>();

  constructor(private baseUrl: string) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, init);
    // Store cookies.
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      for (const part of setCookie.split(',')) {
        const m = /([^=;]+)=([^;]*)/.exec(part.trim());
        if (m) {
          const name = m[1]!.trim();
          const value = m[2]!.trim();
          if (/Max-Age=0/i.test(part)) this.cookies.delete(name);
          else this.cookies.set(name, value);
        }
      }
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      /* ignore */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request('GET', path, undefined, headers);
  }
  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', path, body, headers);
  }
  patch(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('PATCH', path, body, headers);
  }
}
