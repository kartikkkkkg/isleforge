/**
 * Event application: the ONLY way game state mutates.
 * applyEvent(state, event) is a pure reducer over plain data — no RNG, no IO.
 * Replaying the event log from a blank state reconstructs the exact game.
 */

import { generateBoard } from './board.js';
import {
  activePlayers,
  blankState,
  freshPlayer,
  initialBank,
  initialDevDeck,
  nextActivePlayerId,
} from './state.js';
import {
  EngineError,
  emptyResources,
  type GameEvent,
  type GameState,
  type PlayerState,
} from './types.js';
import { victoryPoints } from './scoring.js';

function player(state: GameState, playerId: string | undefined): PlayerState {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) throw new EngineError('UNKNOWN_PLAYER', `Unknown player: ${playerId}`);
  return p;
}

function addToBank(state: GameState, resources: Record<string, number>): void {
  for (const [r, n] of Object.entries(resources)) {
    const k = r as keyof typeof state.bank;
    state.bank[k] += n as number;
  }
}

function subFromBank(state: GameState, resources: Record<string, number>): void {
  for (const [r, n] of Object.entries(resources)) {
    const k = r as keyof typeof state.bank;
    state.bank[k] -= n as number;
  }
}

/** Advance the setup cursor past resigned players. */
function advanceSetup(state: GameState): void {
  const setup = state.setup;
  if (!setup) return;
  for (;;) {
    if (setup.cursor >= setup.order.length) {
      state.setup = null;
      return;
    }
    const pid = setup.order[setup.cursor] as string;
    const p = state.players.find((pl) => pl.id === pid);
    if (p && !p.resigned) return;
    setup.cursor++;
  }
}

export function applyEvent(state: GameState, event: GameEvent): void {
  switch (event.type) {
    case 'GAME_CREATED': {
      const fresh = blankState();
      const { seed, mapId, players } = event.data;
      fresh.seed = seed;
      fresh.mapId = mapId;
      fresh.board = generateBoard(seed, mapId);
      fresh.players = players.map((p) => freshPlayer(p.id, p.name, p.color));
      fresh.playerOrder = players.map((p) => p.id);
      fresh.bank = initialBank();
      fresh.devDeck = initialDevDeck(seed);
      const desert = fresh.board.tiles.find((t) => t.terrain === 'desert');
      fresh.raiderTileKey = desert ? desert.key : fresh.board.tiles[0]?.key ?? '';
      fresh.phase = 'setup';
      const order = [...fresh.playerOrder, ...[...fresh.playerOrder].reverse()];
      fresh.setup = { order, cursor: 0, expecting: 'settlement' };
      fresh.currentPlayerId = order[0] ?? null;
      Object.assign(state, fresh);
      return;
    }

    case 'TURN_STARTED': {
      const p = player(state, event.playerId);
      state.currentPlayerId = p.id;
      state.turnNumber = event.data.turnNumber;
      state.phase = 'roll';
      state.dice = null;
      state.raiderReason = null;
      state.devCardPlayedThisTurn = false;
      for (const pl of state.players) {
        for (const card of pl.devCards) card.playable = true;
      }
      return;
    }

    case 'TURN_PHASE_CHANGED': {
      state.phase = event.data.phase;
      if (event.data.phase !== 'raider') state.raiderReason = null;
      if (event.data.phase !== 'discard') state.pendingDiscards = null;
      return;
    }

    case 'SETUP_PLACED': {
      const p = player(state, event.playerId);
      const setup = state.setup;
      if (!setup) throw new EngineError('INVALID_SETUP', 'Setup is not active');
      if (event.data.kind === 'settlement') {
        p.settlements.push(event.data.cornerId as string);
        setup.expecting = 'road';
      } else {
        p.roads.push(event.data.edgeId as string);
        setup.cursor++;
        setup.expecting = 'settlement';
        advanceSetup(state);
      }
      return;
    }

    case 'DICE_ROLLED': {
      state.dice = [event.data.d1, event.data.d2];
      if (event.data.total === 7) state.raiderReason = 'dice';
      return;
    }

    case 'RESOURCE_GRANTED': {
      const p = player(state, event.playerId);
      p.resources[event.data.resource] += event.data.amount;
      state.bank[event.data.resource] -= event.data.amount;
      return;
    }

    case 'RESOURCES_PAID': {
      const p = player(state, event.playerId);
      for (const [r, n] of Object.entries(event.data.resources)) {
        const k = r as keyof typeof p.resources;
        p.resources[k] -= n as number;
      }
      addToBank(state, event.data.resources);
      return;
    }

    case 'DISCARDS_REQUIRED': {
      state.pendingDiscards = { ...event.data.required };
      return;
    }

    case 'RESOURCES_DISCARDED': {
      const p = player(state, event.playerId);
      for (const [r, n] of Object.entries(event.data.resources)) {
        const k = r as keyof typeof p.resources;
        p.resources[k] -= n as number;
      }
      addToBank(state, event.data.resources);
      if (state.pendingDiscards && event.playerId) {
        delete state.pendingDiscards[event.playerId];
        if (Object.keys(state.pendingDiscards).length === 0) state.pendingDiscards = null;
      }
      return;
    }

    case 'RAIDER_MOVED': {
      state.raiderTileKey = event.data.toTileKey;
      // Determine whether a steal is owed: any adjacent opponent building?
      const tile = state.board.tileByKey[event.data.toTileKey];
      let steal = false;
      if (tile) {
        const owners = buildingOwners(state);
        for (const [cornerId, owner] of owners) {
          const corner = state.board.corners[cornerId];
          if (
            corner &&
            corner.tiles.includes(tile.key) &&
            owner.playerId !== event.playerId &&
            !state.players.find((pl) => pl.id === owner.playerId)?.resigned
          ) {
            steal = true;
            break;
          }
        }
      }
      state.pendingSteal = steal;
      return;
    }

    case 'RESOURCE_STOLEN': {
      const { resource, amount, fromPlayerId } = event.data;
      if (resource && amount > 0 && fromPlayerId) {
        const victim = player(state, fromPlayerId);
        const thief = player(state, event.playerId);
        victim.resources[resource] -= amount;
        thief.resources[resource] += amount;
      }
      state.pendingSteal = false;
      return;
    }

    case 'ROAD_BUILT': {
      const p = player(state, event.playerId);
      p.roads.push(event.data.edgeId);
      if (event.data.free) p.freeRoads = Math.max(0, p.freeRoads - 1);
      return;
    }

    case 'SETTLEMENT_BUILT': {
      player(state, event.playerId).settlements.push(event.data.cornerId);
      return;
    }

    case 'CITY_BUILT': {
      const p = player(state, event.playerId);
      p.settlements = p.settlements.filter((c) => c !== event.data.cornerId);
      p.cities.push(event.data.cornerId);
      return;
    }

    case 'CARD_PURCHASED': {
      const p = player(state, event.playerId);
      const idx = state.devDeck.lastIndexOf(event.data.cardType);
      if (idx === -1) throw new EngineError('EMPTY_DECK', 'Development deck is empty');
      state.devDeck.splice(idx, 1);
      p.devCards.push({ uid: event.data.cardUid, type: event.data.cardType, playable: false });
      if (event.data.cardType === 'landmark') p.devVictoryPoints += 1;
      state.nextCardUid++;
      return;
    }

    case 'CARD_PLAYED': {
      const p = player(state, event.playerId);
      const idx = p.devCards.findIndex((c) => c.uid === event.data.cardUid);
      if (idx === -1) throw new EngineError('CARD_NOT_HELD', 'Card is not in hand');
      const [card] = p.devCards.splice(idx, 1);
      state.devCardPlayedThisTurn = true;
      if (card?.type === 'guardian') {
        p.guardiansPlayed += 1;
        state.raiderReason = 'guardian';
      } else if (card?.type === 'trailblazer') {
        p.freeRoads += 2;
      }
      return;
    }

    case 'TRADE_PROPOSED': {
      state.pendingTrades.push({
        id: event.data.tradeId,
        fromPlayerId: event.playerId as string,
        toPlayerId: event.data.toPlayerId,
        offer: { ...event.data.offer },
        request: { ...event.data.request },
      });
      state.nextTradeId++;
      return;
    }

    case 'TRADE_ACCEPTED': {
      const i = state.pendingTrades.findIndex((t) => t.id === event.data.tradeId);
      if (i === -1) throw new EngineError('TRADE_NOT_FOUND', 'Trade offer not found');
      const [trade] = state.pendingTrades.splice(i, 1);
      const from = player(state, trade?.fromPlayerId);
      const to = player(state, trade?.toPlayerId);
      for (const [r, n] of Object.entries(trade?.offer ?? {})) {
        const k = r as keyof typeof from.resources;
        from.resources[k] -= n as number;
        to.resources[k] += n as number;
      }
      for (const [r, n] of Object.entries(trade?.request ?? {})) {
        const k = r as keyof typeof to.resources;
        to.resources[k] -= n as number;
        from.resources[k] += n as number;
      }
      return;
    }

    case 'TRADE_DECLINED': {
      state.pendingTrades = state.pendingTrades.filter((t) => t.id !== event.data.tradeId);
      return;
    }

    case 'BANK_TRADED': {
      const p = player(state, event.playerId);
      p.resources[event.data.give] -= event.data.giveCount;
      state.bank[event.data.give] += event.data.giveCount;
      p.resources[event.data.receive] += 1;
      state.bank[event.data.receive] -= 1;
      return;
    }

    case 'LONGEST_ROAD_CHANGED': {
      state.longestRoad = { playerId: event.data.playerId, length: event.data.length };
      return;
    }

    case 'LARGEST_ARMY_CHANGED': {
      state.largestArmy = { playerId: event.data.playerId, count: event.data.count };
      return;
    }

    case 'VICTORY_ACHIEVED': {
      state.winnerId = event.playerId ?? null;
      state.phase = 'gameover';
      return;
    }

    case 'PLAYER_RESIGNED': {
      player(state, event.playerId).resigned = true;
      advanceSetup(state);
      return;
    }

    case 'GAME_ENDED': {
      state.winnerId = event.data.winnerId;
      state.phase = 'gameover';
      return;
    }

    default: {
      const _exhaustive: never = event;
      throw new EngineError('UNKNOWN_EVENT', `Unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** cornerId -> { playerId, kind } for every building on the board. */
export function buildingOwners(state: GameState): Map<string, { playerId: string; kind: 'settlement' | 'city' }> {
  const owners = new Map<string, { playerId: string; kind: 'settlement' | 'city' }>();
  for (const p of state.players) {
    for (const c of p.settlements) owners.set(c, { playerId: p.id, kind: 'settlement' });
    for (const c of p.cities) owners.set(c, { playerId: p.id, kind: 'city' });
  }
  return owners;
}

/** Convenience for analytics: total victory points of a player right now. */
export function currentTotalVp(state: GameState, playerId: string): number {
  return victoryPoints(player(state, playerId), state).total;
}
