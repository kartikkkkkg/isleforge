/**
 * M9 social HTTP API.
 *
 *   GET  /users/search?q=&limit=        — player search (public fields only)
 *   GET  /users/:userId/profile         — public profile + relationship
 *   GET  /friends                       — accepted friends (paginated)
 *   GET  /friends/requests/incoming
 *   GET  /friends/requests/outgoing
 *   POST /friends/requests              — send (mutual pending → accept)
 *   POST /friends/requests/:id/accept
 *   POST /friends/requests/:id/decline
 *   DELETE /friends/requests/:id        — cancel own pending
 *   DELETE /friends/:userId             — remove friend
 *   GET  /blocks
 *   POST /blocks/:userId
 *   DELETE /blocks/:userId
 *   GET  /notifications
 *   POST /notifications/:id/read
 *   POST /notifications/read-all
 *   POST /rooms/:roomCode/invites       — invite a friend to a private room
 *   POST /invites/:id/accept
 *   POST /invites/:id/decline
 *
 * All routes require a Bearer <redacted> Never expose email, sessions,
 * or private account data. All queries parameterized (see repos).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FriendshipsRepo,
  BlocksRepo,
  NotificationsRepo,
  InvitesRepo,
  RatingsRepo,
  UsersRepo,
  type NotificationType,
} from '@isleforge/db';
import type { Pool } from 'pg';
import { rankFor, rankName } from '../rating/rank.js';

export interface SocialRouterDeps {
  pool: Pool;
  friendships: FriendshipsRepo;
  blocks: BlocksRepo;
  notifications: NotificationsRepo;
  invites: InvitesRepo;
  ratings: RatingsRepo;
  users: UsersRepo;
  verifyToken: (token: string) => { userId: string } | null;
  checkRateLimit: (key: string, category: string) => boolean;
  clientKey: (req: IncomingMessage) => string;
  /** Realtime hooks (set by the server after construction). */
  hooks: {
    notifyUser(userId: string, type: string, payload: unknown): void;
    onFriendshipChanged(a: string, b: string): void;
  };
  /** Room access check (set by the server). */
  roomAccess: {
    canInvite(roomCode: string, userId: string): boolean;
    roomJoinable(roomCode: string): { ok: true } | { ok: false; code: string; message: string };
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function bearerUserId(req: IncomingMessage, verify: SocialRouterDeps['verifyToken']): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return verify(h.slice(7))?.userId ?? null;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 16 * 1024) reject(new Error('BODY_TOO_LARGE'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarId: string;
  rating: number;
  gamesRated: number;
  wins: number;
  rankName: string;
  tier: string;
}

async function publicProfile(
  deps: SocialRouterDeps,
  userId: string,
): Promise<PublicProfile | null> {
  const { rows } = await deps.pool.query(
    `SELECT u.id, u.username, p.display_name, p.avatar_id
     FROM users u JOIN account_profiles p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0] as
    | { id: string; username: string; display_name: string; avatar_id: string }
    | undefined;
  if (!row) return null;
  const rating = await deps.ratings.ensure(userId);
  const rank = rankFor(rating.rating, rating.games_rated);
  return {
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarId: row.avatar_id,
    rating: rating.rating,
    gamesRated: rating.games_rated,
    wins: rating.wins,
    rankName: rankName(rank),
    tier: rank.tier,
  };
}

export function createSocialRouter(deps: SocialRouterDeps) {
  return async function socialRouter(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const params = url.searchParams;
    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') return false;
    if (
      !path.startsWith('/users') &&
      !path.startsWith('/friends') &&
      !path.startsWith('/blocks') &&
      !path.startsWith('/notifications') &&
      !path.startsWith('/invites') &&
      !path.startsWith('/rooms/')
    ) {
      return false;
    }

    const userId = bearerUserId(req, deps.verifyToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const key = `${deps.clientKey(req)}:${userId}`;

    try {
      // ---- Player search ----
      if (req.method === 'GET' && path === '/users/search') {
        if (!deps.checkRateLimit(key, 'social_search')) {
          json(res, 429, { error: 'RATE_LIMITED' });
          return true;
        }
        const q = (params.get('q') ?? '').trim();
        if (q.length < 2) {
          json(res, 400, { error: 'QUERY_TOO_SHORT', message: 'Search needs at least 2 characters.' });
          return true;
        }
        const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '20', 10) || 20, 1), 50);
        const blocked = await deps.blocks.blockedBy(userId);
        const { rows } = await deps.pool.query(
          `SELECT u.id, u.username, p.display_name, p.avatar_id
           FROM users u JOIN account_profiles p ON p.user_id = u.id
           WHERE u.username_normalized LIKE $1 || '%'
             AND u.id <> $2
           ORDER BY u.username_normalized
           LIMIT $3`,
          [q.toLowerCase(), userId, limit + blocked.length + 1],
        );
        const out: PublicProfile[] = [];
        for (const r of rows as { id: string }[]) {
          if (blocked.includes(r.id)) continue; // blocked users hidden from search
          const prof = await publicProfile(deps, r.id);
          if (prof) out.push(prof);
          if (out.length >= limit) break;
        }
        json(res, 200, { users: out });
        return true;
      }

      // ---- Public profile ----
      const profileMatch = path.match(/^\/users\/([A-Za-z0-9_-]+)\/profile$/);
      if (req.method === 'GET' && profileMatch) {
        const targetId = profileMatch[1]!;
        const prof = await publicProfile(deps, targetId);
        if (!prof) {
          json(res, 404, { error: 'USER_NOT_FOUND' });
          return true;
        }
        // Relationship with the requester (minimal, no private leaks).
        const friendship = await deps.friendships.between(userId, targetId);
        const blocked = await deps.blocks.isBlocked(userId, targetId);
        let relationship: 'none' | 'pending_outgoing' | 'pending_incoming' | 'friends' | 'blocked' = 'none';
        if (blocked) relationship = 'blocked';
        else if (friendship?.status === 'ACCEPTED') relationship = 'friends';
        else if (friendship?.status === 'PENDING') {
          relationship = friendship.requester_id === userId ? 'pending_outgoing' : 'pending_incoming';
        }
        json(res, 200, { profile: prof, relationship });
        return true;
      }

      // ---- Friend list ----
      if (req.method === 'GET' && path === '/friends') {
        const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '50', 10) || 50, 1), 100);
        const offset = Math.max(parseInt(params.get('offset') ?? '0', 10) || 0, 0);
        const friends = await deps.friendships.friendsOf(userId, limit, offset);
        const total = await deps.friendships.countFriends(userId);
        const out = [];
        for (const f of friends) {
          const prof = await publicProfile(deps, f.friendId);
          if (prof) out.push({ ...prof, friendsSince: f.since });
        }
        json(res, 200, { friends: out, total });
        return true;
      }

      // ---- Incoming / outgoing requests ----
      if (req.method === 'GET' && path === '/friends/requests/incoming') {
        const rows = await deps.friendships.incomingRequests(userId);
        const out = [];
        for (const r of rows) {
          const prof = await publicProfile(deps, r.requester_id);
          if (prof) out.push({ requestId: r.id, from: prof, createdAt: r.created_at });
        }
        json(res, 200, { requests: out });
        return true;
      }
      if (req.method === 'GET' && path === '/friends/requests/outgoing') {
        const rows = await deps.friendships.outgoingRequests(userId);
        const out = [];
        for (const r of rows) {
          const prof = await publicProfile(deps, r.addressee_id);
          if (prof) out.push({ requestId: r.id, to: prof, createdAt: r.created_at });
        }
        json(res, 200, { requests: out });
        return true;
      }

      // ---- Send request ----
      if (req.method === 'POST' && path === '/friends/requests') {
        if (!deps.checkRateLimit(key, 'social_friend_request')) {
          json(res, 429, { error: 'RATE_LIMITED' });
          return true;
        }
        const body = (await readBody(req)) as { userId?: string };
        const targetId = body.userId;
        if (!targetId || typeof targetId !== 'string') {
          json(res, 400, { error: 'INVALID_USER' });
          return true;
        }
        if (targetId === userId) {
          json(res, 400, { error: 'SELF_FRIENDSHIP' });
          return true;
        }
        if (await deps.blocks.isBlocked(userId, targetId)) {
          // Same error as "not found" to avoid leaking block state.
          json(res, 404, { error: 'USER_NOT_FOUND' });
          return true;
        }
        const target = await publicProfile(deps, targetId);
        if (!target) {
          json(res, 404, { error: 'USER_NOT_FOUND' });
          return true;
        }
        try {
          const row = await deps.friendships.request(userId, targetId);
          const accepted = row.status === 'ACCEPTED';
          const type: NotificationType = accepted ? 'FRIEND_REQUEST_ACCEPTED' : 'FRIEND_REQUEST_RECEIVED';
          // Notify the right party.
          const notifyTarget = accepted ? row.requester_id : targetId;
          const actor = accepted ? userId : userId;
          await deps.notifications.create(notifyTarget, type, actor, row.id);
          deps.hooks.notifyUser(notifyTarget, type, {
            notification: { type, actorId: actor, referenceId: row.id },
          });
          deps.hooks.onFriendshipChanged(userId, targetId);
          json(res, 200, { friendship: { id: row.id, status: row.status }, accepted });
        } catch (e) {
          const msg = (e as Error).message;
          if (msg === 'SELF_FRIENDSHIP') json(res, 400, { error: 'SELF_FRIENDSHIP' });
          else if (msg === 'ALREADY_FRIENDS') json(res, 409, { error: 'ALREADY_FRIENDS' });
          else if (msg === 'DUPLICATE_REQUEST') json(res, 409, { error: 'DUPLICATE_REQUEST' });
          else throw e;
        }
        return true;
      }

      // ---- Accept / decline ----
      const acceptMatch = path.match(/^\/friends\/requests\/([A-Za-z0-9_-]+)\/accept$/);
      if (req.method === 'POST' && acceptMatch) {
        const row = await deps.friendships.getById(acceptMatch[1]!);
        if (!row || row.status !== 'PENDING' || row.addressee_id !== userId) {
          json(res, 404, { error: 'REQUEST_NOT_FOUND' });
          return true;
        }
        await deps.friendships.setStatus(row.id, 'ACCEPTED');
        await deps.notifications.create(row.requester_id, 'FRIEND_REQUEST_ACCEPTED', userId, row.id);
        deps.hooks.notifyUser(row.requester_id, 'FRIEND_REQUEST_ACCEPTED', {
          notification: { type: 'FRIEND_REQUEST_ACCEPTED', actorId: userId, referenceId: row.id },
        });
        deps.hooks.onFriendshipChanged(row.requester_id, userId);
        json(res, 200, { ok: true });
        return true;
      }
      const declineMatch = path.match(/^\/friends\/requests\/([A-Za-z0-9_-]+)\/decline$/);
      if (req.method === 'POST' && declineMatch) {
        const row = await deps.friendships.getById(declineMatch[1]!);
        if (!row || row.status !== 'PENDING' || row.addressee_id !== userId) {
          json(res, 404, { error: 'REQUEST_NOT_FOUND' });
          return true;
        }
        await deps.friendships.remove(row.id);
        json(res, 200, { ok: true });
        return true;
      }

      // ---- Cancel own pending ----
      const cancelMatch = path.match(/^\/friends\/requests\/([A-Za-z0-9_-]+)$/);
      if (req.method === 'DELETE' && cancelMatch) {
        const row = await deps.friendships.getById(cancelMatch[1]!);
        if (!row || row.status !== 'PENDING' || row.requester_id !== userId) {
          json(res, 404, { error: 'REQUEST_NOT_FOUND' });
          return true;
        }
        await deps.friendships.remove(row.id);
        json(res, 200, { ok: true });
        return true;
      }

      // ---- Remove friend ----
      const removeMatch = path.match(/^\/friends\/([A-Za-z0-9_-]+)$/);
      if (req.method === 'DELETE' && removeMatch) {
        const targetId = removeMatch[1]!;
        const row = await deps.friendships.between(userId, targetId);
        if (!row || row.status !== 'ACCEPTED') {
          json(res, 404, { error: 'FRIENDSHIP_NOT_FOUND' });
          return true;
        }
        await deps.friendships.remove(row.id);
        deps.hooks.onFriendshipChanged(userId, targetId);
        deps.hooks.notifyUser(targetId, 'FRIEND_REMOVED', { actorId: userId });
        json(res, 200, { ok: true });
        return true;
      }

      // ---- Blocks ----
      if (req.method === 'GET' && path === '/blocks') {
        const ids = await deps.blocks.blockedBy(userId);
        const out = [];
        for (const id of ids) {
          const prof = await publicProfile(deps, id);
          if (prof) out.push(prof);
        }
        json(res, 200, { blocked: out });
        return true;
      }
      const blockMatch = path.match(/^\/blocks\/([A-Za-z0-9_-]+)$/);
      if (req.method === 'POST' && blockMatch) {
        const targetId = blockMatch[1]!;
        if (targetId === userId) {
          json(res, 400, { error: 'SELF_BLOCK' });
          return true;
        }
        const target = await publicProfile(deps, targetId);
        if (!target) {
          json(res, 404, { error: 'USER_NOT_FOUND' });
          return true;
        }
        await deps.blocks.block(userId, targetId);
        // Blocking removes friendships and pending requests both ways.
        await deps.friendships.removeBetween(userId, targetId);
        deps.hooks.onFriendshipChanged(userId, targetId);
        json(res, 200, { ok: true });
        return true;
      }
      if (req.method === 'DELETE' && blockMatch) {
        await deps.blocks.unblock(userId, blockMatch[1]!);
        json(res, 200, { ok: true });
        return true;
      }

      // ---- Notifications ----
      if (req.method === 'GET' && path === '/notifications') {
        const list = await deps.notifications.list(userId);
        const unread = await deps.notifications.unreadCount(userId);
        // Attach actor public info (no private data).
        const out = [];
        for (const n of list) {
          const actor = n.actor_id ? await publicProfile(deps, n.actor_id) : null;
          out.push({
            id: n.id,
            type: n.type,
            actor: actor
              ? { userId: actor.userId, username: actor.username, displayName: actor.displayName, avatarId: actor.avatarId }
              : null,
            referenceId: n.reference_id,
            readAt: n.read_at,
            createdAt: n.created_at,
          });
        }
        json(res, 200, { notifications: out, unread });
        return true;
      }
      const readMatch = path.match(/^\/notifications\/([A-Za-z0-9_-]+)\/read$/);
      if (req.method === 'POST' && readMatch) {
        const ok = await deps.notifications.markRead(userId, readMatch[1]!);
        if (!ok) {
          json(res, 404, { error: 'NOTIFICATION_NOT_FOUND' });
          return true;
        }
        json(res, 200, { ok: true });
        return true;
      }
      if (req.method === 'POST' && path === '/notifications/read-all') {
        const n = await deps.notifications.markAllRead(userId);
        json(res, 200, { ok: true, marked: n });
        return true;
      }

      // ---- Game invitations ----
      const inviteMatch = path.match(/^\/rooms\/([A-Za-z0-9-]{4,16})\/invites$/);
      if (req.method === 'POST' && inviteMatch) {
        if (!deps.checkRateLimit(key, 'social_invite')) {
          json(res, 429, { error: 'RATE_LIMITED' });
          return true;
        }
        const roomCode = inviteMatch[1]!;
        const body = (await readBody(req)) as { userId?: string };
        const targetId = body.userId;
        if (!targetId || typeof targetId !== 'string' || targetId === userId) {
          json(res, 400, { error: 'INVALID_USER' });
          return true;
        }
        if (!deps.roomAccess.canInvite(roomCode, userId)) {
          json(res, 403, { error: 'NOT_AUTHORIZED', message: 'You cannot invite from this room.' });
          return true;
        }
        const joinable = deps.roomAccess.roomJoinable(roomCode);
        if (!joinable.ok) {
          json(res, 400, { error: joinable.code, message: joinable.message });
          return true;
        }
        // Must be accepted friends, and not blocked.
        const rel = await deps.friendships.between(userId, targetId);
        if (!rel || rel.status !== 'ACCEPTED' || (await deps.blocks.isBlocked(userId, targetId))) {
          json(res, 403, { error: 'NOT_FRIENDS', message: 'You can only invite accepted friends.' });
          return true;
        }
        const invite = await deps.invites.createOrGet(roomCode, userId, targetId);
        await deps.notifications.create(targetId, 'GAME_INVITE_RECEIVED', userId, invite.id);
        const me = await publicProfile(deps, userId);
        deps.hooks.notifyUser(targetId, 'GAME_INVITE_RECEIVED', {
          invite: {
            id: invite.id,
            roomCode,
            inviter: me
              ? { userId: me.userId, username: me.username, displayName: me.displayName, avatarId: me.avatarId }
              : null,
            expiresAt: invite.expires_at,
          },
        });
        json(res, 200, { invite: { id: invite.id, roomCode, expiresAt: invite.expires_at } });
        return true;
      }
      const inviteAcceptMatch = path.match(/^\/invites\/([A-Za-z0-9_-]+)\/accept$/);
      if (req.method === 'POST' && inviteAcceptMatch) {
        const invite = await deps.invites.get(inviteAcceptMatch[1]!);
        if (!invite || invite.invitee_id !== userId) {
          json(res, 404, { error: 'INVITE_NOT_FOUND' });
          return true;
        }
        if (invite.status !== 'PENDING' || new Date(invite.expires_at) <= new Date()) {
          await deps.invites.setStatus(invite.id, 'EXPIRED').catch(() => {});
          json(res, 410, { error: 'INVITE_EXPIRED' });
          return true;
        }
        if (await deps.blocks.isBlocked(invite.inviter_id, userId)) {
          json(res, 403, { error: 'NOT_AUTHORIZED' });
          return true;
        }
        const joinable = deps.roomAccess.roomJoinable(invite.room_code);
        if (!joinable.ok) {
          await deps.invites.setStatus(invite.id, 'EXPIRED').catch(() => {});
          json(res, 400, { error: joinable.code, message: joinable.message });
          return true;
        }
        await deps.invites.setStatus(invite.id, 'ACCEPTED');
        // The web client joins via the normal JOIN_ROOM flow; return the code.
        json(res, 200, { roomCode: invite.room_code });
        return true;
      }
      const inviteDeclineMatch = path.match(/^\/invites\/([A-Za-z0-9_-]+)\/decline$/);
      if (req.method === 'POST' && inviteDeclineMatch) {
        const invite = await deps.invites.get(inviteDeclineMatch[1]!);
        if (!invite || invite.invitee_id !== userId) {
          json(res, 404, { error: 'INVITE_NOT_FOUND' });
          return true;
        }
        if (invite.status === 'PENDING') await deps.invites.setStatus(invite.id, 'DECLINED');
        json(res, 200, { ok: true });
        return true;
      }

      return false;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'INVALID_JSON' || msg === 'BODY_TOO_LARGE') {
        json(res, 400, { error: 'INVALID_MESSAGE' });
        return true;
      }
      throw e;
    }
  };
}
