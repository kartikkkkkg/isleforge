/** Password resets + email verifications. Token hashes only, single-use. */
import type { Pool } from 'pg';
import { newResetId } from '../ids.js';
import type { EmailVerificationRow, PasswordResetRow } from '../types.js';

export class ResetsRepo {
  constructor(private pool: Pool) {}

  async createPasswordReset(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetRow> {
    const { rows } = await this.pool.query<PasswordResetRow>(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [newResetId(), userId, tokenHash, expiresAt],
    );
    return rows[0]!;
  }

  async findValidPasswordReset(tokenHash: string): Promise<PasswordResetRow | null> {
    const { rows } = await this.pool.query<PasswordResetRow>(
      `SELECT * FROM password_resets
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async markPasswordResetUsed(id: string): Promise<void> {
    await this.pool.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [id]);
  }

  async revokePasswordResetsForUser(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
  }

  async createEmailVerification(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<EmailVerificationRow> {
    // One pending verification per user: supersede older ones.
    await this.pool.query(
      `UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    const { rows } = await this.pool.query<EmailVerificationRow>(
      `INSERT INTO email_verifications (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [newResetId(), userId, tokenHash, expiresAt],
    );
    return rows[0]!;
  }

  async findValidEmailVerification(tokenHash: string): Promise<EmailVerificationRow | null> {
    const { rows } = await this.pool.query<EmailVerificationRow>(
      `SELECT * FROM email_verifications
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async markEmailVerificationUsed(id: string): Promise<void> {
    await this.pool.query('UPDATE email_verifications SET used_at = now() WHERE id = $1', [id]);
  }
}
