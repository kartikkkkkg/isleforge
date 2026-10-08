/**
 * Legal-move enumeration: every command the given player may legally issue
 * right now. Implemented by *probing* planCommand() with each candidate, so
 * the enumeration can never drift from the validation rules.
 * This is the interface bot agents (milestone 3) will use.
 */

import { edgesAdjacentToCorner } from './board.js';
import { planCommand } from './commands.js';
import { buildingOwners } from './events.js';
import { mulberry32 } from './rng.js';
import { activePlayers } from './state.js';
import {
  RESOURCES,
  emptyResources,
  type Command,
  type GameEvent,
  type GameState,
  type ResourceCount,
  type ResourceType,
} from './types.js';

const NO_EVENTS: GameEvent[] = [];

function probe(state: GameState, cmd: Command): boolean {
  try {
    // Planning never reads the event log — drop it so probes stay cheap even
    // in long games (the log is the largest part of a cloned state).
    planCommand({ ...state, events: NO_EVENTS }, cmd, mulberry32(0xbeef));
    return true;
  } catch {
    return false;
  }
}

/** All player ids with a building adjacent to the raider tile (steal targets). */
function stealVictimIds(state: GameState, playerId: string): string[] {
  const owners = buildingOwners(state);
  const out = new Set<string>();
  for (const [cid, o] of owners) {
    if (o.playerId === playerId) continue;
    const pl = state.players.find((p) => p.id === o.playerId);
    if (!pl || pl.resigned) continue;
    if (state.board.corners[cid]?.tiles.includes(state.raiderTileKey)) out.add(o.playerId);
  }
  return [...out];
}

/** Every way to discard exactly `need` resources from `hand` (bounded). */
export function discardCombinations(hand: ResourceCount, need: number, cap = 5000): ResourceCount[] {
  const out: ResourceCount[] = [];
  const cur = emptyResources();
  const rec = (i: number, left: number): void => {
    if (out.length >= cap) return;
    if (i === RESOURCES.length) {
      if (left === 0) out.push({ ...cur });
      return;
    }
    const r = RESOURCES[i] as ResourceType;
    const max = Math.min(hand[r], left);
    for (let n = 0; n <= max; n++) {
      cur[r] = n;
      rec(i + 1, left - n);
      if (out.length >= cap) return;
    }
    cur[r] = 0;
  };
  rec(0, need);
  return out;
}

export interface LegalCommandsOptions {
  /** Skip enumerating TRADE_PROPOSE candidates (120 probes the AI never uses). Default false. */
  skipTradePropose?: boolean;
}

export function legalCommands(
  state: GameState,
  playerId: string,
  opts: LegalCommandsOptions = {},
): Command[] {
  const cmds: Command[] = [];
  const me = state.players.find((p) => p.id === playerId);
  if (!me || me.resigned || state.phase === 'gameover') return cmds;
  const push = (cmd: Command): void => {
    if (probe(state, cmd)) cmds.push(cmd);
  };

  switch (state.phase) {
    case 'setup': {
      const setup = state.setup;
      if (setup && setup.order[setup.cursor] === playerId) {
        if (setup.expecting === 'settlement') {
          for (const cid of Object.keys(state.board.corners)) {
            push({ type: 'PLACE_SETTLEMENT', playerId, cornerId: cid });
          }
        } else {
          const last = me.settlements[me.settlements.length - 1];
          if (last) {
            for (const eid of edgesAdjacentToCorner(state.board, last)) {
              push({ type: 'PLACE_ROAD', playerId, edgeId: eid });
            }
          }
        }
      }
      break;
    }

    case 'roll': {
      if (state.currentPlayerId === playerId) push({ type: 'ROLL_DICE', playerId });
      break;
    }

    case 'discard': {
      const need = state.pendingDiscards?.[playerId];
      if (need !== undefined) {
        for (const combo of discardCombinations(me.resources, need)) {
          cmds.push({ type: 'DISCARD_RESOURCES', playerId, resources: combo });
        }
      }
      break;
    }

    case 'raider': {
      if (state.currentPlayerId === playerId) {
        if (state.pendingSteal) {
          for (const victimId of stealVictimIds(state, playerId)) {
            push({ type: 'STEAL_RESOURCE', playerId, targetPlayerId: victimId });
          }
        } else {
          for (const t of state.board.tiles) {
            if (t.key !== state.raiderTileKey) {
              push({ type: 'MOVE_RAIDER', playerId, tileKey: t.key });
            }
          }
        }
      }
      break;
    }

    case 'play': {
      if (state.currentPlayerId === playerId) {
        for (const eid of Object.keys(state.board.edges)) {
          push({ type: 'BUILD_ROAD', playerId, edgeId: eid });
        }
        for (const cid of Object.keys(state.board.corners)) {
          push({ type: 'BUILD_SETTLEMENT', playerId, cornerId: cid });
        }
        for (const cid of me.settlements) {
          push({ type: 'BUILD_CITY', playerId, cornerId: cid });
        }
        push({ type: 'BUY_DEVELOPMENT_CARD', playerId });
        for (const card of me.devCards) {
          if (card.type === 'harvest') {
            for (const r1 of RESOURCES) {
              for (const r2 of RESOURCES) {
                push({
                  type: 'PLAY_DEVELOPMENT_CARD',
                  playerId,
                  cardUid: card.uid,
                  params: { resources: [r1, r2] },
                });
              }
            }
          } else if (card.type === 'embargo') {
            for (const r of RESOURCES) {
              push({ type: 'PLAY_DEVELOPMENT_CARD', playerId, cardUid: card.uid, params: { resource: r } });
            }
          } else {
            push({ type: 'PLAY_DEVELOPMENT_CARD', playerId, cardUid: card.uid });
          }
        }
        for (const give of RESOURCES) {
          for (const receive of RESOURCES) {
            if (give !== receive) push({ type: 'TRADE_BANK', playerId, give, receive });
          }
        }
        for (const other of activePlayers(state)) {
          if (other.id === playerId) continue;
          if (opts.skipTradePropose) continue;
          for (const give of RESOURCES) {
            for (const receive of RESOURCES) {
              if (give === receive) continue;
              for (const n of [1, 2]) {
                const offer = emptyResources();
                offer[give] = n;
                const request = emptyResources();
                request[receive] = 1;
                push({ type: 'TRADE_PROPOSE', playerId, toPlayerId: other.id, offer, request });
              }
            }
          }
        }
        push({ type: 'END_TURN', playerId });
      }
      break;
    }

    default: {
      const _exhaustive: never = state.phase;
      throw new Error(`unhandled phase: ${_exhaustive as string}`);
    }
  }

  for (const t of state.pendingTrades) {
    if (t.toPlayerId === playerId) {
      // Accept is always issuable (a stale offer auto-declines, deterministically).
      cmds.push({ type: 'TRADE_ACCEPT', playerId, tradeId: t.id });
      cmds.push({ type: 'TRADE_DECLINE', playerId, tradeId: t.id });
    }
  }
  cmds.push({ type: 'RESIGN', playerId });
  return cmds;
}
