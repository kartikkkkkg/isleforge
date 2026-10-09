/**
 * M7 rating simulation: strong/medium/weak players over many games.
 * Strong should rise, weak should fall, ratings should stabilize.
 * Deterministic seeds. Run: npx tsx scripts/sim-rating.ts
 */
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

interface SimPlayer {
  id: string;
  skill: number; // 0..1 true skill
  rating: number;
  gamesRated: number;
}

function run(seed: number): void {
  const rand = rng(seed);
  const players: SimPlayer[] = [];
  // 12 strong (skill 0.8), 24 medium (0.5), 12 weak (0.2). All start at 1000.
  for (let i = 0; i < 12; i++) players.push({ id: `s${i}`, skill: 0.8, rating: 1000, gamesRated: 0 });
  for (let i = 0; i < 24; i++) players.push({ id: `m${i}`, skill: 0.5, rating: 1000, gamesRated: 0 });
  for (let i = 0; i < 12; i++) players.push({ id: `w${i}`, skill: 0.2, rating: 1000, gamesRated: 0 });

  const GAMES = 200;
  for (let g = 0; g < GAMES; g++) {
    // Random 4-player groups.
    const shuffled = [...players].sort(() => rand() - 0.5);
    for (let i = 0; i + 4 <= shuffled.length; i += 4) {
      const group = shuffled.slice(i, i + 4);
      // Placement by skill + noise.
      const ordered = [...group].sort(
        (a, b) => b.skill + rand() * 0.3 - (a.skill + rand() * 0.3),
      );
      const eloInputs: EloPlayer[] = ordered.map((p, idx) => ({
        userId: p.id,
        rating: p.rating,
        gamesRated: p.gamesRated,
        placement: idx + 1,
      }));
      const deltas = computeDeltas(eloInputs);
      for (const d of deltas) {
        const p = players.find((x) => x.id === d.userId)!;
        p.rating = d.ratingAfter;
        p.gamesRated++;
      }
    }
  }

  const avg = (ps: SimPlayer[]): number =>
    ps.reduce((a, p) => a + p.rating, 0) / ps.length;
  const strong = players.filter((p) => p.id.startsWith('s'));
  const medium = players.filter((p) => p.id.startsWith('m'));
  const weak = players.filter((p) => p.id.startsWith('w'));
  const avgS = avg(strong);
  const avgM = avg(medium);
  const avgW = avg(weak);

  console.log(`seed ${seed}: strong=${avgS.toFixed(0)} medium=${avgM.toFixed(0)} weak=${avgW.toFixed(0)}`);

  if (!(avgS > avgM && avgM > avgW)) {
    throw new Error(`Rating ordering violated: ${avgS} / ${avgM} / ${avgW}`);
  }
  if (avgS < 1050) throw new Error('Strong players did not rise enough');
  if (avgW > 950) throw new Error('Weak players did not fall enough');
  // No pathological values.
  for (const p of players) {
    if (p.rating < 100 || p.rating > 3000) throw new Error(`Pathological rating: ${p.rating}`);
  }
}

for (const seed of [7, 42, 99]) run(seed);
console.log('\nAll rating simulations passed: strong rise, weak fall, no pathology.');
