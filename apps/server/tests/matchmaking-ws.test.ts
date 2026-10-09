/**
 * M7 matchmaking WS tests: queue join/leave/status, match formation,
 * duplicate prevention, guest rejection, multi-tab.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';

class QClient {
  ws: WebSocket;
  msgs: { type: string; [k: string]: unknown }[] = [];
  constructor(private url: string) {
    this.ws = new WebSocket(url);
  }
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
    this.ws.on('message', (d) => {
      try {
        this.msgs.push(JSON.parse(d.toString()));
      } catch { /* ignore */ }
    });
  }
  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
  async waitFor(type: string, timeoutMs = 15000): Promise<{ type: string; [k: string]: unknown }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const m = this.msgs.find((x) => x.type === type);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`waitFor ${type} timed out`);
  }
  close(): void {
    this.ws.close();
  }
}

describe('matchmaking ws', () => {
  let ctx: AuthTestContext;
  const clients: QClient[] = [];
  const tokens: string[] = [];

  beforeAll(async () => {
    ctx = await setupAuthTest();
    const http = new HttpClient(ctx.baseUrl);
    for (let i = 0; i < 4; i++) {
      await http.post('/auth/register', {
        email: `mm${i}@example.com`,
        username: `mmuser${i}`,
        password: 'Str0ng!Pass123',
      });
      const l = await http.post('/auth/login', { login: `mmuser${i}`, password: 'Str0ng!Pass123' });
      tokens.push((l.body as { accessToken: string }).accessToken);
    }
  }, 120000);

  afterAll(async () => {
    for (const c of clients) c.close();
    await teardownAuthTest(ctx);
  });

  async function authedClient(token: string): Promise<QClient> {
    const c = new QClient(ctx.wsUrl);
    clients.push(c);
    await c.open();
    c.send({ v: 1, type: 'AUTHENTICATE', accessToken: token });
    await c.waitFor('AUTHENTICATED');
    return c;
  }

  it('rejects guests from the queue', async () => {
    const c = new QClient(ctx.wsUrl);
    clients.push(c);
    await c.open();
    c.send({ v: 1, type: 'QUEUE_JOIN' });
    const err = await c.waitFor('MATCH_ERROR');
    expect(err['code']).toBe('NOT_AUTHENTICATED');
  });

  it('joins, reports status, and leaves', async () => {
    const c = await authedClient(tokens[0]!);
    c.send({ v: 1, type: 'QUEUE_JOIN' });
    const joined = await c.waitFor('QUEUE_JOINED');
    expect(typeof joined['queuedAt']).toBe('number');

    c.send({ v: 1, type: 'QUEUE_STATUS' });
    const status = await c.waitFor('QUEUE_STATUS');
    expect(status['status']).toBe('QUEUED');
    expect(status['playersSearching']).toBeGreaterThanOrEqual(1);

    c.send({ v: 1, type: 'QUEUE_LEAVE' });
    await c.waitFor('QUEUE_LEFT');
    c.msgs.length = 0;
    c.send({ v: 1, type: 'QUEUE_STATUS' });
    const s2 = await c.waitFor('QUEUE_STATUS');
    expect(s2['status']).toBe('NOT_QUEUED');
  });

  it('rejects duplicate queue joins (multi-tab safe)', async () => {
    const c1 = await authedClient(tokens[1]!);
    const c2 = await authedClient(tokens[1]!); // same user, second tab
    c1.send({ v: 1, type: 'QUEUE_JOIN' });
    await c1.waitFor('QUEUE_JOINED');
    c2.send({ v: 1, type: 'QUEUE_JOIN' });
    const err = await c2.waitFor('MATCH_ERROR');
    expect(err['code']).toBe('ALREADY_QUEUED');
    // Cleanup.
    c1.send({ v: 1, type: 'QUEUE_LEAVE' });
    c2.send({ v: 1, type: 'QUEUE_LEAVE' });
    await c1.waitFor('QUEUE_LEFT');
  });

  it('forms a 4-player match and starts the game', async () => {
    const qs = await Promise.all(tokens.map((t) => authedClient(t)));
    for (const q of qs) {
      q.msgs.length = 0;
      q.send({ v: 1, type: 'QUEUE_JOIN' });
    }
    // All four should see MATCH_FOUND then MATCH_STARTING then GAME_STARTED.
    for (const q of qs) {
      const found = await q.waitFor('MATCH_FOUND', 20000);
      const players = found['players'] as { userId: string }[];
      expect(players).toHaveLength(4);
      await q.waitFor('MATCH_STARTING', 20000);
      await q.waitFor('GAME_STARTED', 20000);
    }
  }, 60000);
});
