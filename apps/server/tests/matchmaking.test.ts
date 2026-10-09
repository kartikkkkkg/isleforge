/**
 * M7 matchmaking queue tests: join/leave, duplicates, expansion, fairness,
 * atomic formation, multi-tab.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Matchmaker, type FormedMatch } from '../src/matchmaking/queue.js';

function entry(userId: string, rating = 1000, queuedAt = 0) {
  return { userId, rating, queuedAt, gameMode: 'CASUAL' as const, connId: `c-${userId}` };
}

describe('matchmaker', () => {
  let formed: FormedMatch[];
  let mm: Matchmaker;
  beforeEach(() => {
    formed = [];
    mm = new Matchmaker(undefined, (m) => formed.push(m));
  });

  it('joins and leaves', () => {
    expect(mm.join(entry('u1'))).toBe(true);
    expect(mm.size).toBe(1);
    expect(mm.leave('u1', 'c-u1')).toBe(true);
    expect(mm.size).toBe(0);
    expect(mm.leave('u1', 'c-u1')).toBe(false);
  });

  it('prevents duplicate queue entries', () => {
    expect(mm.join(entry('u1'))).toBe(true);
    expect(mm.join(entry('u1'))).toBe(false); // ALREADY_QUEUED
    expect(mm.size).toBe(1);
  });

  it('keeps entry until last tab leaves (multi-tab)', () => {
    mm.join(entry('u1'));
    mm.join({ ...entry('u1'), connId: 'c-u1-tab2' });
    expect(mm.leave('u1', 'c-u1')).toBe(false); // tab2 still watching
    expect(mm.size).toBe(1);
    expect(mm.leave('u1', 'c-u1-tab2')).toBe(true);
    expect(mm.size).toBe(0);
  });

  it('forms a 4-player match from compatible ratings', () => {
    for (const u of ['a', 'b', 'c', 'd']) mm.join(entry(u, 1000));
    const matches = mm.tick(1000);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.userIds.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(mm.size).toBe(0);
    expect(formed).toHaveLength(1);
  });

  it('does not match incompatible ratings immediately', () => {
    mm.join(entry('low', 1000, 0));
    mm.join(entry('high', 2000, 0));
    mm.join(entry('m1', 1000, 0));
    mm.join(entry('m2', 1000, 0));
    expect(mm.tick(1000)).toHaveLength(0);
    expect(mm.size).toBe(4);
  });

  it('expands rating range with wait time', () => {
    // 1000 vs 1150: outside ±100, inside ±150 (after 30s).
    mm.join(entry('a', 1000, 0));
    mm.join(entry('b', 1150, 0));
    mm.join(entry('c', 1000, 0));
    mm.join(entry('d', 1150, 0));
    expect(mm.tick(10_000)).toHaveLength(0); // ±100: no match
    expect(mm.tick(45_000)).toHaveLength(1); // ±150: match
  });

  it('prioritizes oldest entries (fairness)', () => {
    // 5 players; the oldest should be in the formed match.
    mm.join(entry('old', 1000, 0));
    mm.join(entry('n1', 1000, 50_000));
    mm.join(entry('n2', 1000, 50_000));
    mm.join(entry('n3', 1000, 50_000));
    mm.join(entry('n4', 1000, 50_000));
    const matches = mm.tick(60_000);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.userIds).toContain('old');
    expect(mm.size).toBe(1); // one left over
  });

  it('never assigns a player to two matches (atomic)', () => {
    for (let i = 0; i < 8; i++) mm.join(entry(`u${i}`, 1000));
    const matches = mm.tick(1000);
    expect(matches).toHaveLength(2);
    const all = matches.flatMap((m) => m.userIds);
    expect(new Set(all).size).toBe(8);
  });

  it('estimates wait time', () => {
    expect(mm.estimatedWaitMs()).toBe(0);
    mm.join(entry('u1'));
    expect(mm.estimatedWaitMs()).toBeGreaterThan(0);
  });

  it('ratingRange follows the configured curve', () => {
    expect(mm.ratingRange(10_000)).toBe(100);
    expect(mm.ratingRange(45_000)).toBe(150);
    expect(mm.ratingRange(90_000)).toBe(250);
    expect(mm.ratingRange(200_000)).toBe(400);
  });
});
