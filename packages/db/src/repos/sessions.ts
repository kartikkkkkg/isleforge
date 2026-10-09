/** Refresh-token sessions repository. Tokens stored as SHA-256 hashes only. */
import type { Pool } from 'pg';
import { newFamilyId, newSessionId } from '../ids.js';
import type { SessionRow } from '../types.js';

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  deviceLabel: string | null;
}

export class SessionsRepo {
  constructor(private pool: Pool) {}

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const { rows } = await this.pool.query<SessionRow>(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, family_id, expires_at, device_label, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *`,
      [newSessionId(), input.userId, input.refreshTokenHash, newFamilyId(), input.expiresAt, input.deviceLabel],
    );
    return rows[0]!;
  }

  async findByRefreshTokenHash(hash: string): Promise<SessionRow | null> {
    const { rows } = await this.pool.query<SessionRow>(
      'SELECT * FROM sessions WHERE refresh_token_hash = $1',
      [hash],
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<SessionRow | null> {
    const { rows } = await this.pool.query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  /** Rotate: revoke the old session row, create a new one in the same family. */
  async rotate(
    old: SessionRow,
    input: { refreshTokenHash: string; expiresAt: Date; deviceLabel: string | null },
  ): Promise<SessionRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const newId = newSessionId();
      await client.query(
        `UPDATE sessions SET revoked_at = now(), replaced_by = $1 WHERE id = $2`,
        [newId, old.id],
      );
      const { rows } = await client.query<SessionRow>(
        `INSERT INTO sessions (id, user_id, refresh_token_hash, family_id, expires_at, device_label, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *`,
        [newId, old.user_id, input.refreshTokenHash, old.family_id, input.expiresAt, input.deviceLabel],
      );
      await client.query('COMMIT');
      return rows[0]!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Revoke every session in a family (refresh-token replay detected). */
  async revokeFamily(familyId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
    return rowCount ?? 0;
  }

  async revokeSession(id: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [id]);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    return rowCount ?? 0;
  }

  async listActiveForUser(userId: string): Promise<SessionRow[]> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_used_at DESC NULLS LAST`,
      [userId],
    );
    return rows;
  }

  async touchUsed(id: string): Promise<void> {
    await this.pool.query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [id]);
  }

  /** Housekeeping: delete long-expired rows (keeps the table small). */
  async pruneExpired(olderThanDays = 60): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM sessions WHERE expires_at < now() - ($1 || ' days')::interval`,
      [String(olderThanDays)],
    );
    return rowCount ?? 0;
  }
}
