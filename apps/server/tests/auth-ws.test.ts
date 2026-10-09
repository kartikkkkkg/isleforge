/**
 * WebSocket authentication tests (§27): AUTHENTICATE binds userId, seats
 * record the owner, and cross-user seat reclaim is rejected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';

interface WsMsg {
  type: string;
  [k: string]: unknown;
}

class Ws {
  ws: WebSocket;
  msgs: WsMsg[] = [];
  constructor(url: string) {
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
      } catch {
        /* ignore */
      }
    });
  }
  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
  async waitFor(type: string, timeoutMs = 10000): Promise<WsMsg> {
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

describe('websocket auth', () => {
  let ctx: AuthTestContext;
  const sockets: Ws[] = [];

  beforeAll(async () => {
    ctx = await setupAuthTest();
    const http = new HttpClient(ctx.baseUrl);
    await http.post('/auth/register', {
      email: 'alice@example.com',
      username: 'alice',
      password: 'Str0ng!Pass123',
    });
    await http.post('/auth/register', {
      email: 'bob@example.com',
      username: 'bob',
      password: 'Str0ng!Pass123',
    });
  }, 120000);

  afterAll(async () => {
    for (const s of sockets) s.close();
    await teardownAuthTest(ctx);
  });

  async function loginAs(username: string): Promise<{ accessToken: string; userId: string }> {
    const http = new HttpClient(ctx.baseUrl);
    const res = await http.post('/auth/login', { login: username, password: 'Str0ng!Pass123' });
    if (res.status !== 200) throw new Error(`login failed for ${username}`);
    const body = res.body as { accessToken: string; user: { id: string } };
    return { accessToken: body.accessToken, userId: body.user.id };
  }

  async function authedSocket(accessToken: string): Promise<Ws> {
    const s = new Ws(ctx.wsUrl);
    sockets.push(s);
    await s.open();
    s.send({ v: 1, type: 'AUTHENTICATE', accessToken });
    const ok = await s.waitFor('AUTHENTICATED');
    expect(typeof ok['userId']).toBe('string');
    return s;
  }

  it('authenticates a socket and binds the user id', async () => {
    const { accessToken, userId } = await loginAs('alice');
    const s = await authedSocket(accessToken);
    // Create a room; the seat should be bound to alice.
    s.send({ v: 1, type: 'CREATE_ROOM', name: 'Alice', settings: { roomSize: 3 } });
    const created = await s.waitFor('ROOM_CREATED');
    const sessionId = created['sessionId'] as string;
    const session = ctx.server.sessions.get(sessionId);
    expect(session?.userId).toBe(userId);
  });

  it('rejects AUTHENTICATE with a bad token', async () => {
    const s = new Ws(ctx.wsUrl);
    sockets.push(s);
    await s.open();
    s.send({ v: 1, type: 'AUTHENTICATE', accessToken: 'bogus.token.here' });
    const err = await s.waitFor('ERROR');
    expect((err as unknown as { code: string }).code).toBe('INVALID_MESSAGE');
  });

  it('lets guests play without authentication (guest mode preserved)', async () => {
    const s = new Ws(ctx.wsUrl);
    sockets.push(s);
    await s.open();
    s.send({ v: 1, type: 'CREATE_ROOM', name: 'Guest', settings: { roomSize: 3 } });
    const created = await s.waitFor('ROOM_CREATED');
    const session = ctx.server.sessions.get(created['sessionId'] as string);
    expect(session?.userId).toBeNull();
  });

  it('rejects cross-user seat reclaim', async () => {
    const alice = await loginAs('alice');
    const bob = await loginAs('bob');

    // Alice creates a room and disconnects abruptly.
    const a = new Ws(ctx.wsUrl);
    sockets.push(a);
    await a.open();
    a.send({ v: 1, type: 'AUTHENTICATE', accessToken: alice.accessToken });
    await a.waitFor('AUTHENTICATED');
    a.send({ v: 1, type: 'CREATE_ROOM', name: 'Alice', settings: { roomSize: 3 } });
    const created = await a.waitFor('ROOM_CREATED');
    const sessionId = created['sessionId'] as string;
    a.ws.terminate();
    await new Promise((r) => setTimeout(r, 300));

    // Bob authenticates as himself and tries to steal Alice's seat.
    const b = new Ws(ctx.wsUrl);
    sockets.push(b);
    await b.open();
    b.send({ v: 1, type: 'AUTHENTICATE', accessToken: bob.accessToken });
    await b.waitFor('AUTHENTICATED');
    b.send({ v: 1, type: 'RECONNECT', sessionId });
    const err = await b.waitFor('ERROR');
    expect((err as unknown as { code: string }).code).toBe('RECONNECT_FAILED');

    // Alice herself can reclaim it.
    const a2 = new Ws(ctx.wsUrl);
    sockets.push(a2);
    await a2.open();
    a2.send({ v: 1, type: 'AUTHENTICATE', accessToken: alice.accessToken });
    await a2.waitFor('AUTHENTICATED');
    a2.send({ v: 1, type: 'RECONNECT', sessionId });
    const ok = await a2.waitFor('RECONNECT_SUCCESS');
    expect(ok['playerId']).toBe(created['playerId']);
  });
});
