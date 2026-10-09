/** Users + account_profiles repository. All statements parameterized. */
import type { Pool } from 'pg';
import { newUserId } from '../ids.js';
import type { ProfileRow, PublicAccount, UserRow } from '../types.js';

export interface CreateUserInput {
  email: string;
  emailNormalized: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  displayName: string;
  avatarId: string;
}

export class UsersRepo {
  constructor(private pool: Pool) {}

  async create(input: CreateUserInput): Promise<{ user: UserRow; profile: ProfileRow }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const id = newUserId();
      const { rows } = await client.query<UserRow>(
        `INSERT INTO users (id, email, email_normalized, username, username_normalized, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, input.email, input.emailNormalized, input.username, input.usernameNormalized, input.passwordHash],
      );
      const user = rows[0]!;
      const { rows: prow } = await client.query<ProfileRow>(
        `INSERT INTO account_profiles (user_id, display_name, avatar_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [id, input.displayName, input.avatarId],
      );
      await client.query('COMMIT');
      return { user, profile: prow[0]! };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async findByEmailNormalized(emailNormalized: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE email_normalized = $1',
      [emailNormalized],
    );
    return rows[0] ?? null;
  }

  async findByUsernameNormalized(usernameNormalized: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE username_normalized = $1',
      [usernameNormalized],
    );
    return rows[0] ?? null;
  }

  /** Login accepts email or username; one query path, no enumeration signal. */
  async findByLogin(loginNormalized: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE email_normalized = $1 OR username_normalized = $1`,
      [loginNormalized.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  async getProfile(userId: string): Promise<ProfileRow | null> {
    const { rows } = await this.pool.query<ProfileRow>(
      'SELECT * FROM account_profiles WHERE user_id = $1',
      [userId],
    );
    return rows[0] ?? null;
  }

  async updateProfile(
    userId: string,
    patch: { displayName?: string; avatarId?: string },
  ): Promise<ProfileRow | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.displayName !== undefined) {
      sets.push(`display_name = $${i++}`);
      vals.push(patch.displayName);
    }
    if (patch.avatarId !== undefined) {
      sets.push(`avatar_id = $${i++}`);
      vals.push(patch.avatarId);
    }
    if (sets.length === 0) return this.getProfile(userId);
    vals.push(userId);
    const { rows } = await this.pool.query<ProfileRow>(
      `UPDATE account_profiles SET ${sets.join(', ')}, updated_at = now()
       WHERE user_id = $${i} RETURNING *`,
      vals,
    );
    return rows[0] ?? null;
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET password_hash = $1, updated_at = now(),
        failed_login_count = 0, locked_until = NULL WHERE id = $2`,
      [passwordHash, userId],
    );
  }

  async recordLoginSuccess(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL,
        last_seen_at = now(), updated_at = now() WHERE id = $1`,
      [userId],
    );
  }

  async recordLoginFailure(userId: string, failedCount: number, lockedUntil: Date | null): Promise<void> {
    await this.pool.query(
      `UPDATE users SET failed_login_count = $1, locked_until = $2, updated_at = now() WHERE id = $3`,
      [failedCount, lockedUntil, userId],
    );
  }

  async touchSeen(userId: string): Promise<void> {
    await this.pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1',
      [userId],
    );
  }

  toPublicAccount(user: UserRow, profile: ProfileRow): PublicAccount {
    return {
      id: user.id,
      username: user.username,
      displayName: profile.display_name,
      avatarId: profile.avatar_id,
      emailVerified: user.email_verified_at !== null,
      createdAt: user.created_at.toISOString(),
    };
  }
}
