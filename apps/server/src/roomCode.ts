/**
 * Short, human-friendly room codes.
 *
 * 5 characters from an unambiguous alphabet (no 0/O, 1/I/L), e.g. "A7K9P".
 * Case-insensitive: codes are stored and compared uppercase.
 */

import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export function generateRoomCode(exists: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = randomBytes(ROOM_CODE_LENGTH);
    let code = '';
    for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
    if (!exists(code)) return code;
  }
  throw new Error('ROOM_CODE_EXHAUSTED');
}
