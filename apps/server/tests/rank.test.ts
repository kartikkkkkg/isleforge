/**
 * M8 rank tests: tiers, divisions, provisional, determinism.
 */
import { describe, expect, it } from 'vitest';
import { rankFor, rankName } from '../src/rating/rank.js';

describe('rank service', () => {
  it('assigns tiers by threshold', () => {
    expect(rankFor(500, 20).tier).toBe('Bronze');
    expect(rankFor(850, 20).tier).toBe('Silver');
    expect(rankFor(1100, 20).tier).toBe('Gold');
    expect(rankFor(1300, 20).tier).toBe('Platinum');
    expect(rankFor(1500, 20).tier).toBe('Diamond');
    expect(rankFor(1700, 20).tier).toBe('Master');
    expect(rankFor(1900, 20).tier).toBe('Grandmaster');
  });

  it('assigns divisions within tiers', () => {
    expect(rankFor(800, 20).division).toBe(3); // Silver III (bottom)
    expect(rankFor(900, 20).division).toBe(2); // Silver II
    expect(rankFor(970, 20).division).toBe(1); // Silver I (top)
  });

  it('has no divisions for Master/Grandmaster', () => {
    expect(rankFor(1700, 20).division).toBeNull();
    expect(rankFor(1900, 20).division).toBeNull();
  });

  it('marks provisional players', () => {
    const r = rankFor(1100, 5);
    expect(r.provisional).toBe(true);
    expect(rankName(r)).toBe('Provisional Gold II');
    expect(rankFor(1100, 10).provisional).toBe(false);
  });

  it('formats rank names', () => {
    expect(rankName(rankFor(1100, 20))).toBe('Gold II');
    expect(rankName(rankFor(1700, 20))).toBe('Master');
  });

  it('computes progress toward next tier', () => {
    const r = rankFor(1100, 20);
    expect(r.progress).toBeGreaterThanOrEqual(0);
    expect(r.progress).toBeLessThanOrEqual(1);
    expect(r.nextThreshold).toBeGreaterThan(1100);
  });

  it('is deterministic', () => {
    expect(rankFor(1147, 38)).toEqual(rankFor(1147, 38));
  });
});
