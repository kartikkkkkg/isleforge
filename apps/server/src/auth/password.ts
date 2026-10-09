/**
 * Password hashing with scrypt (memory-hard, built into Node's crypto).
 * Never invent a custom scheme; never log passwords or hashes.
 *
 * Envelope format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

// OWASP-ish parameters for interactive logins.
const N = 16384; // 2^14 — CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 64;
const SALTLEN = 16;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, { N, r, p }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

function scryptAsyncWithParams(
  password: string,
  salt: Buffer,
  keylen: number,
  Np: number,
  rp: number,
  pp: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, { N: Np, r: rp, p: pp }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALTLEN);
  const derived = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, envelope: string): Promise<boolean> {
  const parts = envelope.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const Np = parseInt(parts[1]!, 10);
  const rp = parseInt(parts[2]!, 10);
  const pp = parseInt(parts[3]!, 10);
  if (!Number.isFinite(Np) || !Number.isFinite(rp) || !Number.isFinite(pp)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64');
    expected = Buffer.from(parts[5]!, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scryptAsyncWithParams(password, salt, expected.length, Np, rp, pp);
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** SHA-256 hex digest for opaque tokens (refresh / reset). The raw token is never stored. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
