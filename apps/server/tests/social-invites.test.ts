/**
 * M9 invitation tests: lifecycle, authorization, edge cases.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';

describe('social: invitations', () => {
  let ctx: AuthTestContext;
  const tokens: string[] = [];
  const userIds: string[] = [];
  const openSockets: WebSocket[] = [];

  beforeAll(async () => {
    ctx = await setupAuthTest();
    const http = new HttpClient(ctx.baseUrl);
    for (let i =  0; i < 3; i++) {
      await http.post('/auth/register', {
        email: `inv${i}@example.com`,
        username: `invuser${i}`,
        password: 'Str0ng!Pass123',
      });
      const l = await http.post('/auth/login', { login: `invuser${i}`, password: 'Str0ng!Pass123' });
      tokens.push((l.body as { accessToken: string }).accessToken);
      const me = await http.get('/auth/me', { Authorization: `Bearer ${tokens[i]}` });
      userIds.push((me.body as { user: { id: string } }).user.id);
    }
    // 0 and 1 are friends.
    await http.post('/friends/requests', { userId: userIds[1] }, { Authorization: `Bearer ${tokens[0]}` });
    const inc = await http.get('/friends/requests/incoming', { Authorization: `Bearer ${tokens[1]}` });
    const reqId = (inc.body as { requests: { requestId: string }[] }).requests[0]!.requestId;
    await http.post(`/friends/requests/${reqId}/accept`, {}, { Authorization: `Bearer ${tokens[1]}` });
  }, 120000);

  afterAll(async () => {
    for (const ws of openSockets) {
      try { ws.close(); } catch { /* ignore */ }
    }
    await teardownAuthTest(ctx);
  });

  function auth(i: number) {
    return { Authorization: `Bearer ${tokens[i]}` };
  }

  /** Create a room and keep the host's WS open (required for canInvite). */
  async function createRoom(token: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(ctx.wsUrl);
      openSockets.push(ws);
      ws.on('open', () => {
        ws.send(JSON.stringify({ v: 1, type: 'AUTHENTICATE', accessToken: token }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AUTHENTICATED') {
          ws.send(JSON.stringify({ v: 1, type: 'CREATE_ROOM', name: 'Host' }));
        } else if (msg.type === 'ROOM_CREATED') {
          resolve(msg.room.code as string);
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
  }

  it('creates and accepts an invitation', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const roomCode = await createRoom(tokens[0]!);

    const inv = await http.post(`/rooms/${roomCode}/invites`, { userId: userIds[1] }, auth(0));
    expect(inv.status).toBe(200);
    const inviteId = (inv.body as { invite: { id: string } }).invite.id;

    // Duplicate collapses to the same invite.
    const inv2 = await http.post(`/rooms/${roomCode}/invites`, { userId: userIds[1] }, auth(0));
    expect(inv2.status).toBe(200);
    expect((inv2.body as { invite: { id: string } }).invite.id).toBe(inviteId);

    // 1 accepts.
    const acc = await http.post(`/invites/${inviteId}/accept`, {}, auth(1));
    expect(acc.status).toBe(200);
    expect((acc.body as { roomCode: string }).roomCode).toBe(roomCode);
  });

  it('rejects inviting non-friends', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const roomCode = await createRoom(tokens[0]!);
    const r = await http.post(`/rooms/${roomCode}/invites`, { userId: userIds[2] }, auth(0));
    expect(r.status).toBe(403);
  });

  it('rejects inviting from a room you do not control', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const roomCode = await createRoom(tokens[0]!);
    // User 1 tries to invite from user 0's room (not seated).
    const r = await http.post(`/rooms/${roomCode}/invites`, { userId: userIds[2] }, auth(1));
    expect(r.status).toBe(403);
  });

  it('rejects accepting someone else\'s invitation', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const roomCode = await createRoom(tokens[0]!);
    const inv = await http.post(`/rooms/${roomCode}/invites`, { userId: userIds[1] }, auth(0));
    const inviteId = (inv.body as { invite: { id: string } }).invite.id;
    const r = await http.post(`/invites/${inviteId}/accept`, {}, auth(2));
    expect(r.status).toBe(404);
  });

  it('blocked users cannot be invited', async () => {
    const http = new HttpClient(ctx.baseUrl);
    await http.post(`/blocks/${userIds[1]}`, {}, auth(0));
    const roomCode = await createRoom(tokens[0]!);
    const r = await http.post(`/rooms/${roomCode}/invites`, { userId: userIds[1] }, auth(0));
    expect(r.status).toBe(403);
    await http.delete(`/blocks/${userIds[1]}`, auth(0));
  });
});
