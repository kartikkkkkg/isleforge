/**
 * Rank service (M8): deterministic rank derived from rating.
 *
 * rating = skill estimate (Elo MMR)
 * rank   = competitive presentation (tier + division)
 *
 * Thresholds chosen from the M7 rating distribution (strong ~1518,
 * medium ~1000, weak ~483): most active players land in Silver–Platinum,
 * Diamond+ is genuinely elite, Grandmaster is rare.
 */

export type Tier =
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Diamond'
  | 'Master'
  | 'Grandmaster';

export interface Rank {
  tier: Tier;
  /** Division within tier: 3 (lowest) → 1 (highest). Null for Master/Grandmaster. */
  division: 1 | 2 | 3 | null;
  /** 0..1 progress toward the next division/tier. */
  progress: number;
  /** Rating needed for the next division/tier (null at max). */
  nextThreshold: number | null;
  /** True while gamesRated < 10. */
  provisional: boolean;
}

export const PROVISIONAL_GAMES = 10;

interface TierDef {
  tier: Tier;
  min: number;
  divisions: boolean;
}

const TIERS: TierDef[] = [
  { tier: 'Bronze', min: 0, divisions: true },
  { tier: 'Silver', min: 800, divisions: true },
  { tier: 'Gold', min: 1000, divisions: true },
  { tier: 'Platinum', min: 1200, divisions: true },
  { tier: 'Diamond', min: 1400, divisions: true },
  { tier: 'Master', min: 1600, divisions: false },
  { tier: 'Grandmaster', min: 1800, divisions: false },
];

/**
 * Derive rank from rating. Deterministic: same inputs → same rank.
 */
export function rankFor(rating: number, gamesRated: number): Rank {
  const provisional = gamesRated < PROVISIONAL_GAMES;
  const r = Math.max(0, Math.floor(rating));

  // Find the tier.
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (r >= TIERS[i]!.min) idx = i;
  }
  const def = TIERS[idx]!;
  const next = TIERS[idx + 1];

  if (!def.divisions || !next) {
    // Master / Grandmaster: no divisions.
    const span = next ? next.min - def.min : 200;
    const progress = next ? Math.min(1, (r - def.min) / span) : 1;
    return {
      tier: def.tier,
      division: null,
      progress,
      nextThreshold: next ? next.min : null,
      provisional,
    };
  }

  // Divisions: split the 200-point tier into thirds.
  // Division III: [min, min+67), II: [min+67, min+134), I: [min+134, next.min)
  const span = next.min - def.min;
  const third = span / 3;
  const offset = r - def.min;
  const division: 1 | 2 | 3 = offset < third ? 3 : offset < third * 2 ? 2 : 1;
  const divStart = def.min + (3 - division) * third;
  const divEnd = division === 1 ? next.min : divStart + third;
  const progress = Math.min(1, Math.max(0, (r - divStart) / (divEnd - divStart)));

  return {
    tier: def.tier,
    division,
    progress,
    nextThreshold: Math.ceil(divEnd),
    provisional,
  };
}

/** Display name: "Gold II", "Master", "Provisional Gold II". */
export function rankName(rank: Rank): string {
  const base =
    rank.division != null
      ? `${rank.tier} ${['', 'I', 'II', 'III'][rank.division]}`
      : rank.tier;
  return rank.provisional ? `Provisional ${base}` : base;
}

/** Roman numeral for division (1=I, 2=II, 3=III). */
export function divisionRoman(division: 1 | 2 | 3): string {
  return ['', 'I', 'II', 'III'][division]!;
}
