/**
 * @isleforge/db — social repos (M9): friendships, blocks, notifications, invites.
 * All queries parameterized. Friendships are direction-independent.
 */
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export type FriendshipStatus = 'PENDING' | 'ACCEPTED';

export interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: Date;
  updated_at: Date;
}

/** Canonical order for a pair: lower id first. */
function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export class FriendshipsRepo {
  constructor(private db: Pool) {}

  /** Find any friendship between two users (either direction/status). */
  async between(a: string, b: string): Promise<FriendshipRow | null> {
    const [x, y] = orderPair(a, b);
    const { rows } = await this.db.query<FriendshipRow>(
      `SELECT * FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)
       LIMIT 1`,
      [x, y],
    );
    return rows[0] ?? null;
  }

  async getById(id: string): Promise<FriendshipRow | null> {
    const { rows } = await this.db.query<FriendshipRow>(
      'SELECT * FROM friendships WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Send a request. If the target already requested the requester (mutual),
   * accept the existing row instead of creating a duplicate.
   */
  async request(requesterId: string, addresseeId: string): Promise<FriendshipRow> {
    if (requesterId === addresseeId) throw new Error('SELF_FRIENDSHIP');
    const existing = await this.between(requesterId, addresseeId);
    if (existing) {
      if (existing.status === 'ACCEPTED') throw new Error('ALREADY_FRIENDS');
      // Mutual pending: the other side's pending request becomes accepted.
      if (existing.requester_id === addresseeId) {
        return this.setStatus(existing.id, 'ACCEPTED');
      }
      throw new Error('DUPLICATE_REQUEST');
    }
    const id = randomUUID();
    const { rows } = await this.db.query<FriendshipRow>(
      `INSERT INTO friendships (id, requester_id, addressee_id, status)
       VALUES ($1, $2, $3, 'PENDING') RETURNING *`,
      [id, requesterId, addresseeId],
    );
    return rows[0]!;
  }

  async setStatus(id: string, status: FriendshipStatus): Promise<FriendshipRow> {
    const { rows } = await this.db.query<FriendshipRow>(
      `UPDATE friendships SET status = $2, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, status],
    );
    if (!rows[0]) throw new Error('NOT_FOUND');
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM friendships WHERE id = $1', [id]);
  }

  /** Remove any friendship/request between two users (used by blocking). */
  async removeBetween(a: string, b: string): Promise<void> {
    await this.db.query(
      `DELETE FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [a, b],
    );
  }

  /** Accepted friends of a user (paginated). */
  async friendsOf(userId: string, limit: number, offset = 0): Promise<{ friendId: string; since: Date }[]> {
    const { rows } = await this.db.query(
      `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS "friendId",
              updated_at AS since
       FROM friendships
       WHERE status = 'ACCEPTED' AND (requester_id = $1 OR addressee_id = $1)
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, Math.min(limit, 100), Math.max(offset, 0)],
    );
    return rows;
  }

  async incomingRequests(userId: string, limit = 50): Promise<FriendshipRow[]> {
    const { rows } = await this.db.query<FriendshipRow>(
      `SELECT * FROM friendships
       WHERE addressee_id = $1 AND status = 'PENDING'
       ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(limit, 100)],
    );
    return rows;
  }

  async outgoingRequests(userId: string, limit = 50): Promise<FriendshipRow[]> {
    const { rows } = await this.db.query<FriendshipRow>(
      `SELECT * FROM friendships
       WHERE requester_id = $1 AND status = 'PENDING'
       ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(limit, 100)],
    );
    return rows;
  }

  async friendIds(userId: string): Promise<string[]> {
    const { rows } = await this.db.query(
      `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
       FROM friendships
       WHERE status = 'ACCEPTED' AND (requester_id = $1 OR addressee_id = $1)`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  async countFriends(userId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM friendships
       WHERE status = 'ACCEPTED' AND (requester_id = $1 OR addressee_id = $1)`,
      [userId],
    );
    return rows[0]!.n as number;
  }
}

export class BlocksRepo {
  constructor(private db: Pool) {}

  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) throw new Error('SELF_BLOCK');
    await this.db.query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [blockerId, blockedId],
    );
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [blockerId, blockedId],
    );
  }

  async isBlocked(a: string, b: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)
       LIMIT 1`,
      [a, b],
    );
    return rows.length > 0;
  }

  async blockedBy(userId: string): Promise<string[]> {
    const { rows } = await this.db.query(
      'SELECT blocked_id AS id FROM blocks WHERE blocker_id = $1',
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }
}

export type NotificationType =
  | 'FRIEND_REQUEST_RECEIVED'
  | 'FRIEND_REQUEST_ACCEPTED'
  | 'GAME_INVITE_RECEIVED';

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string | null;
  reference_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

export class NotificationsRepo {
  constructor(private db: Pool) {}

  async create(
    userId: string,
    type: NotificationType,
    actorId: string | null,
    referenceId?: string,
  ): Promise<NotificationRow> {
    const { rows } = await this.db.query<NotificationRow>(
      `INSERT INTO social_notifications (id, user_id, type, actor_id, reference_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [randomUUID(), userId, type, actorId, referenceId ?? null],
    );
    return rows[0]!;
  }

  async list(userId: string, limit = 20): Promise<NotificationRow[]> {
    const { rows } = await this.db.query<NotificationRow>(
      `SELECT * FROM social_notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(limit, 50)],
    );
    return rows;
  }

  async unreadCount(userId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM social_notifications
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return rows[0]!.n as number;
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE social_notifications SET read_at = now()
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE social_notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return rowCount ?? 0;
  }
}

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';

export interface InviteRow {
  id: string;
  room_code: string;
  inviter_id: string;
  invitee_id: string;
  status: InviteStatus;
  created_at: Date;
  expires_at: Date;
}

export class InvitesRepo {
  constructor(private db: Pool) {}

  /** Create or return the existing pending invite (graceful collapse). */
  async createOrGet(roomCode: string, inviterId: string, inviteeId: string): Promise<InviteRow> {
    if (inviterId === inviteeId) throw new Error('SELF_INVITE');
    const { rows } = await this.db.query<InviteRow>(
      `SELECT * FROM game_invites
       WHERE room_code = $1 AND inviter_id = $2 AND invitee_id = $3
         AND status = 'PENDING' AND expires_at > now()
       LIMIT 1`,
      [roomCode, inviterId, inviteeId],
    );
    if (rows[0]) return rows[0]!;
    const created = await this.db.query<InviteRow>(
      `INSERT INTO game_invites (id, room_code, inviter_id, invitee_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [randomUUID(), roomCode, inviterId, inviteeId],
    );
    return created.rows[0]!;
  }

  async get(id: string): Promise<InviteRow | null> {
    const { rows } = await this.db.query<InviteRow>(
      'SELECT * FROM game_invites WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async setStatus(id: string, status: InviteStatus): Promise<InviteRow> {
    const { rows } = await this.db.query<InviteRow>(
      `UPDATE game_invites SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status],
    );
    if (!rows[0]) throw new Error('NOT_FOUND');
    return rows[0]!;
  }

  /** Mark expired pending invites (called opportunistically). */
  async expireStale(): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE game_invites SET status = 'EXPIRED'
       WHERE status = 'PENDING' AND expires_at <= now()`,
      [],
    );
    return rowCount ?? 0;
  }
}
