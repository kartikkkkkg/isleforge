/**
 * Deterministic seeded PRNG (mulberry32) plus small helpers.
 * All in-engine randomness flows through here so games are reproducible
 * from (seed + command sequence). Random *outcomes* are always recorded
 * in events, so replaying events never needs the RNG.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, max). */
  int(max: number): number;
  /** Integer in [min, max] inclusive. */
  intRange(min: number, max: number): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(max: number): number {
      return Math.floor(this.next() * max);
    },
    intRange(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
  };
}

/** Fisher–Yates shuffle returning a new array. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/** Pick a random element weighted by the given weights. */
export function weightedPick<T>(items: readonly T[], weights: readonly number[], rng: Rng): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i] as number;
    if (roll < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}
