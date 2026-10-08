/* SimpleBot — the LOCAL demo opponent for Milestone 2 only.
   This is NOT the Milestone 3 AI (no difficulties, no personalities, no
   strategy engine). It picks reasonable legal moves via legalCommands() so a
   human can play a full local game against 3 opponents. All legality still
   comes from the engine; the bot only *selects* among legal moves. */

import {
  legalCommands,
  type Command,
  type GameState,
  type ResourceType,
} from '@isleforge/game-engine';
import { mulberry32 } from '@isleforge/game-engine';

export interface BotRng {
  next(): number;
  int(max: number): number;
  pick<T>(arr: readonly T[]): T | undefined;
}

export function createBotRng(seed: number): BotRng {
  const r = mulberry32(seed);
  return {
    next: () => r.next(),
    int: (max: number) => r.int(max),
    pick: <T,>(arr: readonly T[]): T | undefined =>
      arr.length === 0 ? undefined : arr[r.int(arr.length)],
  };
}

const byType = (cmds: Command[], t: Command['type']): Command[] =>
  cmds.filter((c) => c.type === t);

/** Heuristic value of a resource for trade evaluation (very rough). */
const RES_VALUE: Record<ResourceType, number> = {
  wood: 1,
  brick: 1,
  grain: 1.1,
  wool: 1.1,
  ore: 1.4,
};

export function botAcceptsTrade(
  offer: Record<ResourceType, number>,
  request: Record<ResourceType, number>,
  rng: BotRng,
): boolean {
  let give = 0;
  let get = 0;
  for (const r of Object.keys(offer) as ResourceType[]) {
    give += (offer[r] ?? 0) * RES_VALUE[r];
    get += (request[r] ?? 0) * RES_VALUE[r];
  }
  // Accept fair-or-better deals, sometimes accept slightly-bad ones (personality noise).
  return get >= give * (0.85 + rng.next() * 0.3);
}

/**
 * Choose a move for a bot. Returns null when the bot has no legal move
 * (should not happen in a healthy game).
 */
export function chooseBotMove(
  state: GameState,
  playerId: string,
  rng: BotRng,
): Command | null {
  const legal = legalCommands(state, playerId).filter(
    (c) => c.type !== 'RESIGN' && c.type !== 'TRADE_PROPOSE',
  );
  if (legal.length === 0) return null;
  const pick = (t: Command['type']): Command | undefined =>
    rng.pick(byType(legal, t));

  switch (state.phase) {
    case 'setup': {
      // Settlement first, then road — legalCommands already orders placement legality.
      return (
        pick('PLACE_SETTLEMENT') ?? pick('PLACE_ROAD') ?? rng.pick(legal) ?? null
      );
    }
    case 'roll':
      return byType(legal, 'ROLL_DICE')[0] ?? null;
    case 'discard':
      // All combos are legal; prefer discarding the most abundant resources.
      return rng.pick(byType(legal, 'DISCARD_RESOURCES')) ?? null;
    case 'raider': {
      if (state.pendingSteal) {
        const steals = byType(legal, 'STEAL_RESOURCE');
        // Prefer stealing from the current leader.
        const leader = [...state.players]
          .filter((p) => !p.resigned && p.id !== playerId)
          .sort(
            (a, b) =>
              b.settlements.length * 1 +
              b.cities.length * 2 -
              (a.settlements.length * 1 + a.cities.length * 2),
          )[0];
        return (
          steals.find(
            (s) =>
              s.type === 'STEAL_RESOURCE' && s.targetPlayerId === leader?.id,
          ) ??
          rng.pick(steals) ??
          null
        );
      }
      const moves = byType(legal, 'MOVE_RAIDER');
      // Prefer tiles adjacent to opponents (steal chance) with good numbers.
      const scored = moves.map((m) => {
        if (m.type !== 'MOVE_RAIDER') return { m, s: 0 };
        const tile = state.board.tiles.find((t) => t.key === m.tileKey);
        let s = rng.next() * 2;
        if (tile && tile.number !== null) {
          const pips = 6 - Math.abs(7 - tile.number);
          s += pips;
        }
        return { m, s };
      });
      scored.sort((a, b) => b.s - a.s);
      return scored[0]?.m ?? null;
    }
    case 'play': {
      // Priority: city > settlement > road > dev card > play card > bank trade > end turn.
      const city = pick('BUILD_CITY');
      if (city) return city;
      const settlement = pick('BUILD_SETTLEMENT');
      if (settlement && rng.next() < 0.9) return settlement;
      const road = pick('BUILD_ROAD');
      if (road && rng.next() < 0.65) return road;
      if (pick('BUY_DEVELOPMENT_CARD') && rng.next() < 0.35) {
        return byType(legal, 'BUY_DEVELOPMENT_CARD')[0]!;
      }
      const plays = byType(legal, 'PLAY_DEVELOPMENT_CARD');
      if (plays.length > 0 && rng.next() < 0.3) {
        // Prefer guardian/harvest/embargo; keep landmarks (they're never "played" anyway).
        return rng.pick(plays) ?? null;
      }
      const bankTrades = byType(legal, 'TRADE_BANK');
      if (bankTrades.length > 0 && rng.next() < 0.12) {
        return rng.pick(bankTrades) ?? null;
      }
      return byType(legal, 'END_TURN')[0] ?? rng.pick(legal) ?? null;
    }
    case 'gameover':
      return null;
  }
}
