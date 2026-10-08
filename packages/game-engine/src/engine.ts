/**
 * Game: the primary facade over the engine.
 * Owns the seeded RNG used to *generate* random outcomes (dice, steals);
 * every outcome is recorded in events, so replay never needs the RNG.
 */

import { CLASSIC_MAP_ID } from './board.js';
import { planCommand } from './commands.js';
import { applyEvent } from './events.js';
import { legalCommands } from './legal.js';
import { mulberry32, type Rng } from './rng.js';
import { blankState } from './state.js';
import {
  EngineError,
  PLAYER_COLORS,
  type Command,
  type DevCardType,
  type GameEvent,
  type GameState,
  type PlayerColor,
  type PlayerState,
} from './types.js';

export interface NewPlayer {
  id?: string;
  name: string;
  color?: PlayerColor;
}

export interface CreateGameOptions {
  seed?: number;
  mapId?: string;
  players: NewPlayer[];
}

/** Milestone 1 scope: the classic 4-player board supports 3–4 players. */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;

/** Dev cards with the type hidden from anyone except the holder. */
export type VisibleDevCard = { uid: string; playable: boolean; type: DevCardType | 'hidden' };
export interface PublicPlayerState extends Omit<PlayerState, 'devCards'> {
  devCards: VisibleDevCard[];
}
export interface PublicGameState extends Omit<GameState, 'players'> {
  players: PublicPlayerState[];
}

/** Mask hidden information (opponents' dev-card types) for a viewer. */
export function publicGameState(state: GameState, viewerId?: string): PublicGameState {
  const clone: GameState = structuredClone(state);
  const players: PublicPlayerState[] = clone.players.map((p) => ({
    ...p,
    devCards:
      p.id === viewerId
        ? p.devCards.map((c) => ({ uid: c.uid, playable: c.playable, type: c.type as DevCardType | 'hidden' }))
        : p.devCards.map((c) => ({ uid: c.uid, playable: false, type: 'hidden' as const })),
  }));
  return { ...clone, players };
}

export class Game {
  private state: GameState;
  private rng: Rng;

  constructor(opts: CreateGameOptions) {
    const n = opts.players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
      throw new EngineError(
        'INVALID_PLAYER_COUNT',
        `Milestone 1 supports ${MIN_PLAYERS}–${MAX_PLAYERS} players (got ${n})`,
      );
    }
    const usedColors = new Set<PlayerColor>();
    const defs = opts.players.map((p, i) => {
      if (!p.name || !p.name.trim()) throw new EngineError('INVALID_PLAYER', 'Player name is required');
      const color = p.color ?? (PLAYER_COLORS[i % PLAYER_COLORS.length] as PlayerColor);
      if (usedColors.has(color)) throw new EngineError('INVALID_PLAYER', `Duplicate color: ${color}`);
      usedColors.add(color);
      return { id: p.id ?? `p${i + 1}`, name: p.name.trim(), color };
    });
    if (new Set(defs.map((d) => d.id)).size !== defs.length) {
      throw new EngineError('INVALID_PLAYER', 'Duplicate player id');
    }

    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const created: GameEvent = {
      seq: 0,
      type: 'GAME_CREATED',
      data: { seed, mapId: opts.mapId ?? CLASSIC_MAP_ID, players: defs },
    };
    const s = blankState();
    applyEvent(s, created);
    s.events.push(created);
    this.state = s;
  }

  /**
   * Validate and apply a command. Returns the events it produced.
   * Throws EngineError when the command is illegal — state is unchanged.
   */
  dispatch(cmd: Command): GameEvent[] {
    const planned = planCommand(this.state, cmd, this.rng);
    for (const e of planned) {
      e.seq = this.state.events.length;
      applyEvent(this.state, e);
      this.state.events.push(e);
    }
    return structuredClone(planned);
  }

  /** Deep-cloned full state (local milestone: includes hidden info). */
  getState(): GameState {
    return structuredClone(this.state);
  }

  getEvents(): GameEvent[] {
    return structuredClone(this.state.events);
  }

  legalCommands(playerId: string): Command[] {
    return legalCommands(this.state, playerId);
  }

  /** State with hidden information masked for `viewerId` (spectators pass none). */
  publicView(viewerId?: string): PublicGameState {
    return publicGameState(this.state, viewerId);
  }
}
