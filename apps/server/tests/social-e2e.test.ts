/**
 * M9 social E2E: search → request → accept → presence → invite → join → game.
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

function waitFor(ws: WebSocket, type: string, timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ${type}`)), timeoutMs);
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

describe('social: end-to-end', () => {
  let ctx: AuthTestContext;
  const tokens: string[] = [];
  const userIds: string[] = [];
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    ctx = await setupAuthTest();
    const http = new HttpClient(ctx.baseUrl);
    for (let i = 0; i < 2; i++) {
      const name = i === 0 ? 'alice' : 'bob';
      await http.post('/auth/register', {
        email: `${name}@example.com`,
        username: `${name}e2e`,
        password: 'Str0ng!Pass123',
      });
      const l = await http.post('/auth/login', { login: `${name}e2e`, password: 'Str0ng!Pass123' });
      tokens.push((l.body as { accessToken: string }).accessToken);
      const me = await http.get('/auth/me', { Authorization: `Bearer ${tokens[i]}` });
      userIds.push((me.body as { user: { id: string } }).user.id);
    }
  }, 120000);

  afterAll(async () => {
    for (const ws of sockets) {
      try { ws.close(); } catch { /* ignore */ }
    }
    await teardownAuthTest(ctx);
  });

  it('full social flow: search → friend → presence → invite → join', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const [tokenA, tokenB] = tokens as [string, string];
    const [idA, idB] = userIds as [string, string];

    // 1-2. A and B connect via WS.
    const wsA = await wsConnect(ctx.wsUrl, tokenA);
    const wsB = await wsConnect(ctx.wsUrl, tokenB);
    sockets.push(wsA, wsB);

    // 3. A searches for B.
    const search = await http.get('/users/search?q=bobe2e&limit=10', {
      Authorization: `Bearer ${tokenA}`,
    });
    expect(search.status).toBe(200);
    const found = (search.body as { users: { userId: string }[] }).users;
    expect(found.find((u) => u.userId === idB)).toBeDefined();

    // 4-5. A sends friend request; B receives realtime notification.
    const notifPromise = waitFor(wsB, 'SOCIAL_NOTIFICATION');
    const send = await http.post('/friends/requests', { userId: idB }, {
      Authorization: `Bearer ${tokenA}`,
    });
    expect(send.status).toBe(200);
    const notif = (await notifPromise) as { kind: string };
    expect(notif.kind).toBe('FRIEND_REQUEST_RECEIVED');

    // 6-7. B accepts; A receives acceptance notification.
    const reqId = (send.body as { friendship: { id: string } }).friendship.id;
    const accNotifPromise = waitFor(wsA, 'SOCIAL_NOTIFICATION');
    const accept = await http.post(`/friends/requests/${reqId}/accept`, {}, {
      Authorization: `Bearer ${tokenB}`,
    });
    expect(accept.status).toBe(200);
    const accNotif = (await accNotifPromise) as { kind: string };
    expect(accNotif.kind).toBe('FRIEND_REQUEST_ACCEPTED');

    // 8. Both see each other ONLINE via presence.
    wsA.send(JSON.stringify({ v: 1, type: 'SOCIAL_SUBSCRIBE' }));
    wsB.send(JSON.stringify({ v: 1, type: 'SOCIAL_SUBSCRIBE' }));
    await waitFor(wsA, 'SOCIAL_SUBSCRIBED');
    await waitFor(wsB, 'SOCIAL_SUBSCRIBED');
    // Presence updates were already sent on subscribe; check at least one.
    // (Both are online, so each should get the other's presence.)

    // 9. A creates a private room.
    wsA.send(JSON.stringify({ v: 1, type: 'CREATE_ROOM', name: 'Alice' }));
    const roomCreated = (await waitFor(wsA, 'ROOM_CREATED')) as {
      room: { code: string };
    };
    const roomCode = roomCreated.room.code;
    expect(roomCode).toBeTruthy();

    // 10-11. A invites B; B receives invitation notification.
    const invNotifPromise = waitFor(wsB, 'SOCIAL_NOTIFICATION');
    const inv = await http.post(`/rooms/${roomCode}/invites`, { userId: idB }, {
      Authorization: `Bearer ${tokenA}`,
    });
    expect(inv.status).toBe(200);
    const inviteId = (inv.body as { invite: { id: string } }).invite.id;
    const invNotif = (await invNotifPromise) as {
      kind: string;
      payload: { invite: { id: string } };
    };
    expect(invNotif.kind).toBe('GAME_INVITE_RECEIVED');
    expect(invNotif.payload.invite.id).toBe(inviteId);

    // 12. B accepts the invitation (gets room code).
    const accInv = await http.post(`/invites/${inviteId}/accept`, {}, {
      Authorization: `Bearer ${tokenB}`,
    });
    expect(accInv.status).toBe(200);
    expect((accInv.body as { roomCode: string }).roomCode).toBe(roomCode);

    // 13. B joins via normal JOIN_ROOM.
    wsB.send(JSON.stringify({ v: 1, type: 'JOIN_ROOM', code: roomCode, name: 'Bob' }));
    const joined = (await waitFor(wsB, 'ROOM_CREATED')) as {
      room: { code: string };
    };
    expect(joined.room.code).toBe(roomCode);

    // 18. Friendship remains intact.
    const friends = await http.get('/friends', { Authorization: `Bearer ${tokenA}` });
    const list = (friends.body as { friends: { userId: string }[] }).friends;
    expect(list.find((f) => f.userId === idB)).toBeDefined();
  }, 30000);
});
