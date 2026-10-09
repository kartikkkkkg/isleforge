/**
 * M7 matchmaking simulation: 1000 virtual players, deterministic seeds.
 * Measures: avg/p95 wait, rating difference, formation success, starvation,
 * duplicate assignment.
 *
 * Run: npx tsx scripts/sim-matchmaking.ts
 */
import { Matchmaker } from '../src/matchmaking/queue.js';

// Deterministic PRNG (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimPlayer {
  id: string;
  rating: number;
  joinAt: number;
  leaveAt: number | null; // abandonment
}

function run(seed: number): void {
  const rand = rng(seed);
  const mm = new Matchmaker();
  const players: SimPlayer[] = [];

  // 1000 players, ratings ~600-1800 (roughly normal around 1200).
  for (let i = 0; i < 1000; i++) {
    const r = (rand() + rand() + rand()) / 3; // 0..1, centered
    const rating = Math.round(600 + r * 1200);
    // Staggered arrivals over 5 minutes; 10% abandon after 60-120s.
    const joinAt = Math.floor(rand() * 300_000);
    const leaveAt = rand() < 0.1 ? joinAt + 60_000 + rand() * 60_000 : null;
    players.push({ id: `p${i}`, rating, joinAt, leaveAt });
  }
  players.sort((a, b) => a.joinAt - b.joinAt);

  const waits: number[] = [];
  const ratingDiffs: number[] = [];
  let formed = 0;
  let abandoned = 0;
  const assigned = new Set<string>();
  let duplicates = 0;

  let now = 0;
  let pi = 0;
  const end = 400_000;
  const step = 1000;

  while (now < end || mm.size > 0) {
    // Arrivals.
    while (pi < players.length && players[pi]!.joinAt <= now) {
      const p = players[pi]!;
      mm.join({ userId: p.id, rating: p.rating, queuedAt: now, gameMode: 'CASUAL', connId: `c-${p.id}` });
      (mm.getEntry(p.id) as unknown as { sim: SimPlayer }).sim = p;
      pi++;
    }
    // Abandonments.
    for (const p of players) {
      if (p.leaveAt !== null && p.leaveAt <= now && mm.getEntry(p.id)) {
        mm.remove(p.id);
        abandoned++;
        p.leaveAt = null; // count once
      }
    }
    // Tick.
    const matches = mm.tick(now);
    for (const m of matches) {
      formed++;
      for (const uid of m.userIds) {
        if (assigned.has(uid)) duplicates++;
        assigned.add(uid);
      }
      const ratings = m.userIds.map((uid) => {
        const p = players.find((x) => x.id === uid)!;
        waits.push(now - p.joinAt);
        return p.rating;
      });
      ratingDiffs.push(Math.max(...ratings) - Math.min(...ratings));
    }
    now += step;
    if (now > end && mm.size === 0) break;
    if (now > 600_000) break; // safety
  }

  waits.sort((a, b) => a - b);
  const avg = waits.reduce((a, b) => a + b, 0) / Math.max(waits.length, 1);
  const p95 = waits[Math.floor(waits.length * 0.95)] ?? 0;
  const avgDiff = ratingDiffs.reduce((a, b) => a + b, 0) / Math.max(ratingDiffs.length, 1);
  const maxDiff = Math.max(...ratingDiffs, 0);

  console.log(`seed ${seed}:`);
  console.log(`  matches formed: ${formed} (${formed * 4} players)`);
  console.log(`  avg wait: ${(avg / 1000).toFixed(1)}s, p95: ${(p95 / 1000).toFixed(1)}s`);
  console.log(`  avg rating spread per match: ${avgDiff.toFixed(0)}, max: ${maxDiff}`);
  console.log(`  abandoned: ${abandoned}, duplicates: ${duplicates}`);
  console.log(`  success rate: ${((formed * 4) / 1000 * 100).toFixed(1)}% of players matched`);

  if (duplicates > 0) throw new Error('DUPLICATE ASSIGNMENT DETECTED');
  if (p95 > 180_000) throw new Error('P95 wait too high — starvation?');
}

for (const seed of [1, 2, 3]) run(seed);
console.log('\nAll matchmaking simulations passed.');
