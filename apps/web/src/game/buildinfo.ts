/* Build menu data — derived from engine state + legal commands.
   The UI never reimplements rules; it only *reads* affordability and
   counts legal commands the engine already validated. */

import {
  COSTS,
  type Command,
  type GameState,
  type ResourceCount,
  type ResourceType,
} from '@isleforge/game-engine';
import { RES_NAME } from './log';

export type BuildKind = 'road' | 'settlement' | 'city' | 'devCard';

export interface BuildOption {
  kind: BuildKind;
  label: string;
  cost: ResourceCount;
  affordable: boolean;
  legalCount: number;
  enabled: boolean;
  reason: string | null;
}

const hasResources = (have: ResourceCount, cost: ResourceCount): boolean =>
  (Object.keys(cost) as ResourceType[]).every(
    (r) => (have[r] ?? 0) >= (cost[r] ?? 0),
  );

const shortfall = (have: ResourceCount, cost: ResourceCount): string => {
  const missing = (Object.keys(cost) as ResourceType[]).filter(
    (r) => (have[r] ?? 0) < (cost[r] ?? 0),
  );
  if (missing.length === 0) return '';
  return (
    'Needs ' +
    missing
      .map((r) => `${(cost[r] ?? 0) - (have[r] ?? 0)} more ${RES_NAME[r]}`)
      .join(', ')
  );
};

const COUNT_FOR: Record<BuildKind, Command['type']> = {
  road: 'BUILD_ROAD',
  settlement: 'BUILD_SETTLEMENT',
  city: 'BUILD_CITY',
  devCard: 'BUY_DEVELOPMENT_CARD',
};

const LABEL: Record<BuildKind, string> = {
  road: 'Road',
  settlement: 'Settlement',
  city: 'City',
  devCard: 'Dev Card',
};

export function buildOptions(
  state: GameState,
  playerId: string,
  legal: Command[],
): BuildOption[] {
  const me = state.players.find((p) => p.id === playerId);
  const myTurn =
    state.currentPlayerId === playerId &&
    (state.phase === 'play' || state.phase === 'roll');
  const canBuildPhase = state.phase === 'play' && state.currentPlayerId === playerId;

  return (Object.keys(COSTS) as BuildKind[]).map((kind) => {
    const cost = COSTS[kind];
    const affordable = me ? hasResources(me.resources, cost) : false;
    const legalCount = legal.filter((c) => c.type === COUNT_FOR[kind]).length;
    let reason: string | null = null;
    let enabled = false;
    if (!myTurn) {
      reason = state.phase === 'gameover' ? 'Game over' : 'Not your turn';
    } else if (state.phase !== 'play') {
      reason = 'Roll the dice first';
    } else if (!affordable) {
      reason = shortfall(me?.resources ?? ({} as ResourceCount), cost);
    } else if (legalCount === 0) {
      reason =
        kind === 'city'
          ? 'No settlements to upgrade'
          : kind === 'devCard'
            ? 'Deck is empty'
            : 'No legal placement';
    } else {
      enabled = true;
    }
    void canBuildPhase;
    return { kind, label: LABEL[kind], cost, affordable, legalCount, enabled, reason };
  });
}
