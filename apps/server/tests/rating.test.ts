/**
 * M7 rating tests: Elo math, placement scoring, K factor, floor, determinism.
 */
import { describe, expect, it } from 'vitest';
import {
  computeDeltas,
  expectedVs,
  placementScore,
  ELO_FLOOR,
  ELO_K,
  ELO_K_PROVISIONAL,
  type EloPlayer,
} from '../src/rating/elo.js';

function players(ratings: number[], placements?: number[]): EloPlayer[] {
  return ratings.map((rating, i) => ({
    userId: `u${i}`,
    rating,
    gamesRated: 20,
    placement: placements?.[i] ?? i + 1,
  }));
}

describe('multiplayer elo', () => {
  it('computes expected scores correctly', () => {
    expect(expectedVs(1000, 1000)).toBeCloseTo(0.5, 5);
    expect(expectedVs(1200, 1000)).toBeGreaterThan(0.5);
    expect(expectedVs(1000, 1200)).toBeLessThan(0.5);
  });

  it('scores placements linearly', () => {
    expect(placementScore(1, 4)).toBe(1.0);
    expect(placementScore(2, 4)).toBeCloseTo(0.667, 2);
    expect(placementScore(3, 4)).toBeCloseTo(0.333, 2);
    expect(placementScore(4, 4)).toBe(0.0);
    expect(placementScore(1, 2)).toBe(1.0);
    expect(placementScore(2, 2)).toBe(0.0);
  });

  it('winner gains, loser loses (equal ratings)', () => {
    const deltas = computeDeltas(players([1000, 1000, 1000, 1000]));
    expect(deltas[0]!.delta).toBeGreaterThan(0); // 1st
    expect(deltas[3]!.delta).toBeLessThan(0); // 4th
    // Symmetric: winner gain ≈ loser loss magnitude.
    expect(Math.abs(deltas[0]!.delta + deltas[3]!.delta)).toBeLessThanOrEqual(2);
  });

  it('upset wins gain more than expected wins', () => {
    // 1200-rated player beats three 1000s (expected).
    const expected = computeDeltas([
      { userId: 'u0', rating: 1200, gamesRated: 20, placement: 1 },
      { userId: 'u1', rating: 1000, gamesRated: 20, placement: 2 },
      { userId: 'u2', rating: 1000, gamesRated: 20, placement: 3 },
      { userId: 'u3', rating: 1000, gamesRated: 20, placement: 4 },
    ]);
    // 1000-rated player beats three 1200s (upset).
    const upset = computeDeltas([
      { userId: 'u0', rating: 1000, gamesRated: 20, placement: 1 },
      { userId: 'u1', rating: 1200, gamesRated: 20, placement: 2 },
      { userId: 'u2', rating: 1200, gamesRated: 20, placement: 3 },
      { userId: 'u3', rating: 1200, gamesRated: 20, placement: 4 },
    ]);
    expect(upset[0]!.delta).toBeGreaterThan(expected[0]!.delta);
  });

  it('uses provisional K for new players', () => {
    const prov = computeDeltas([
      { userId: 'u0', rating: 1000, gamesRated: 5, placement: 1 },
      { userId: 'u1', rating: 1000, gamesRated: 20, placement: 4 },
    ]);
    expect(prov[0]!.k).toBe(ELO_K_PROVISIONAL);
    expect(prov[1]!.k).toBe(ELO_K);
    expect(prov[0]!.delta).toBeGreaterThan(0);
  });

  it('enforces the rating floor', () => {
    const deltas = computeDeltas([
      { userId: 'u0', rating: 105, gamesRated: 20, placement: 4 },
      { userId: 'u1', rating: 2000, gamesRated: 20, placement: 1 },
    ]);
    expect(deltas[0]!.ratingAfter).toBeGreaterThanOrEqual(ELO_FLOOR);
  });

  it('is deterministic', () => {
    const p = players([1100, 950, 1020, 1080], [2, 1, 4, 3]);
    const a = computeDeltas(p);
    const b = computeDeltas(p);
    expect(a).toEqual(b);
  });

  it('includes opponent average rating', () => {
    const deltas = computeDeltas(players([1000, 1100, 900, 1000]));
    expect(deltas[0]!.opponentAverageRating).toBe(1000); // (1100+900+1000)/3
  });
});
