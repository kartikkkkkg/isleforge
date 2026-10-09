/**
 * Security audit log. Records auth events WITHOUT secrets: never passwords,
 * hashes, access/refresh/reset tokens, or auth headers. Tests assert this.
 */
import type { Pool } from 'pg';

export type AuthAuditEvent =
  | 'register'
  | 'login_success'
  | 'login_failure'
  | 'login_locked'
  | 'logout'
  | 'logout_all'
  | 'refresh'
  | 'refresh_reuse_detected'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'email_verification_sent'
  | 'email_verified'
  | 'profile_updated';

const SECRET_KEYS = ['password', 'passwordHash', 'password_hash', 'token', 'accessToken', 'refreshToken', 'resetToken', 'authorization'];

export function assertNoSecrets(details: Record<string, unknown>): void {
  for (const key of Object.keys(details)) {
    const lower = key.toLowerCase();
    if (SECRET_KEYS.some((s) => lower.includes(s.toLowerCase()))) {
      throw new Error(`Refusing to audit-log secret-bearing key: ${key}`);
    }
    const val = details[key];
    if (typeof val === 'string' && val.length >= 32 && /^[A-Za-z0-9\-_+/=]+$/.test(val)) {
      throw new Error(`Refusing to audit-log token-like value for key: ${key}`);
    }
  }
}

export class AuditRepo {
  constructor(private pool: Pool) {}

  async log(
    event: AuthAuditEvent,
    userId: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    assertNoSecrets(details);
    await this.pool.query(
      `INSERT INTO auth_audit_log (user_id, event, details) VALUES ($1, $2, $3)`,
      [userId, event, JSON.stringify(details)],
    );
  }
}
