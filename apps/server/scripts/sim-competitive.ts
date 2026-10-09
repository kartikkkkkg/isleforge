/**
 * M8 competitive simulation: 1000+ players, rank distribution sanity.
 * Verifies tiers aren't absurdly concentrated.
 * Run: npx tsx scripts/sim-competitive.ts
 */
import { rankFor } from '../src/rating/rank.js';
import { computeDeltas, type EloPlayer } from '../src/rating/elo.js';

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

interface P {
  id: string;
  skill: number;
  rating: number;
  games: number;
}

const rand = rng(2026);
const players: P[] = [];
// 1000 players, skill normally distributed.
for (let i = 0; i < 1000; i++) {
  const skill = Math.min(1, Math.max(0, 0.5 + (rand() + rand() + rand() - 1.5) * 0.5));
  players.push({ id: `p${i}`, skill, rating: 1000, games: 0 });
}

// 50 rounds of games (each player ~50 games).
for (let round = 0; round < 50; round++) {
  const shuffled = [...players].sort(() => rand() - 0.5);
  for (let i = 0; i + 4 <= shuffled.length; i += 4) {
    const group = shuffled.slice(i, i + 4);
    const ordered = [...group].sort((a, b) => b.skill + rand() * 0.25 - (a.skill + rand() * 0.25));
    const inputs: EloPlayer[] = ordered.map((p, idx) => ({
      userId: p.id,
      rating: p.rating,
      gamesRated: p.games,
      placement: idx + 1,
    }));
    for (const d of computeDeltas(inputs)) {
      const p = players.find((x) => x.id === d.userId)!;
      p.rating = d.ratingAfter;
      p.games++;
    }
  }
}

// Rank distribution.
const dist: Record<string, number> = {};
for (const p of players) {
  const r = rankFor(p.rating, p.games);
  const key = r.division ? `${r.tier} ${['', 'I', 'II', 'III'][r.division]}` : r.tier;
  dist[key] = (dist[key] ?? 0) + 1;
}

console.log('Rank distribution (1000 players, ~50 games each):');
for (const [tier, count] of Object.entries(dist).sort()) {
  console.log(`  ${tier}: ${count} (${((count / 1000) * 100).toFixed(1)}%)`);
}

const gm = (dist['Grandmaster'] ?? 0) + (dist['Master'] ?? 0);
if (gm > 100) throw new Error(`Too many elite players: ${gm}/1000`);
if ((dist['Bronze III'] ?? 0) + (dist['Bronze II'] ?? 0) > 400) {
  throw new Error('Too many players stuck in Bronze');
}
console.log('\nDistribution sane: no absurd concentration.');
