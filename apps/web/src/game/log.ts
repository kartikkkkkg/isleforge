/* Game log: engine events → human-readable feed entries.
   Consumes actual engine events; never invents history. */

import {
  TERRAIN_RESOURCE,
  victoryPoints,
  type GameEvent,
  type GameState,
  type ResourceType,
} from '@isleforge/game-engine';

export interface LogEntry {
  seq: number;
  text: string;
  kind:
    | 'info'
    | 'dice'
    | 'build'
    | 'trade'
    | 'card'
    | 'raider'
    | 'victory'
    | 'turn';
  playerId?: string | undefined;
}

export const RES_NAME: Record<ResourceType, string> = {
  wood: 'Wood',
  brick: 'Brick',
  grain: 'Grain',
  wool: 'Wool',
  ore: 'Ore',
};

export const CARD_NAME: Record<string, string> = {
  guardian: 'Guardian',
  trailblazer: 'Trailblazer',
  harvest: 'Harvest',
  embargo: 'Embargo',
  landmark: 'Landmark',
};

const TERRAIN_NAME: Record<string, string> = {
  forest: 'Forest',
  hills: 'Hills',
  fields: 'Fields',
  pasture: 'Pasture',
  mountains: 'Mountains',
  desert: 'Desert',
};

function resList(r: Record<ResourceType, number>): string {
  const parts = (Object.keys(r) as ResourceType[])
    .filter((k) => (r[k] ?? 0) > 0)
    .map((k) => `${r[k]} ${RES_NAME[k]}`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

const nameOf = (state: GameState, id: string | undefined): string =>
  state.players.find((p) => p.id === id)?.name ?? 'Someone';

const terrainOf = (state: GameState, tileKey: string): string => {
  const t = state.board.tiles.find((x) => x.key === tileKey);
  return t ? TERRAIN_NAME[t.terrain] ?? t.terrain : 'a tile';
};

const vpOf = (state: GameState, id: string | undefined): number => {
  const p = state.players.find((x) => x.id === id);
  return p ? victoryPoints(p, state).total : 0;
};

/** Format the full event log. Aggregates consecutive resource grants. */
export function formatLog(events: GameEvent[], state: GameState): LogEntry[] {
  // Index trade proposals so accept/decline lines can describe the deal.
  const proposals = new Map<
    string,
    { from: string; to: string; offer: string; request: string }
  >();
  for (const e of events) {
    if (e.type === 'TRADE_PROPOSED') {
      proposals.set(e.data.tradeId, {
        from: nameOf(state, e.playerId),
        to: nameOf(state, e.data.toPlayerId),
        offer: resList(e.data.offer),
        request: resList(e.data.request),
      });
    }
  }

  const out: LogEntry[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i]!;
    const who = nameOf(state, e.playerId);
    switch (e.type) {
      case 'GAME_CREATED':
        out.push({
          seq: e.seq,
          text: `Game created — ${e.data.players.length} players. Forge your archipelago!`,
          kind: 'info',
        });
        break;
      case 'TURN_STARTED':
        out.push({
          seq: e.seq,
          text: `${who}'s turn (turn ${e.data.turnNumber}).`,
          kind: 'turn',
          playerId: e.playerId,
        });
        break;
      case 'DICE_ROLLED':
        out.push({
          seq: e.seq,
          text: `${who} rolled ${e.data.d1} + ${e.data.d2} = ${e.data.total}.`,
          kind: 'dice',
          playerId: e.playerId,
        });
        break;
      case 'RESOURCE_GRANTED': {
        // Aggregate consecutive grants to the same player for the same reason.
        const acc: Record<ResourceType, number> = {
          wood: 0,
          brick: 0,
          grain: 0,
          wool: 0,
          ore: 0,
        };
        let j = i;
        while (j < events.length) {
          const ej = events[j]!;
          if (ej.type !== 'RESOURCE_GRANTED' || ej.playerId !== e.playerId) break;
          if (ej.data.reason !== e.data.reason) break;
          acc[ej.data.resource] += ej.data.amount;
          j++;
        }
        out.push({
          seq: e.seq,
          text: `${who} received ${resList(acc)}.`,
          kind: 'info',
          playerId: e.playerId,
        });
        i = j - 1;
        break;
      }
      case 'RESOURCES_DISCARDED': {
        const n = Object.values(e.data.resources).reduce(
          (a, b) => a + (b ?? 0),
          0,
        );
        out.push({
          seq: e.seq,
          text: `${who} discarded ${n} card${n === 1 ? '' : 's'}.`,
          kind: 'raider',
          playerId: e.playerId,
        });
        break;
      }
      case 'RAIDER_MOVED':
        out.push({
          seq: e.seq,
          text: `Raider moved to the ${terrainOf(state, e.data.toTileKey)}.`,
          kind: 'raider',
          playerId: e.playerId,
        });
        break;
      case 'RESOURCE_STOLEN':
        out.push({
          seq: e.seq,
          text:
            e.data.resource && e.data.amount > 0
              ? `${who} stole ${e.data.amount} ${RES_NAME[e.data.resource]} from ${nameOf(state, e.data.fromPlayerId)}.`
              : e.data.amount > 0
                ? `${who} stole from ${nameOf(state, e.data.fromPlayerId)}.`
                : `${who} found nothing to steal from ${nameOf(state, e.data.fromPlayerId)}.`,
          kind: 'raider',
          playerId: e.playerId,
        });
        break;
      case 'ROAD_BUILT':
        out.push({
          seq: e.seq,
          text: `${who} built a road${e.data.free ? ' (Trailblazer)' : ''}.`,
          kind: 'build',
          playerId: e.playerId,
        });
        break;
      case 'SETTLEMENT_BUILT':
        out.push({
          seq: e.seq,
          text: `${who} built a settlement.`,
          kind: 'build',
          playerId: e.playerId,
        });
        break;
      case 'CITY_BUILT':
        out.push({
          seq: e.seq,
          text: `${who} built a city.`,
          kind: 'build',
          playerId: e.playerId,
        });
        break;
      case 'SETUP_PLACED':
        out.push({
          seq: e.seq,
          text: `${who} placed a ${e.data.kind}.`,
          kind: 'build',
          playerId: e.playerId,
        });
        break;
      case 'CARD_PURCHASED':
        out.push({
          seq: e.seq,
          text: `${who} bought a development card.`,
          kind: 'card',
          playerId: e.playerId,
        });
        break;
      case 'CARD_PLAYED':
        out.push({
          seq: e.seq,
          text: `${who} played ${CARD_NAME[e.data.cardType] ?? e.data.cardType}.`,
          kind: 'card',
          playerId: e.playerId,
        });
        break;
      case 'BANK_TRADED':
        out.push({
          seq: e.seq,
          text: `${who} traded ${e.data.giveCount} ${RES_NAME[e.data.give]} for 1 ${RES_NAME[e.data.receive]} at the bank.`,
          kind: 'trade',
          playerId: e.playerId,
        });
        break;
      case 'TRADE_PROPOSED': {
        const p = proposals.get(e.data.tradeId);
        out.push({
          seq: e.seq,
          text: p
            ? `${p.from} offered ${p.offer} for ${p.request} to ${p.to}.`
            : `${who} proposed a trade.`,
          kind: 'trade',
          playerId: e.playerId,
        });
        break;
      }
      case 'TRADE_ACCEPTED': {
        const p = proposals.get(e.data.tradeId);
        out.push({
          seq: e.seq,
          text: p
            ? `${p.to} accepted — ${p.offer} ⇄ ${p.request}.`
            : `${who} accepted a trade.`,
          kind: 'trade',
          playerId: e.playerId,
        });
        break;
      }
      case 'TRADE_DECLINED': {
        const p = proposals.get(e.data.tradeId);
        out.push({
          seq: e.seq,
          text: p ? `${p.to} declined the trade.` : `${who} declined a trade.`,
          kind: 'trade',
          playerId: e.playerId,
        });
        break;
      }
      case 'LONGEST_ROAD_CHANGED':
        out.push({
          seq: e.seq,
          text: e.data.playerId
            ? `${nameOf(state, e.data.playerId)} claims the Longest Road! (+2 VP)`
            : 'The Longest Road is unclaimed.',
          kind: 'victory',
          playerId: e.data.playerId ?? undefined,
        });
        break;
      case 'LARGEST_ARMY_CHANGED':
        out.push({
          seq: e.seq,
          text: e.data.playerId
            ? `${nameOf(state, e.data.playerId)} commands the Largest Army! (+2 VP)`
            : 'The Largest Army is unclaimed.',
          kind: 'victory',
          playerId: e.data.playerId ?? undefined,
        });
        break;
      case 'VICTORY_ACHIEVED':
        out.push({
          seq: e.seq,
          text: `🏆 ${who} wins with ${vpOf(state, e.playerId)} victory points!`,
          kind: 'victory',
          playerId: e.playerId,
        });
        break;
      case 'PLAYER_RESIGNED':
        out.push({
          seq: e.seq,
          text: `${who} resigned.`,
          kind: 'info',
          playerId: e.playerId,
        });
        break;
      case 'GAME_ENDED':
        out.push({
          seq: e.seq,
          text: e.data.winnerId
            ? `Game over — ${nameOf(state, e.data.winnerId)} takes the archipelago.`
            : 'Game over.',
          kind: 'victory',
          playerId: e.data.winnerId ?? undefined,
        });
        break;
      default:
        break; // internal bookkeeping stays out of the feed
    }
    i++;
  }
  return out;
}

export { TERRAIN_RESOURCE };
