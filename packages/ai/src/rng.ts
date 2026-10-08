/**
 * Deterministic RNG for the AI package. Wraps the engine's mulberry32 so
 * decisions are reproducible for a fixed seed. Never Math.random().
 */

import { mulberry32 } from '@isleforge/game-engine';
import type { RandomSource } from './types.js';

export function createRng(seed: number): RandomSource {
  const r = mulberry32(seed >>> 0);
  return {
    next: () => r.next(),
    int: (max: number) => r.int(max),
    pick: <T>(arr: readonly T[]): T | undefined =>
      arr.length === 0 ? undefined : arr[r.int(arr.length)],
    shuffle: <T>(arr: readonly T[]): T[] => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = r.int(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}
