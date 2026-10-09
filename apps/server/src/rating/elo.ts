/**
 * Multiplayer Elo rating (M7).
 *
 * For each player i in an N-player game:
 *
 *   expected_i = (1 / (N-1)) * Σ_{j≠i} 1 / (1 + 10^((Rj - Ri) / 400))
 *   actual_i   = 1 - (placement_i - 1) / (N - 1)     // 1st → 1.0 … last → 0.0
 *   delta_i    = K * (actual_i - expected_i)
 *
 * K = 32 normally, 48 for provisional players (first 10 rated games).
 * Ratings are rounded to integers and floored at 100.
 *
 * Deterministic: same inputs → same outputs. No randomness.
 */

export const ELO_K = 32;
export const ELO_K_PROVISIONAL = 48;
export const PROVISIONAL_GAMES = 10;
export const ELO_FLOOR = 100;
export const ELO_INITIAL = 1000;

export interface EloPlayer {
  userId: string;
  rating: number;
  gamesRated: number;
  placement: number; // 1-based
}

/** Expected score for player A against player B (standard Elo). */
export function expectedVs(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** Actual score from finishing placement in an N-player game. */
export function placementScore(placement: number, playerCount: number): number {
  if (playerCount <= 1) return 1;
  const p = Math.min(Math.max(placement, 1), playerCount);
  return 1 - (p - 1) / (playerCount - 1);
}

export interface EloDelta {
  userId: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  expected: number;
  actual: number;
  k: number;
  opponentAverageRating: number;
}

/**
 * Compute rating deltas for all players. Zero-sum in expectation
 * (approximately; rounding may leave ±1).
 */
export function computeDeltas(players: EloPlayer[]): EloDelta[] {
  const n = players.length;
  return players.map((p) => {
    const k = p.gamesRated < PROVISIONAL_GAMES ? ELO_K_PROVISIONAL : ELO_K;
    let expected = 0;
    let oppSum = 0;
    for (const o of players) {
      if (o.userId === p.userId) continue;
      expected += expectedVs(p.rating, o.rating);
      oppSum += o.rating;
    }
    expected = n > 1 ? expected / (n - 1) : 0.5;
    const actual = placementScore(p.placement, n);
    const delta = Math.round(k * (actual - expected));
    const ratingAfter = Math.max(ELO_FLOOR, p.rating + delta);
    return {
      userId: p.userId,
      ratingBefore: p.rating,
      ratingAfter,
      delta: ratingAfter - p.rating,
      expected,
      actual,
      k,
      opponentAverageRating: n > 1 ? Math.round(oppSum / (n - 1)) : p.rating,
    };
  });
}
