/**
 * Access tokens: signed JWTs (HS256, Node crypto only — no dependency).
 * Short-lived (15 min). Claims: sub=userId, sid=sessionId, iat, exp.
 * Refresh tokens are opaque (see password.ts randomToken); only their
 * SHA-256 hash is stored server-side.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AccessTokenClaims {
  sub: string; // userId
  sid: string; // sessionId
  iat: number; // seconds
  exp: number; // seconds
}

const ACCESS_TTL_SECONDS = 15 * 60;

function base64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

export function signAccessToken(
  secret: string,
  userId: string,
  sessionId: string,
  ttlSeconds = ACCESS_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({ sub: userId, sid: sessionId, iat: now, exp: now + ttlSeconds });
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifyAccessToken(secret: string, token: string): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  let headerObj: unknown;
  let claims: unknown;
  try {
    headerObj = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof headerObj !== 'object' || headerObj === null) return null;
  const h = headerObj as Record<string, unknown>;
  if (h['alg'] !== 'HS256' || h['typ'] !== 'JWT') return null;

  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  if (typeof claims !== 'object' || claims === null) return null;
  const c = claims as Record<string, unknown>;
  if (typeof c['sub'] !== 'string' || typeof c['sid'] !== 'string') return null;
  if (typeof c['iat'] !== 'number' || typeof c['exp'] !== 'number') return null;
  const now = Math.floor(Date.now() / 1000);
  if (c['exp'] <= now) return null;
  if (c['iat'] > now + 60) return null; // clock-skew tolerance
  return { sub: c['sub'], sid: c['sid'], iat: c['iat'], exp: c['exp'] };
}

export const ACCESS_TOKEN_TTL_SECONDS = ACCESS_TTL_SECONDS;
