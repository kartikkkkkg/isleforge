/**
 * Input validation for auth endpoints. Every request is validated;
 * every failure returns a typed AuthErrorCode.
 */
import type { AuthErrorCode } from './errors.js';

export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'system',
  'moderator',
  'mod',
  'support',
  'help',
  'isleforge',
  'official',
  'staff',
  'owner',
  'root',
  'api',
  'bot',
  'server',
]);

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): AuthErrorCode | null {
  const e = email.trim();
  if (e.length === 0 || e.length > 254) return 'INVALID_EMAIL';
  if (!EMAIL_RE.test(e)) return 'INVALID_EMAIL';
  return null;
}

export function validateUsername(username: string): AuthErrorCode | null {
  const u = username.trim();
  if (!USERNAME_RE.test(u)) return 'INVALID_USERNAME';
  if (RESERVED_USERNAMES.has(u.toLowerCase())) return 'USERNAME_RESERVED';
  if (/^[_]+$/.test(u)) return 'INVALID_USERNAME';
  return null;
}

export function validateDisplayName(displayName: string): AuthErrorCode | null {
  const d = displayName.trim();
  // No control characters, reasonable length, not blank.
  if (d.length < 1 || d.length > 32) return 'INVALID_DISPLAY_NAME';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(d)) return 'INVALID_DISPLAY_NAME';
  return null;
}

/** Built-in avatar ids (original geometric set). No marketplace in M5. */
export const AVATAR_IDS = [
  'compass',
  'anchor',
  'kraken',
  'lighthouse',
  'helm',
  'map',
  'flag',
  'wave',
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export function validateAvatarId(avatarId: string): AuthErrorCode | null {
  if (!(AVATAR_IDS as readonly string[]).includes(avatarId)) return 'INVALID_AVATAR';
  return null;
}

export interface PasswordCheck {
  ok: boolean;
  code: 'WEAK_PASSWORD' | null;
  reasons: string[];
}

/** Password strength: length + character variety. Not a meter UI — a gate. */
export function validatePassword(password: string): PasswordCheck {
  const reasons: string[] = [];
  if (password.length < 10) reasons.push('at least 10 characters');
  if (password.length > 128) reasons.push('at most 128 characters');
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3) reasons.push('3 of: lowercase, uppercase, digit, symbol');
  if (/\s/.test(password)) reasons.push('no whitespace');
  return reasons.length === 0
    ? { ok: true, code: null, reasons }
    : { ok: false, code: 'WEAK_PASSWORD', reasons };
}
