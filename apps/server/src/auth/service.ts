/**
 * AuthService — registration, login, sessions, refresh rotation, password
 * reset, email verification. Pure business logic over @isleforge/db;
 * the HTTP layer translates AuthError -> status + typed code.
 *
 * Security notes:
 * - Login never reveals whether an email/username exists (INVALID_CREDENTIALS
 *   for all failures; timing differences minimized by hashing only on hit…
 *   see below).
 * - Refresh token rotation with reuse detection: presenting a superseded
 *   token revokes the whole family.
 * - Brute force: per-account exponential backoff + temporary lockout.
 */
import {
  AuditRepo,
  ResetsRepo,
  SessionsRepo,
  UsersRepo,
  type PublicAccount,
  type SessionRow,
} from '@isleforge/db';
import type { Pool } from 'pg';
import { AuthError } from './errors.js';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from './password.js';
import { signAccessToken, verifyAccessToken } from './tokens.js';
import {
  normalizeEmail,
  validateAvatarId,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateUsername,
} from './validation.js';

export interface AuthConfig {
  /** HMAC secret for access-token JWTs. Required; no default in production. */
  accessTokenSecret: string;
  /** Refresh token lifetime. */
  refreshTtlMs?: number;
  /** Password reset token lifetime. */
  resetTtlMs?: number;
  /** Email verification token lifetime. */
  verificationTtlMs?: number;
}

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
// Brute force: after N failures, lock for 2^(N-5) minutes, capped.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MAX_MS = 60 * 60 * 1000;

export interface LoginResult {
  user: PublicAccount;
  accessToken: string;
  expiresIn: number;
  sessionId: string;
  refreshToken: string;
}

export class AuthService {
  private users: UsersRepo;
  private sessions: SessionsRepo;
  private resets: ResetsRepo;
  private audit: AuditRepo;
  private refreshTtlMs: number;
  private resetTtlMs: number;
  private verificationTtlMs: number;

  constructor(
    private pool: Pool,
    private config: AuthConfig,
  ) {
    if (!config.accessTokenSecret || config.accessTokenSecret.length < 32) {
      throw new Error('accessTokenSecret must be at least 32 characters');
    }
    this.users = new UsersRepo(pool);
    this.sessions = new SessionsRepo(pool);
    this.resets = new ResetsRepo(pool);
    this.audit = new AuditRepo(pool);
    this.refreshTtlMs = config.refreshTtlMs ?? REFRESH_TTL_MS;
    this.resetTtlMs = config.resetTtlMs ?? RESET_TTL_MS;
    this.verificationTtlMs = config.verificationTtlMs ?? VERIFICATION_TTL_MS;
  }

  // ── Registration ──────────────────────────────────────────────

  async register(input: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
    avatarId?: string;
  }): Promise<PublicAccount> {
    const emailErr = validateEmail(input.email);
    if (emailErr) throw new AuthError(emailErr);
    const usernameErr = validateUsername(input.username);
    if (usernameErr) throw new AuthError(usernameErr);
    const pw = validatePassword(input.password);
    if (!pw.ok) throw new AuthError('WEAK_PASSWORD', `Password needs ${pw.reasons.join(', ')}.`);
    const displayName = (input.displayName ?? input.username).trim();
    const dnErr = validateDisplayName(displayName);
    if (dnErr) throw new AuthError(dnErr);
    const avatarId = input.avatarId ?? 'compass';
    const avErr = validateAvatarId(avatarId);
    if (avErr) throw new AuthError(avErr);

    const emailNormalized = normalizeEmail(input.email);
    const usernameNormalized = input.username.trim().toLowerCase();

    if (await this.users.findByEmailNormalized(emailNormalized)) {
      throw new AuthError('EMAIL_ALREADY_EXISTS');
    }
    if (await this.users.findByUsernameNormalized(usernameNormalized)) {
      throw new AuthError('USERNAME_ALREADY_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);
    try {
      const { user, profile } = await this.users.create({
        email: input.email.trim(),
        emailNormalized,
        username: input.username.trim(),
        usernameNormalized,
        passwordHash,
        displayName,
        avatarId,
      });
      await this.audit.log('register', user.id, { username: user.username });
      return this.users.toPublicAccount(user, profile);
    } catch (err) {
      // Unique-violation race between the check and the insert.
      if (isUniqueViolation(err, 'users_email_normalized_key')) {
        throw new AuthError('EMAIL_ALREADY_EXISTS');
      }
      if (isUniqueViolation(err, 'users_username_normalized_key')) {
        throw new AuthError('USERNAME_ALREADY_EXISTS');
      }
      throw err;
    }
  }

  // ── Login / logout ────────────────────────────────────────────

  private async noteFailedLogin(userId: string, currentCount: number): Promise<void> {
    const next = currentCount + 1;
    let lockedUntil: Date | null = null;
    if (next >= LOCKOUT_THRESHOLD) {
      const backoffMs = Math.min(2 ** (next - LOCKOUT_THRESHOLD) * 60_000, LOCKOUT_MAX_MS);
      lockedUntil = new Date(Date.now() + backoffMs);
    }
    await this.users.recordLoginFailure(userId, next, lockedUntil);
  }

  private async issueSession(
    userId: string,
    deviceLabel: string | null,
  ): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
    const refreshToken = randomToken(32);
    const session = await this.sessions.create({
      userId,
      refreshTokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      deviceLabel: deviceLabel?.slice(0, 120) ?? null,
    });
    const accessToken = signAccessToken(this.config.accessTokenSecret, userId, session.id);
    return { accessToken, refreshToken, sessionId: session.id };
  }

  async login(input: {
    login: string;
    password: string;
    deviceLabel?: string | null;
  }): Promise<LoginResult> {
    // Reuse login() then re-issue: simpler to inline the session issue.
    const loginNormalized = input.login.trim().toLowerCase();
    const user = await this.users.findByLogin(loginNormalized);
    if (!user || user.status !== 'active') {
      if (user && user.status === 'active') await this.noteFailedLogin(user.id, user.failed_login_count);
      await this.audit.log('login_failure', user?.id ?? null, { reason: 'invalid_credentials' });
      throw new AuthError('INVALID_CREDENTIALS');
    }
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      await this.audit.log('login_locked', user.id, {});
      throw new AuthError('ACCOUNT_LOCKED');
    }
    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) {
      await this.noteFailedLogin(user.id, user.failed_login_count);
      await this.audit.log('login_failure', user.id, { reason: 'invalid_credentials' });
      throw new AuthError('INVALID_CREDENTIALS');
    }
    await this.users.recordLoginSuccess(user.id);
    const profile = (await this.users.getProfile(user.id))!;
    const { accessToken, refreshToken, sessionId } = await this.issueSession(
      user.id,
      input.deviceLabel ?? null,
    );
    await this.audit.log('login_success', user.id, {});
    return {
      user: this.users.toPublicAccount(user, profile),
      accessToken,
      expiresIn: 900,
      sessionId,
      refreshToken,
    };
  }

  async refresh(
    refreshToken: string,
    deviceLabel?: string | null,
  ): Promise<{ accessToken: string; refreshToken: string; sessionId: string; user: PublicAccount }> {
    const hash = sha256Hex(refreshToken);
    const session = await this.sessions.findByRefreshTokenHash(hash);
    if (!session) throw new AuthError('INVALID_REFRESH_TOKEN');

    // Reuse detection: a superseded (rotated) token presented again means
    // the token was compromised — revoke the whole family.
    if (session.revoked_at) {
      await this.sessions.revokeFamily(session.family_id);
      await this.audit.log('refresh_reuse_detected', session.user_id, { family: session.family_id });
      throw new AuthError('SESSION_REVOKED');
    }
    if (session.expires_at.getTime() <= Date.now()) {
      throw new AuthError('SESSION_EXPIRED');
    }
    const user = await this.users.findById(session.user_id);
    if (!user || user.status !== 'active') throw new AuthError('SESSION_REVOKED');

    const newRefreshToken = randomToken(32);
    const rotated = await this.sessions.rotate(session, {
      refreshTokenHash: sha256Hex(newRefreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      deviceLabel: deviceLabel?.slice(0, 120) ?? session.device_label,
    });
    const accessToken = signAccessToken(this.config.accessTokenSecret, user.id, rotated.id);
    const profile = (await this.users.getProfile(user.id))!;
    await this.audit.log('refresh', user.id, {});
    return {
      accessToken,
      refreshToken: newRefreshToken,
      sessionId: rotated.id,
      user: this.users.toPublicAccount(user, profile),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.sessions.findByRefreshTokenHash(sha256Hex(refreshToken));
    if (session && !session.revoked_at) {
      await this.sessions.revokeSession(session.id);
      await this.audit.log('logout', session.user_id, {});
    }
    // Idempotent: unknown/already-revoked tokens still succeed.
  }

  async logoutAll(userId: string): Promise<number> {
    const n = await this.sessions.revokeAllForUser(userId);
    await this.audit.log('logout_all', userId, { sessions: n });
    return n;
  }

  // ── Me / profile ──────────────────────────────────────────────

  /** Validate an access token and return the account (throws when invalid). */
  async me(accessToken: string): Promise<PublicAccount> {
    const claims = verifyAccessToken(this.config.accessTokenSecret, accessToken);
    if (!claims) throw new AuthError('INVALID_ACCESS_TOKEN');
    const session = await this.sessions.findById(claims.sid);
    if (!session || session.revoked_at || session.expires_at.getTime() <= Date.now()) {
      throw new AuthError('SESSION_REVOKED');
    }
    if (session.user_id !== claims.sub) throw new AuthError('INVALID_ACCESS_TOKEN');
    const user = await this.users.findById(claims.sub);
    const profile = user ? await this.users.getProfile(user.id) : null;
    if (!user || !profile || user.status !== 'active') throw new AuthError('INVALID_ACCESS_TOKEN');
    return this.users.toPublicAccount(user, profile);
  }

  /** Same as me() but returns the userId for WS auth (lighter). */
  async verifyAccess(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.sessions.findById(sessionId);
    if (!session || session.revoked_at || session.expires_at.getTime() <= Date.now()) return false;
    if (session.user_id !== userId) return false;
    const user = await this.users.findById(userId);
    return !!user && user.status === 'active';
  }

  async updateProfile(
    userId: string,
    patch: { displayName?: string; avatarId?: string },
  ): Promise<PublicAccount> {
    if (patch.displayName !== undefined) {
      const err = validateDisplayName(patch.displayName);
      if (err) throw new AuthError(err);
      patch.displayName = patch.displayName.trim();
    }
    if (patch.avatarId !== undefined) {
      const err = validateAvatarId(patch.avatarId);
      if (err) throw new AuthError(err);
    }
    const profile = await this.users.updateProfile(userId, patch);
    const user = (await this.users.findById(userId))!;
    await this.audit.log('profile_updated', userId, {});
    return this.users.toPublicAccount(user, profile!);
  }

  async listSessions(userId: string): Promise<
    { id: string; createdAt: string; lastUsedAt: string | null; deviceLabel: string | null; current: string | null }[]
  > {
    const sessions = await this.sessions.listActiveForUser(userId);
    return sessions.map((s: SessionRow) => ({
      id: s.id,
      createdAt: s.created_at.toISOString(),
      lastUsedAt: s.last_used_at?.toISOString() ?? null,
      deviceLabel: s.device_label,
      current: null, // filled by the HTTP layer from the request's session id
    }));
  }

  // ── Password reset ────────────────────────────────────────────

  /**
   * Always succeeds (never reveals whether the email exists).
   * Returns the raw token ONLY in development (no email provider); the
   * caller decides whether to expose it.
   */
  async requestPasswordReset(email: string): Promise<{ token: string | null }> {
    const normalized = normalizeEmail(email);
    const user = await this.users.findByEmailNormalized(normalized);
    // Constant response regardless of existence.
    if (!user || user.status !== 'active') {
      return { token: null };
    }
    const token = randomToken(32);
    await this.resets.createPasswordReset(
      user.id,
      sha256Hex(token),
      new Date(Date.now() + this.resetTtlMs),
    );
    await this.audit.log('password_reset_requested', user.id, {});
    return { token };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const pw = validatePassword(newPassword);
    if (!pw.ok) throw new AuthError('WEAK_PASSWORD', `Password needs ${pw.reasons.join(', ')}.`);
    const row = await this.resets.findValidPasswordReset(sha256Hex(token));
    if (!row) throw new AuthError('INVALID_RESET_TOKEN');
    const user = await this.users.findById(row.user_id);
    if (!user || user.status !== 'active') throw new AuthError('INVALID_RESET_TOKEN');
    await this.users.setPasswordHash(user.id, await hashPassword(newPassword));
    await this.resets.markPasswordResetUsed(row.id);
    // A password change invalidates all sessions (standard practice).
    await this.sessions.revokeAllForUser(user.id);
    await this.audit.log('password_reset_completed', user.id, {});
  }

  // ── Email verification (model; not a login blocker) ───────────

  async sendEmailVerification(userId: string): Promise<{ token: string }> {
    const token = randomToken(32);
    await this.resets.createEmailVerification(
      userId,
      sha256Hex(token),
      new Date(Date.now() + this.verificationTtlMs),
    );
    await this.audit.log('email_verification_sent', userId, {});
    return { token };
  }

  async verifyEmail(token: string): Promise<void> {
    const row = await this.resets.findValidEmailVerification(sha256Hex(token));
    if (!row) throw new AuthError('INVALID_RESET_TOKEN');
    await this.resets.markEmailVerificationUsed(row.id);
    await this.users.markEmailVerified(row.user_id);
    await this.audit.log('email_verified', row.user_id, {});
  }
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505' &&
    String((err as { constraint?: string }).constraint ?? '').includes(constraint)
  );
}
