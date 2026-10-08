/**
 * Command validation + event planning.
 *
 * The frontend (and later, the network client) is never trusted:
 * every command is validated against the current state here, and only
 * valid commands produce events. planCommand() works on a throwaway draft
 * so multi-event commands (e.g. road build -> longest road -> victory)
 * observe each intermediate state exactly as the event log will.
 */

import {
  cornersOfEdge,
  edgesAdjacentToCorner,
  playerBuildingCorners,
  playerRoadCorners,
  tileResource,
} from './board.js';
import { applyEvent, buildingOwners } from './events.js';
import { weightedPick, type Rng } from './rng.js';
import { computeLargestArmyHolder, computeLongestRoadHolder, victoryPoints } from './scoring.js';
import { activePlayers, getPlayer, nextActivePlayerId } from './state.js';
import {
  COSTS,
  EngineError,
  RESOURCES,
  VICTORY_POINT_TARGET,
  emptyResources,
  totalResources,
  type Command,
  type DevCardType,
  type GameEvent,
  type GameState,
  type Phase,
  type PlayerState,
  type ResourceCount,
  type ResourceType,
} from './types.js';

type Emitter = (e: Omit<GameEvent, 'seq'>) => void;

/* ------------------------------------------------------------------ */
/* Small validators                                                    */
/* ------------------------------------------------------------------ */

function asPlayer(draft: GameState, playerId: string): PlayerState {
  const p = draft.players.find((pl) => pl.id === playerId);
  if (!p) throw new EngineError('UNKNOWN_PLAYER', `Unknown player: ${playerId}`);
  return p;
}

function requirePhase(draft: GameState, ...phases: Phase[]): void {
  if (!phases.includes(draft.phase)) {
    throw new EngineError(
      'WRONG_PHASE',
      `This action is not allowed during phase '${draft.phase}'`,
    );
  }
}

function requireCurrent(draft: GameState, playerId: string): void {
  if (draft.currentPlayerId !== playerId) {
    throw new EngineError('NOT_YOUR_TURN', `It is not ${playerId}'s turn`);
  }
}

function requireActive(p: PlayerState): void {
  if (p.resigned) throw new EngineError('PLAYER_RESIGNED', 'This player has resigned');
}

export function canAfford(hand: ResourceCount, cost: ResourceCount): boolean {
  return RESOURCES.every((r) => hand[r] >= cost[r]);
}

function assertAfford(hand: ResourceCount, cost: ResourceCount): void {
  if (!canAfford(hand, cost)) {
    throw new EngineError('INSUFFICIENT_RESOURCES', 'Not enough resources for this action');
  }
}

function allRoads(draft: GameState): Set<string> {
  const out = new Set<string>();
  for (const p of draft.players) for (const e of p.roads) out.add(e);
  return out;
}

function validResourceCounts(counts: ResourceCount, label: string): void {
  for (const r of RESOURCES) {
    const n = counts[r];
    if (!Number.isInteger(n) || n < 0) {
      throw new EngineError('INVALID_TRADE', `${label} has an invalid amount of ${r}`);
    }
  }
}

/** Best bank-trade ratio available to the player for giving `give`. */
export function bankTradeRatio(draft: GameState, playerId: string, give: ResourceType): number {
  const p = asPlayer(draft, playerId);
  let ratio = 4;
  for (const port of draft.board.ports) {
    const owned = port.cornerIds.some((c) => p.settlements.includes(c) || p.cities.includes(c));
    if (!owned) continue;
    if (port.kind === 'three') ratio = Math.min(ratio, 3);
    else if (port.kind === give) ratio = Math.min(ratio, 2);
  }
  return ratio;
}

/** Is there any legal road edge the player could build on (ignoring cost)? */
export function hasLegalRoadPlacement(draft: GameState, playerId: string): boolean {
  const p = asPlayer(draft, playerId);
  const occupied = allRoads(draft);
  const buildingCorners = playerBuildingCorners(p);
  const roadCorners = playerRoadCorners(draft.board, p.roads);
  for (const [eid, info] of Object.entries(draft.board.edges)) {
    if (occupied.has(eid)) continue;
    const [a, b] = info.corners;
    if (buildingCorners.has(a) || buildingCorners.has(b) || roadCorners.has(a) || roadCorners.has(b)) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Derived-event helpers                                               */
/* ------------------------------------------------------------------ */

function maybeLongestRoad(draft: GameState, emit: Emitter): void {
  const holder = computeLongestRoadHolder(draft);
  if (
    holder.playerId !== draft.longestRoad.playerId ||
    holder.length !== draft.longestRoad.length
  ) {
    emit({ type: 'LONGEST_ROAD_CHANGED', data: holder });
  }
}

function maybeLargestArmy(draft: GameState, emit: Emitter): void {
  const holder = computeLargestArmyHolder(draft);
  if (
    holder.playerId !== draft.largestArmy.playerId ||
    holder.count !== draft.largestArmy.count
  ) {
    emit({ type: 'LARGEST_ARMY_CHANGED', data: holder });
  }
}

function maybeVictory(draft: GameState, emit: Emitter, playerId: string): void {
  if (draft.winnerId || draft.phase === 'gameover') return;
  const p = asPlayer(draft, playerId);
  const { total } = victoryPoints(p, draft);
  if (total >= VICTORY_POINT_TARGET) {
    emit({ type: 'VICTORY_ACHIEVED', playerId, data: { victoryPoints: total } });
    emit({ type: 'GAME_ENDED', data: { winnerId: playerId, reason: 'victory' } });
  }
}

function turnNumberFor(draft: GameState, fromPlayerId: string, toPlayerId: string): number {
  const fromIdx = draft.playerOrder.indexOf(fromPlayerId);
  const toIdx = draft.playerOrder.indexOf(toPlayerId);
  return toIdx <= fromIdx ? draft.turnNumber + 1 : draft.turnNumber;
}

/* ------------------------------------------------------------------ */
/* planCommand                                                         */
/* ------------------------------------------------------------------ */

/**
 * Validate a command and plan the events it produces.
 * Throws EngineError when the command is illegal. Never mutates `state`.
 */
export function planCommand(state: GameState, cmd: Command, rng: Rng): GameEvent[] {
  const draft: GameState = structuredClone(state);
  const events: GameEvent[] = [];
  const emit: Emitter = (e) => {
    const full = e as GameEvent;
    full.seq = -1; // assigned by the dispatcher
    events.push(full);
    applyEvent(draft, full);
  };

  // Every command names a player; the player must exist and be active.
  const actor = asPlayer(draft, cmd.playerId);
  if (cmd.type !== 'RESIGN') requireActive(actor);

  switch (cmd.type) {
    /* ---------------- setup ---------------- */
    case 'PLACE_SETTLEMENT': {
      requirePhase(draft, 'setup');
      const setup = draft.setup;
      if (!setup) throw new EngineError('INVALID_SETUP', 'Setup is not active');
      if (setup.order[setup.cursor] !== cmd.playerId) {
        throw new EngineError('NOT_YOUR_TURN', 'It is not your setup turn');
      }
      if (setup.expecting !== 'settlement') {
        throw new EngineError('WRONG_PHASE', 'You must place a road now');
      }
      const corner = draft.board.corners[cmd.cornerId];
      if (!corner) throw new EngineError('ILLEGAL_LOCATION', 'Unknown corner');
      const owners = buildingOwners(draft);
      if (owners.has(cmd.cornerId)) throw new EngineError('CORNER_OCCUPIED', 'Corner is occupied');
      for (const n of corner.neighbors) {
        if (owners.has(n)) throw new EngineError('DISTANCE_RULE', 'Too close to another building');
      }
      const secondRound = setup.cursor >= setup.order.length / 2;
      emit({ type: 'SETUP_PLACED', playerId: cmd.playerId, data: { kind: 'settlement', cornerId: cmd.cornerId } });
      if (secondRound) {
        for (const tkey of corner.tiles) {
          const tile = draft.board.tileByKey[tkey];
          if (!tile) continue;
          const res = tileResource(tile);
          if (!res) continue;
          emit({
            type: 'RESOURCE_GRANTED',
            playerId: cmd.playerId,
            data: { resource: res, amount: 1, reason: 'setup' },
          });
        }
      }
      return events;
    }

    case 'PLACE_ROAD': {
      requirePhase(draft, 'setup');
      const setup = draft.setup;
      if (!setup) throw new EngineError('INVALID_SETUP', 'Setup is not active');
      if (setup.order[setup.cursor] !== cmd.playerId) {
        throw new EngineError('NOT_YOUR_TURN', 'It is not your setup turn');
      }
      if (setup.expecting !== 'road') {
        throw new EngineError('WRONG_PHASE', 'You must place a settlement first');
      }
      const edge = draft.board.edges[cmd.edgeId];
      if (!edge) throw new EngineError('ILLEGAL_LOCATION', 'Unknown edge');
      if (allRoads(draft).has(cmd.edgeId)) throw new EngineError('EDGE_OCCUPIED', 'Edge is occupied');
      const lastSettlement = actor.settlements[actor.settlements.length - 1];
      if (!lastSettlement || !edge.corners.includes(lastSettlement as string)) {
        throw new EngineError('NO_ROAD_CONNECTION', 'Road must connect to your new settlement');
      }
      emit({ type: 'SETUP_PLACED', playerId: cmd.playerId, data: { kind: 'road', edgeId: cmd.edgeId } });
      if (!draft.setup) {
        const first = draft.playerOrder[0];
        if (!first) throw new EngineError('NO_ACTIVE_PLAYERS', 'No players in game');
        emit({ type: 'TURN_STARTED', playerId: first, data: { turnNumber: 1 } });
      }
      return events;
    }

    /* ---------------- dice & production ---------------- */
    case 'ROLL_DICE': {
      requirePhase(draft, 'roll');
      requireCurrent(draft, cmd.playerId);
      const d1 = rng.intRange(1, 6);
      const d2 = rng.intRange(1, 6);
      const total = d1 + d2;
      emit({ type: 'DICE_ROLLED', playerId: cmd.playerId, data: { d1, d2, total } });

      if (total === 7) {
        const required: Record<string, number> = {};
        for (const pl of activePlayers(draft)) {
          const t = totalResources(pl.resources);
          if (t > 7) required[pl.id] = Math.floor(t / 2);
        }
        if (Object.keys(required).length > 0) {
          emit({ type: 'DISCARDS_REQUIRED', data: { required } });
          emit({ type: 'TURN_PHASE_CHANGED', data: { phase: 'discard' } });
        } else {
          emit({ type: 'TURN_PHASE_CHANGED', data: { phase: 'raider' } });
        }
        return events;
      }

      // Production: aggregate first so the classic bank-shortage rule
      // (not enough cards -> nobody gets that resource) can be applied.
      const cornersByTile = new Map<string, string[]>();
      for (const [cid, info] of Object.entries(draft.board.corners)) {
        for (const tkey of info.tiles) {
          const list = cornersByTile.get(tkey) ?? [];
          list.push(cid);
          cornersByTile.set(tkey, list);
        }
      }
      const owners = buildingOwners(draft);
      const grants = new Map<string, ResourceCount>();
      for (const tile of draft.board.tiles) {
        if (tile.number !== total || tile.key === draft.raiderTileKey) continue;
        const res = tileResource(tile);
        if (!res) continue;
        for (const cid of cornersByTile.get(tile.key) ?? []) {
          const owner = owners.get(cid);
          if (!owner) continue;
          const pl = draft.players.find((q) => q.id === owner.playerId);
          if (!pl || pl.resigned) continue;
          const amount = owner.kind === 'city' ? 2 : 1;
          const g = grants.get(owner.playerId) ?? emptyResources();
          g[res] += amount;
          grants.set(owner.playerId, g);
        }
      }
      const totals = emptyResources();
      for (const g of grants.values()) {
        for (const r of RESOURCES) totals[r] += g[r];
      }
      for (const [pid, g] of grants) {
        for (const r of RESOURCES) {
          if (g[r] > 0 && draft.bank[r] >= totals[r]) {
            emit({
              type: 'RESOURCE_GRANTED',
              playerId: pid,
              data: { resource: r, amount: g[r], reason: 'production' },
            });
          }
        }
      }
      emit({ type: 'TURN_PHASE_CHANGED', data: { phase: 'play' } });
      return events;
    }

    case 'DISCARD_RESOURCES': {
      requirePhase(draft, 'discard');
      const need = draft.pendingDiscards?.[cmd.playerId];
      if (need === undefined) {
        throw new EngineError('NO_DISCARD_REQUIRED', 'You do not need to discard');
      }
      validResourceCounts(cmd.resources, 'Discard');
      if (totalResources(cmd.resources) !== need) {
        throw new EngineError('INVALID_DISCARD', `You must discard exactly ${need} resources`);
      }
      for (const r of RESOURCES) {
        if (cmd.resources[r] > actor.resources[r]) {
          throw new EngineError('INSUFFICIENT_RESOURCES', `You do not have ${cmd.resources[r]} ${r}`);
        }
      }
      emit({ type: 'RESOURCES_DISCARDED', playerId: cmd.playerId, data: { resources: { ...cmd.resources } } });
      if (!draft.pendingDiscards) {
        emit({ type: 'TURN_PHASE_CHANGED', data: { phase: 'raider' } });
      }
      return events;
    }

    /* ---------------- raider ---------------- */
    case 'MOVE_RAIDER': {
      requirePhase(draft, 'raider');
      requireCurrent(draft, cmd.playerId);
      const tile = draft.board.tileByKey[cmd.tileKey];
      if (!tile) throw new EngineError('ILLEGAL_LOCATION', 'Unknown tile');
      if (tile.key === draft.raiderTileKey) {
        throw new EngineError('ILLEGAL_LOCATION', 'The raider is already on that tile');
      }
      emit({
        type: 'RAIDER_MOVED',
        playerId: cmd.playerId,
        data: { fromTileKey: draft.raiderTileKey, toTileKey: tile.key, reason: draft.raiderReason ?? 'dice' },
      });
      if (!draft.pendingSteal) {
        emit({ type: 'TURN_PHASE_CHANGED', data: { phase: 'play' } });
      }
      return events;
    }

    case 'STEAL_RESOURCE': {
      requirePhase(draft, 'raider');
      requireCurrent(draft, cmd.playerId);
      if (!draft.pendingSteal) throw new EngineError('NOTHING_TO_STEAL', 'No steal is pending');
      const victim = asPlayer(draft, cmd.targetPlayerId);
      if (victim.id === cmd.playerId) throw new EngineError('INVALID_TARGET', 'You cannot steal from yourself');
      requireActive(victim);
      const owners = buildingOwners(draft);
      const adjacent = [...owners.entries()].some(
        ([cid, o]) =>
          o.playerId === victim.id && draft.board.corners[cid]?.tiles.includes(draft.raiderTileKey),
      );
      if (!adjacent) {
        throw new EngineError('INVALID_TARGET', 'Target has no building next to the raider');
      }
      let resource: ResourceType | null = null;
      if (totalResources(victim.resources) > 0) {
        resource = weightedPick(
          RESOURCES,
          RESOURCES.map((r) => victim.resources[r]),
          rng,
        );
      }
      emit({
        type: 'RESOURCE_STOLEN',
        playerId: cmd.playerId,
        data: { resource, amount: resource ? 1 : 0, reason: 'raider', fromPlayerId: victim.id },
      });
      emit({ type: 'TURN_PHASE_CHANGED', data: { phase: 'play' } });
      return events;
    }

    /* ---------------- building ---------------- */
    case 'BUILD_ROAD': {
      requirePhase(draft, 'play');
      requireCurrent(draft, cmd.playerId);
      const edge = draft.board.edges[cmd.edgeId];
      if (!edge) throw new EngineError('ILLEGAL_LOCATION', 'Unknown edge');
      if (allRoads(draft).has(cmd.edgeId)) throw new EngineError('EDGE_OCCUPIED', 'Edge is occupied');
      const buildingCorners = playerBuildingCorners(actor);
      const roadCorners = playerRoadCorners(draft.board, actor.roads);
      const [a, b] = edge.corners;
      if (
        !buildingCorners.has(a) &&
        !buildingCorners.has(b) &&
        !roadCorners.has(a) &&
        !roadCorners.has(b)
      ) {
        throw new EngineError('NO_ROAD_CONNECTION', 'Road must connect to your network');
      }
      const free = actor.freeRoads > 0;
      if (!free) {
        assertAfford(actor.resources, COSTS.road);
        emit({ type: 'RESOURCES_PAID', playerId: cmd.playerId, data: { resources: { ...COSTS.road }, reason: 'build' } });
      }
      emit({ type: 'ROAD_BUILT', playerId: cmd.playerId, data: { edgeId: cmd.edgeId, free } });
      maybeLongestRoad(draft, emit);
      maybeVictory(draft, emit, cmd.playerId);
      return events;
    }

    case 'BUILD_SETTLEMENT': {
      requirePhase(draft, 'play');
      requireCurrent(draft, cmd.playerId);
      const corner = draft.board.corners[cmd.cornerId];
      if (!corner) throw new EngineError('ILLEGAL_LOCATION', 'Unknown corner');
      const owners = buildingOwners(draft);
      if (owners.has(cmd.cornerId)) throw new EngineError('CORNER_OCCUPIED', 'Corner is occupied');
      for (const n of corner.neighbors) {
        if (owners.has(n)) throw new EngineError('DISTANCE_RULE', 'Too close to another building');
      }
      if (!playerRoadCorners(draft.board, actor.roads).has(cmd.cornerId)) {
        throw new EngineError('NO_ROAD_CONNECTION', 'Settlement must connect to your road');
      }
      assertAfford(actor.resources, COSTS.settlement);
      emit({ type: 'RESOURCES_PAID', playerId: cmd.playerId, data: { resources: { ...COSTS.settlement }, reason: 'build' } });
      emit({ type: 'SETTLEMENT_BUILT', playerId: cmd.playerId, data: { cornerId: cmd.cornerId } });
      maybeVictory(draft, emit, cmd.playerId);
      return events;
    }

    case 'BUILD_CITY': {
      requirePhase(draft, 'play');
      requireCurrent(draft, cmd.playerId);
      if (!actor.settlements.includes(cmd.cornerId)) {
        throw new EngineError('ILLEGAL_LOCATION', 'You have no settlement on that corner');
      }
      assertAfford(actor.resources, COSTS.city);
      emit({ type: 'RESOURCES_PAID', playerId: cmd.playerId, data: { resources: { ...COSTS.city }, reason: 'build' } });
      emit({ type: 'CITY_BUILT', playerId: cmd.playerId, data: { cornerId: cmd.cornerId } });
      maybeVictory(draft, emit, cmd.playerId);
      return events;
    }

    /* ---------------- development cards ---------------- */
    case 'BUY_DEVELOPMENT_CARD': {
      requirePhase(draft, 'play');
      requireCurrent(draft, cmd.playerId);
      if (draft.devDeck.length === 0) throw new EngineError('EMPTY_DECK', 'No development cards left');
      assertAfford(actor.resources, COSTS.devCard);
      const cardType = draft.devDeck[draft.devDeck.length - 1] as DevCardType;
      emit({ type: 'RESOURCES_PAID', playerId: cmd.playerId, data: { resources: { ...COSTS.devCard }, reason: 'card' } });
      emit({
        type: 'CARD_PURCHASED',
        playerId: cmd.playerId,
        data: { cardUid: `c${draft.nextCardUid}`, cardType },
      });
      maybeVictory(draft, emit, cmd.playerId);
      return events;
    }

    case 'PLAY_DEVELOPMENT_CARD': {
      requirePhase(draft, 'play');
      requireCurrent(draft, cmd.playerId);
      const card = actor.devCards.find((c) => c.uid === cmd.cardUid);
      if (!card) throw new EngineError('CARD_NOT_HELD', 'Card is not in your hand');
      if (!card.playable) {
        throw new EngineError('CARD_NOT_PLAYABLE', 'Cards bought this turn cannot be played yet');
      }
      if (draft.devCardPlayedThisTurn) {
        throw new EngineError('CARD_ALREADY_PLAYED', 'Only one development card per turn');
      }
      if (card.type === 'landmark') {
        throw new EngineError('INVALID_CARD', 'Landmark cards are never played');
      }
      emit({
        type: 'CARD_PLAYED',
        playerId: cmd.playerId,
        data: { cardUid: card.uid, cardType: card.type, params: cmd.params },
      });
      switch (card.type) {
        case 'guardian': {
          maybeLargestArmy(draft, emit);
          emit({ type: 'TURN_PHASE_CHANGED', data: { phase: 'raider' } });
          maybeVictory(draft, emit, cmd.playerId);
          break;
        }
        case 'trailblazer': {
          // freeRoads += 2 handled by applyEvent; player places via BUILD_ROAD.
          break;
        }
        case 'harvest': {
          const pair = cmd.params?.resources;
          if (
            !pair ||
            pair.length !== 2 ||
            !RESOURCES.includes(pair[0] as ResourceType) ||
            !RESOURCES.includes(pair[1] as ResourceType)
          ) {
            throw new EngineError('INVALID_CARD_PARAMS', 'Harvest needs two resources');
          }
          for (const r of pair as [ResourceType, ResourceType]) {
            const amount = Math.min(1, draft.bank[r]);
            if (amount > 0) {
              emit({
                type: 'RESOURCE_GRANTED',
                playerId: cmd.playerId,
                data: { resource: r, amount, reason: 'harvest' },
              });
            }
          }
          break;
        }
        case 'embargo': {
          const r = cmd.params?.resource;
          if (!r || !RESOURCES.includes(r)) {
            throw new EngineError('INVALID_CARD_PARAMS', 'Embargo needs one resource');
          }
          // Each RESOURCE_STOLEN atomically transfers that victim's stock to the player.
          for (const q of activePlayers(draft)) {
            if (q.id === cmd.playerId) continue;
            const n = q.resources[r];
            if (n > 0) {
              emit({
                type: 'RESOURCE_STOLEN',
                playerId: cmd.playerId,
                data: { resource: r, amount: n, reason: 'embargo', fromPlayerId: q.id },
              });
            }
          }
          break;
        }
      }
      return events;
    }

    /* ---------------- trading ---------------- */
    case 'TRADE_BANK': {
      requirePhase(draft, 'play');
      requireCurrent(draft, cmd.playerId);
      const { give, receive } = cmd;
      if (!RESOURCES.includes(give) || !RESOURCES.includes(receive)) {
        throw new EngineError('INVALID_TRADE', 'Unknown resource');
      }
      if (give === receive) throw new EngineError('INVALID_TRADE', 'Cannot trade a resource for itself');
      const ratio = bankTradeRatio(draft, cmd.playerId, give);
      if (actor.resources[give] < ratio) {
        throw new EngineError('INSUFFICIENT_RESOURCES', `Bank trade needs ${ratio} ${give}`);
      }
      if (draft.bank[receive] < 1) throw new EngineError('BANK_EMPTY', 'The bank has no such resource');
      // BANK_TRADED atomically moves both sides (see applyEvent); no separate RESOURCES_PAID.
      emit({ type: 'BANK_TRADED', playerId: cmd.playerId, data: { give, giveCount: ratio, receive } });
      return events;
    }

    case 'TRADE_PROPOSE': {
      requirePhase(draft, 'play');
      requireCurrent(draft, cmd.playerId);
      const to = asPlayer(draft, cmd.toPlayerId);
      if (to.id === cmd.playerId) throw new EngineError('INVALID_TRADE', 'Cannot trade with yourself');
      requireActive(to);
      validResourceCounts(cmd.offer, 'Offer');
      validResourceCounts(cmd.request, 'Request');
      if (totalResources(cmd.offer) === 0 || totalResources(cmd.request) === 0) {
        throw new EngineError('INVALID_TRADE', 'Offer and request must both be non-empty');
      }
      for (const r of RESOURCES) {
        if (cmd.offer[r] > actor.resources[r]) {
          throw new EngineError('INSUFFICIENT_RESOURCES', `You do not have ${cmd.offer[r]} ${r} to offer`);
        }
      }
      emit({
        type: 'TRADE_PROPOSED',
        playerId: cmd.playerId,
        data: {
          tradeId: `t${draft.nextTradeId}`,
          toPlayerId: to.id,
          offer: { ...cmd.offer },
          request: { ...cmd.request },
        },
      });
      return events;
    }

    case 'TRADE_ACCEPT': {
      const trade = draft.pendingTrades.find((t) => t.id === cmd.tradeId);
      if (!trade) throw new EngineError('TRADE_NOT_FOUND', 'Trade offer not found');
      if (trade.toPlayerId !== cmd.playerId) {
        throw new EngineError('NOT_YOUR_TRADE', 'Only the recipient can accept this trade');
      }
      const from = asPlayer(draft, trade.fromPlayerId);
      const to = asPlayer(draft, cmd.playerId);
      const fromOk = RESOURCES.every((r) => from.resources[r] >= trade.offer[r]);
      const toOk = RESOURCES.every((r) => to.resources[r] >= trade.request[r]);
      if (!fromOk || !toOk || from.resigned || to.resigned) {
        // Stale offer (someone spent the resources): auto-decline, deterministically.
        emit({ type: 'TRADE_DECLINED', playerId: cmd.playerId, data: { tradeId: trade.id } });
      } else {
        emit({ type: 'TRADE_ACCEPTED', playerId: cmd.playerId, data: { tradeId: trade.id } });
      }
      return events;
    }

    case 'TRADE_DECLINE': {
      const trade = draft.pendingTrades.find((t) => t.id === cmd.tradeId);
      if (!trade) throw new EngineError('TRADE_NOT_FOUND', 'Trade offer not found');
      if (trade.toPlayerId !== cmd.playerId && trade.fromPlayerId !== cmd.playerId) {
        throw new EngineError('NOT_YOUR_TRADE', 'You are not part of this trade');
      }
      emit({ type: 'TRADE_DECLINED', playerId: cmd.playerId, data: { tradeId: trade.id } });
      return events;
    }

    /* ---------------- turn control ---------------- */
    case 'END_TURN': {
      requirePhase(draft, 'play');
      requireCurrent(draft, cmd.playerId);
      if (actor.freeRoads > 0 && hasLegalRoadPlacement(draft, cmd.playerId)) {
        throw new EngineError('FREE_ROADS_PENDING', 'Place your free roads before ending the turn');
      }
      for (const t of [...draft.pendingTrades]) {
        emit({ type: 'TRADE_DECLINED', playerId: cmd.playerId, data: { tradeId: t.id } });
      }
      const next = nextActivePlayerId(draft, cmd.playerId);
      if (!next) throw new EngineError('NO_ACTIVE_PLAYERS', 'No active players remain');
      emit({
        type: 'TURN_STARTED',
        playerId: next,
        data: { turnNumber: turnNumberFor(draft, cmd.playerId, next) },
      });
      return events;
    }

    case 'RESIGN': {
      requireActive(actor);
      if (draft.phase === 'gameover') throw new EngineError('WRONG_PHASE', 'The game is already over');
      emit({ type: 'PLAYER_RESIGNED', playerId: cmd.playerId, data: {} });
      const remaining = activePlayers(draft);
      if (remaining.length === 1) {
        const winner = remaining[0] as PlayerState;
        const { total } = victoryPoints(winner, draft);
        emit({ type: 'VICTORY_ACHIEVED', playerId: winner.id, data: { victoryPoints: total } });
        emit({ type: 'GAME_ENDED', data: { winnerId: winner.id, reason: 'resignation' } });
      } else if (remaining.length === 0) {
        emit({ type: 'GAME_ENDED', data: { winnerId: null, reason: 'resignation' } });
      } else if (draft.phase !== 'setup' && draft.currentPlayerId === cmd.playerId) {
        for (const t of [...draft.pendingTrades]) {
          emit({ type: 'TRADE_DECLINED', playerId: cmd.playerId, data: { tradeId: t.id } });
        }
        const next = nextActivePlayerId(draft, cmd.playerId);
        if (next) {
          emit({
            type: 'TURN_STARTED',
            playerId: next,
            data: { turnNumber: turnNumberFor(draft, cmd.playerId, next) },
          });
        }
      }
      return events;
    }

    default: {
      const _exhaustive: never = cmd;
      throw new EngineError('UNKNOWN_COMMAND', `Unhandled command: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
