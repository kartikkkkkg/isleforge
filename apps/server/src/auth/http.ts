/**
 * HTTP auth API. Hand-rolled router on the existing server (project convention:
 * no framework). All bodies are JSON, all responses are JSON.
 *
 *   POST /auth/register
 *   POST /auth/login
 *   POST /auth/logout
 *   POST /auth/refresh
 *   GET  /auth/me
 *   PATCH /auth/me
 *   GET  /auth/sessions
 *   POST /auth/logout-all
 *   POST /auth/request-password-reset
 *   POST /auth/reset-password
 *   POST /auth/verify-email
 *   POST /auth/resend-verification
 *
 * Cookies: refresh token in HttpOnly, Secure (prod), SameSite=Lax cookie.
 * Access tokens travel in the Authorization header / response bodies and are
 * kept in memory client-side — never in localStorage.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, type AuthErrorCode } from './errors.js';
import type { AuthService } from './service.js';
import { verifyAccessToken } from './tokens.js';

const REFRESH_COOKIE = 'if_refresh';
const MAX_BODY_BYTES = 16 * 1024;

export interface AuthHttpOptions {
  /** When true, cookies get Secure (production https). */
  secureCookies: boolean;
  /** Expose password-reset tokens in dev responses (no email provider). */
  devExposeResetTokens: boolean;
  /** Per-endpoint rate limit check: returns true when allowed. */
  checkRateLimit: (key: string, endpoint: string) => boolean;
  /** Resolve the client IP-ish key for rate limiting (never used as identity). */
  clientKey: (req: IncomingMessage) => string;
}

interface AuthedRequest extends IncomingMessage {
  authUserId?: string;
  authSessionId?: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendError(res: ServerResponse, code: AuthErrorCode, status: number, message?: string): void {
  sendJson(res, status, { error: code, message: message ?? code });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AuthError('INVALID_REQUEST', 'Body too large.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthError('INVALID_REQUEST', 'Malformed JSON.');
  }
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function refreshCookieHeader(token: string, opts: AuthHttpOptions, maxAgeSec: number): string {
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (opts.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

function clearCookieHeader(opts: AuthHttpOptions): string {
  const parts = [`${REFRESH_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (opts.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer (.+)$/.exec(h.trim());
  return m ? m[1]! : null;
}

export function createAuthRouter(auth: AuthService, accessSecret: string, opts: AuthHttpOptions) {
  async function requireAuth(req: AuthedRequest): Promise<void> {
    const token = bearerToken(req);
    if (!token) throw new AuthError('NOT_AUTHENTICATED');
    const claims = verifyAccessToken(accessSecret, token);
    if (!claims) throw new AuthError('INVALID_ACCESS_TOKEN');
    const ok = await auth.verifyAccess(claims.sub, claims.sid);
    if (!ok) throw new AuthError('SESSION_REVOKED');
    req.authUserId = claims.sub;
    req.authSessionId = claims.sid;
  }

  function rateLimit(req: IncomingMessage, endpoint: string, res: ServerResponse): boolean {
    const key = opts.clientKey(req);
    if (!opts.checkRateLimit(key, endpoint)) {
      sendError(res, 'RATE_LIMITED', 429, 'Too many attempts. Slow down.');
      return false;
    }
    return true;
  }

  return async function handleAuth(
    req: AuthedRequest,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/auth/')) return false;
    const path = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // ── POST /auth/register ──
      if (path === '/auth/register' && method === 'POST') {
        if (!rateLimit(req, 'register', res)) return true;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const registerInput: {
          email: string;
          username: string;
          password: string;
          displayName?: string;
          avatarId?: string;
        } = {
          email: String(body['email'] ?? ''),
          username: String(body['username'] ?? ''),
          password: String(body['password'] ?? ''),
        };
        if (body['displayName'] !== undefined) registerInput.displayName = String(body['displayName']);
        if (body['avatarId'] !== undefined) registerInput.avatarId = String(body['avatarId']);
        const account = await auth.register(registerInput);
        sendJson(res, 201, { user: account });
        return true;
      }

      // ── POST /auth/login ──
      if (path === '/auth/login' && method === 'POST') {
        if (!rateLimit(req, 'login', res)) return true;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const deviceLabel = req.headers['user-agent']?.slice(0, 120) ?? null;
        const result = await auth.login({
          login: String(body['login'] ?? ''),
          password: String(body['password'] ?? ''),
          deviceLabel,
        });
        res.setHeader(
          'Set-Cookie',
          refreshCookieHeader(result.refreshToken, opts, 30 * 24 * 60 * 60),
        );
        sendJson(res, 200, {
          user: result.user,
          accessToken: result.accessToken,
          expiresIn: result.expiresIn,
          sessionId: result.sessionId,
        });
        return true;
      }

      // ── POST /auth/logout ──
      if (path === '/auth/logout' && method === 'POST') {
        const cookies = parseCookies(req);
        const token = cookies[REFRESH_COOKIE];
        if (token) await auth.logout(token);
        res.setHeader('Set-Cookie', clearCookieHeader(opts));
        sendJson(res, 200, { ok: true });
        return true;
      }

      // ── POST /auth/refresh ──
      if (path === '/auth/refresh' && method === 'POST') {
        if (!rateLimit(req, 'refresh', res)) return true;
        const cookies = parseCookies(req);
        const token = cookies[REFRESH_COOKIE];
        if (!token) {
          sendError(res, 'INVALID_REFRESH_TOKEN', 401);
          return true;
        }
        const deviceLabel = req.headers['user-agent']?.slice(0, 120) ?? null;
        const result = await auth.refresh(token, deviceLabel);
        res.setHeader(
          'Set-Cookie',
          refreshCookieHeader(result.refreshToken, opts, 30 * 24 * 60 * 60),
        );
        sendJson(res, 200, {
          user: result.user,
          accessToken: result.accessToken,
          expiresIn: 900,
          sessionId: result.sessionId,
        });
        return true;
      }

      // ── GET /auth/me ──
      if (path === '/auth/me' && method === 'GET') {
        await requireAuth(req);
        const account = await auth.me(bearerToken(req)!);
        sendJson(res, 200, { user: account });
        return true;
      }

      // ── PATCH /auth/me ──
      if (path === '/auth/me' && method === 'PATCH') {
        if (!rateLimit(req, 'profile', res)) return true;
        await requireAuth(req);
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const patch: { displayName?: string; avatarId?: string } = {};
        if (body['displayName'] !== undefined) patch.displayName = String(body['displayName']);
        if (body['avatarId'] !== undefined) patch.avatarId = String(body['avatarId']);
        const account = await auth.updateProfile(req.authUserId!, patch);
        sendJson(res, 200, { user: account });
        return true;
      }

      // ── GET /auth/sessions ──
      if (path === '/auth/sessions' && method === 'GET') {
        await requireAuth(req);
        const sessions = await auth.listSessions(req.authUserId!);
        for (const s of sessions) {
          if (s.id === req.authSessionId) s.current = s.id;
        }
        sendJson(res, 200, { sessions });
        return true;
      }

      // ── POST /auth/logout-all ──
      if (path === '/auth/logout-all' && method === 'POST') {
        if (!rateLimit(req, 'logout_all', res)) return true;
        await requireAuth(req);
        const n = await auth.logoutAll(req.authUserId!);
        res.setHeader('Set-Cookie', clearCookieHeader(opts));
        sendJson(res, 200, { ok: true, revoked: n });
        return true;
      }

      // ── POST /auth/request-password-reset ──
      if (path === '/auth/request-password-reset' && method === 'POST') {
        if (!rateLimit(req, 'password_reset', res)) return true;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const { token } = await auth.requestPasswordReset(String(body['email'] ?? ''));
        // Never reveal whether the account exists. In dev (no email
        // provider) the token is returned so the flow can be completed.
        sendJson(res, 200, {
          ok: true,
          ...(opts.devExposeResetTokens && token ? { resetToken: token } : {}),
        });
        return true;
      }

      // ── POST /auth/reset-password ──
      if (path === '/auth/reset-password' && method === 'POST') {
        if (!rateLimit(req, 'password_reset', res)) return true;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        await auth.resetPassword(
          String(body['token'] ?? ''),
          String(body['newPassword'] ?? ''),
        );
        sendJson(res, 200, { ok: true });
        return true;
      }

      // ── POST /auth/verify-email ──
      if (path === '/auth/verify-email' && method === 'POST') {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        await auth.verifyEmail(String(body['token'] ?? ''));
        sendJson(res, 200, { ok: true });
        return true;
      }

      // ── POST /auth/resend-verification ──
      if (path === '/auth/resend-verification' && method === 'POST') {
        if (!rateLimit(req, 'verification', res)) return true;
        await requireAuth(req);
        const { token } = await auth.sendEmailVerification(req.authUserId!);
        sendJson(res, 200, {
          ok: true,
          ...(opts.devExposeResetTokens ? { verificationToken: token } : {}),
        });
        return true;
      }

      sendError(res, 'INVALID_REQUEST', 404, 'Unknown auth endpoint.');
      return true;
    } catch (err) {
      if (err instanceof AuthError) {
        // ACCOUNT_LOCKED from login: keep the generic message to avoid
        // leaking lockout state? No — the user themselves needs to know.
        // But never distinguish unknown-email from wrong-password.
        sendError(res, err.code, err.status, err.message);
      } else {
        console.error('[auth] unexpected error:', (err as Error).message);
        sendError(res, 'INTERNAL_ERROR', 500);
      }
      return true;
    }
  };
}

export const REFRESH_COOKIE_NAME = REFRESH_COOKIE;
