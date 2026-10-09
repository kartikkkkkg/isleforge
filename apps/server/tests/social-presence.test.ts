/**
 * M9 presence tests: multi-tab, friend visibility, blocking.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';

function wsConnect(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, type: 'AUTHENTICATE', accessToken: token }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'AUTHENTICATED') resolve(ws);
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), 5000);
  });
}

function waitFor(ws: WebSocket, type: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('social: presence', () => {
  let ctx: AuthTestContext;
  const tokens: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    ctx = await setupAuthTest();
    const http = new HttpClient(ctx.baseUrl);
    for (let i = 0; i < 3; i++) {
      await http.post('/auth/register', {
        email: `pres${i}@example.com`,
        username: `presuser${i}`,
        password: 'Str0ng!Pass123',
      });
      const l = await http.post('/auth/login', { login: `presuser${i}`, password: 'Str0ng!Pass123' });
      tokens.push((l.body as { accessToken: string }).accessToken);
      const me = await http.get('/auth/me', { Authorization: `Bearer ${tokens[i]}` });
      userIds.push((me.body as { user: { id: string } }).user.id);
    }
    // 0 and 1 are friends; 2 is not friends with anyone.
    await http.post('/friends/requests', { userId: userIds[1] }, { Authorization: `Bearer ${tokens[0]}` });
    const inc = await http.get('/friends/requests/incoming', { Authorization: `Bearer ${tokens[1]}` });
    const reqId = (inc.body as { requests: { requestId: string }[] }).requests[0]!.requestId;
    await http.post(`/friends/requests/${reqId}/accept`, {}, { Authorization: `Bearer ${tokens[1]}` });
  }, 120000);

  afterAll(async () => {
    await teardownAuthTest(ctx);
  });

  it('friend receives presence update on connect', async () => {
    const ws0 = await wsConnect(ctx.wsUrl, tokens[0]!);
    const ws1 = await wsConnect(ctx.wsUrl, tokens[1]!);
    try {
      ws0.send(JSON.stringify({ v: 1, type: 'SOCIAL_SUBSCRIBE' }));
      await waitFor(ws0, 'SOCIAL_SUBSCRIBED');
      // ws1 was already connected; but presence emits on connect. Reconnect ws1.
      ws1.close();
      const ws1b = await wsConnect(ctx.wsUrl, tokens[1]!);
      try {
        const update = (await waitFor(ws0, 'PRESENCE_UPDATE')) as {
          userId: string;
          state: string;
        };
        expect(update.userId).toBe(userIds[1]);
        expect(update.state).toBe('ONLINE');
        ws1b.close();
      } finally {
        try { ws1b.close(); } catch { /* ignore */ }
      }
    } finally {
      ws0.close();
      try { ws1.close(); } catch { /* ignore */ }
    }
  });

  it('non-friend does not receive presence', async () => {
    const ws0 = await wsConnect(ctx.wsUrl, tokens[0]!);
    const ws2 = await wsConnect(ctx.wsUrl, tokens[2]!);
    try {
      ws2.send(JSON.stringify({ v: 1, type: 'SOCIAL_SUBSCRIBE' }));
      await waitFor(ws2, 'SOCIAL_SUBSCRIBED');
      // ws0 connects; ws2 should NOT get a presence update for ws0.
      ws0.close();
      const ws0b = await wsConnect(ctx.wsUrl, tokens[0]!);
      try {
        let received = false;
        const handler = (data: WebSocket.Data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'PRESENCE_UPDATE' && msg.userId === userIds[0]) received = true;
        };
        ws2.on('message', handler);
        await new Promise((r) => setTimeout(r, 1000));
        ws2.off('message', handler);
        expect(received).toBe(false);
        ws0b.close();
      } finally {
        try { ws0b.close(); } catch { /* ignore */ }
      }
    } finally {
      ws0.close();
      ws2.close();
    }
  });

  it('multi-tab: stays ONLINE until last connection closes', async () => {
    const wsA = await wsConnect(ctx.wsUrl, tokens[0]!);
    const wsB = await wsConnect(ctx.wsUrl, tokens[0]!); // second tab, same user
    const ws1 = await wsConnect(ctx.wsUrl, tokens[1]!);
    try {
      ws1.send(JSON.stringify({ v: 1, type: 'SOCIAL_SUBSCRIBE' }));
      await waitFor(ws1, 'SOCIAL_SUBSCRIBED');
      // Close one tab; user should stay ONLINE (no OFFLINE update).
      wsA.close();
      let wentOffline = false;
      const handler = (data: WebSocket.Data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'PRESENCE_UPDATE' && msg.userId === userIds[0] && msg.state === 'OFFLINE') {
          wentOffline = true;
        }
      };
      ws1.on('message', handler);
      await new Promise((r) => setTimeout(r, 1000));
      ws1.off('message', handler);
      expect(wentOffline).toBe(false);
    } finally {
      wsA.close();
      wsB.close();
      ws1.close();
    }
  });
});
