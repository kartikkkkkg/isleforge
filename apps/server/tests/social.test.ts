/**
 * M9 social tests: friendship lifecycle, blocking, notifications.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HttpClient,
  setupAuthTest,
  teardownAuthTest,
  type AuthTestContext,
} from './auth-helpers.js';

describe('social: friendships', () => {
  let ctx: AuthTestContext;
  const tokens: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    ctx = await setupAuthTest();
    const http = new HttpClient(ctx.baseUrl);
    for (let i = 0; i < 4; i++) {
      await http.post('/auth/register', {
        email: `soc${i}@example.com`,
        username: `socuser${i}`,
        password: 'Str0ng!Pass123',
      });
      const l = await http.post('/auth/login', { login: `socuser${i}`, password: 'Str0ng!Pass123' });
      tokens.push((l.body as { accessToken: string }).accessToken);
      const me = await http.get('/auth/me', { Authorization: `Bearer ${tokens[i]}` });
      userIds.push((me.body as { user: { id: string } }).user.id);
    }
  }, 120000);

  afterAll(async () => {
    await teardownAuthTest(ctx);
  });

  function auth(i: number) {
    return { Authorization: `Bearer ${tokens[i]}` };
  }

  it('sends and accepts a friend request', async () => {
    const http = new HttpClient(ctx.baseUrl);
    // 0 -> 1
    const send = await http.post('/friends/requests', { userId: userIds[1] }, auth(0));
    expect(send.status).toBe(200);
    const requestId = (send.body as { friendship: { id: string } }).friendship.id;

    // 1 sees incoming.
    const incoming = await http.get('/friends/requests/incoming', auth(1));
    expect((incoming.body as { requests: unknown[] }).requests).toHaveLength(1);

    // 1 accepts.
    const accept = await http.post(`/friends/requests/${requestId}/accept`, {}, auth(1));
    expect(accept.status).toBe(200);

    // Both see each other as friends.
    const f0 = await http.get('/friends', auth(0));
    expect((f0.body as { friends: { userId: string }[] }).friends[0]!.userId).toBe(userIds[1]);
  });

  it('rejects self-friendship', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.post('/friends/requests', { userId: userIds[0] }, auth(0));
    expect(r.status).toBe(400);
  });

  it('rejects duplicate requests', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r1 = await http.post('/friends/requests', { userId: userIds[2] }, auth(0));
    expect(r1.status).toBe(200);
    const r2 = await http.post('/friends/requests', { userId: userIds[2] }, auth(0));
    expect(r2.status).toBe(409);
  });

  it('mutual pending requests auto-accept', async () => {
    const http = new HttpClient(ctx.baseUrl);
    // 2 -> 3 (pending).
    await http.post('/friends/requests', { userId: userIds[3] }, auth(2));
    // 3 -> 2 (mutual) should accept, not duplicate.
    const r = await http.post('/friends/requests', { userId: userIds[2] }, auth(3));
    expect(r.status).toBe(200);
    expect((r.body as { accepted: boolean }).accepted).toBe(true);
    const f = await http.get('/friends', auth(2));
    expect((f.body as { friends: unknown[] }).friends).toHaveLength(1);
  });

  it('prevents accepting someone else\'s request', async () => {
    const http = new HttpClient(ctx.baseUrl);
    // 0 has pending to 2; 3 tries to accept it.
    const outgoing = await http.get('/friends/requests/outgoing', auth(0));
    const reqId = (outgoing.body as { requests: { requestId: string }[] }).requests[0]!.requestId;
    const r = await http.post(`/friends/requests/${reqId}/accept`, {}, auth(3));
    expect(r.status).toBe(404);
  });

  it('decline and cancel work', async () => {
    const http = new HttpClient(ctx.baseUrl);
    // 0 -> 2 pending; 2 declines.
    const outgoing = await http.get('/friends/requests/outgoing', auth(0));
    const reqId = (outgoing.body as { requests: { requestId: string }[] }).requests[0]!.requestId;
    const d = await http.post(`/friends/requests/${reqId}/decline`, {}, auth(2));
    expect(d.status).toBe(200);
    const incoming = await http.get('/friends/requests/incoming', auth(2));
    expect((incoming.body as { requests: unknown[] }).requests).toHaveLength(0);
  });

  it('remove friend works', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.delete(`/friends/${userIds[1]}`, auth(0));
    expect(r.status).toBe(200);
    const f = await http.get('/friends', auth(0));
    const friends = (f.body as { friends: { userId: string }[] }).friends;
    expect(friends.find((x) => x.userId === userIds[1])).toBeUndefined();
  });

  it('blocking removes friendship and prevents requests', async () => {
    const http = new HttpClient(ctx.baseUrl);
    // Re-friend 0 and 1, then 0 blocks 1.
    await http.post('/friends/requests', { userId: userIds[1] }, auth(0));
    const inc = await http.get('/friends/requests/incoming', auth(1));
    const reqId = (inc.body as { requests: { requestId: string }[] }).requests[0]!.requestId;
    await http.post(`/friends/requests/${reqId}/accept`, {}, auth(1));

    await http.post(`/blocks/${userIds[1]}`, {}, auth(0));
    const f = await http.get('/friends', auth(0));
    const friends = (f.body as { friends: { userId: string }[] }).friends;
    expect(friends.find((x) => x.userId === userIds[1])).toBeUndefined();

    // Blocked user can't send a request (404 to avoid leaking).
    const r = await http.post('/friends/requests', { userId: userIds[0] }, auth(1));
    expect(r.status).toBe(404);

    // Unblock.
    await http.delete(`/blocks/${userIds[1]}`, auth(0));
  });

  it('search returns public fields only', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.get('/users/search?q=socuser&limit=10', auth(0));
    expect(r.status).toBe(200);
    const users = (r.body as { users: Record<string, unknown>[] }).users;
    expect(users.length).toBeGreaterThan(0);
    expect(users[0]!['email']).toBeUndefined();
    expect(users[0]!['username']).toBeDefined();
  });

  it('search requires minimum query length', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const r = await http.get('/users/search?q=x', auth(0));
    expect(r.status).toBe(400);
  });

  it('notifications: create, list, mark read', async () => {
    const http = new HttpClient(ctx.baseUrl);
    // 2 -> 0 creates a notification for 0.
    await http.post('/friends/requests', { userId: userIds[0] }, auth(2));
    const n = await http.get('/notifications', auth(0));
    const body = n.body as { notifications: { type: string }[]; unread: number };
    expect(body.unread).toBeGreaterThan(0);
    expect(body.notifications[0]!.type).toBe('FRIEND_REQUEST_RECEIVED');

    const id = (n.body as { notifications: { id: string }[] }).notifications[0]!.id;
    await http.post(`/notifications/${id}/read`, {}, auth(0));
    const n2 = await http.get('/notifications', auth(0));
    expect((n2.body as { unread: number }).unread).toBe(body.unread - 1);
  });

  it('cannot read another user\'s notification', async () => {
    const http = new HttpClient(ctx.baseUrl);
    const n = await http.get('/notifications', auth(0));
    const id = (n.body as { notifications: { id: string }[] }).notifications[0]?.id;
    if (id) {
      const r = await http.post(`/notifications/${id}/read`, {}, auth(1));
      expect(r.status).toBe(404);
    }
  });
});
