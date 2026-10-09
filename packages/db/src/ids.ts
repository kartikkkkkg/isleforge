/** Immutable server-side ID generation: usr_…, ses_…, fam_…. */
import { randomBytes } from 'node:crypto';

function base36(bytes: number): string {
  // 9 bytes -> 12 base36 chars (plenty of entropy, URL-safe, no padding).
  const buf = randomBytes(bytes);
  let n = BigInt('0x' + buf.toString('hex'));
  let out = '';
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < 12; i++) {
    out = chars[Number(n % 36n)] + out;
    n /= 36n;
  }
  return out;
}

export function newUserId(): string {
  return `usr_${base36(9)}`;
}
export function newSessionId(): string {
  return `ses_${base36(9)}`;
}
export function newFamilyId(): string {
  return `fam_${base36(9)}`;
}
export function newResetId(): string {
  return `rst_${base36(9)}`;
}
