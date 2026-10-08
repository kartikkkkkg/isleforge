/* Engine adapter: the ONLY bridge between React and @isleforge/game-engine.
   React never duplicates rules — it reads state snapshots and dispatches
   commands. UI-only state (selection, modals, hover) lives in components. */

import { useCallback, useMemo, useState } from 'react';
import {
  EngineError,
  Game,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerColor,
} from '@isleforge/game-engine';

export interface Seat {
  name: string;
  color: PlayerColor;
  isBot: boolean;
}

const toEnginePlayers = (seats: Seat[]) =>
  seats.map((s) => ({ name: s.name, color: s.color }));

export const HUMAN_SEAT: Seat = { name: 'Skipper', color: 'tide', isBot: false };

const DEMO_BOTS: Seat[] = [
  { name: 'Coral', color: 'ember', isBot: true },
  { name: 'Marina', color: 'moss', isBot: true },
  { name: 'Reef', color: 'dune', isBot: true },
];

export function buildSeats(humanName: string, autopilot: boolean): Seat[] {
  if (autopilot) {
    return [
      { name: 'Coral', color: 'ember', isBot: true },
      { name: 'Marina', color: 'tide', isBot: true },
      { name: 'Reef', color: 'moss', isBot: true },
      { name: 'Pearl', color: 'dune', isBot: true },
    ];
  }
  return [{ ...HUMAN_SEAT, name: humanName || 'Skipper' }, ...DEMO_BOTS];
}

/** Who must act right now: setup cursor, a discarder, or the current player. */
export function activeActor(state: GameState): string | null {
  if (state.phase === 'gameover') return null;
  if (state.phase === 'setup' && state.setup) {
    return state.setup.order[state.setup.cursor] ?? null;
  }
  if (state.phase === 'discard' && state.pendingDiscards) {
    return Object.keys(state.pendingDiscards)[0] ?? null;
  }
  return state.currentPlayerId;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  NOT_YOUR_TURN: 'Wait for your turn.',
  WRONG_PHASE: "You can't do that right now.",
  INSUFFICIENT_RESOURCES: "You can't afford that.",
  ILLEGAL_LOCATION: 'Illegal placement.',
  NO_ROAD_CONNECTION: 'Roads must connect to your network.',
  DISTANCE_RULE: 'Too close to another building.',
  CORNER_OCCUPIED: 'That corner is taken.',
  EDGE_OCCUPIED: 'That edge is taken.',
  INVALID_TRADE: 'Invalid trade.',
  CARD_NOT_PLAYABLE: "That card can't be played now.",
  NOTHING_TO_STEAL: 'No steal is pending.',
  INVALID_TARGET: 'Invalid target.',
  TRADE_NOT_FOUND: 'That trade is gone.',
  NOT_A_PARTICIPANT: 'Not your trade.',
};

export function friendlyError(e: unknown): string {
  if (e instanceof EngineError) {
    return FRIENDLY_ERRORS[e.code] ?? e.message;
  }
  return 'Something went wrong.';
}

export interface GameApi {
  game: Game;
  state: GameState;
  seats: Seat[];
  /** Dispatch a command; returns events or null (error surfaced via `error`). */
  dispatch: (cmd: Command) => GameEvent[] | null;
  error: string | null;
  clearError: () => void;
  newGame: (seed?: number) => void;
  isBot: (playerId: string) => boolean;
  humanId: string | null;
}

export function useIsleforgeGame(
  seats: Seat[],
  initialSeed?: number,
): GameApi {
  const [game, setGame] = useState(
    () => new Game({ seed: initialSeed, players: toEnginePlayers(seats) }),
  );
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const state = useMemo(() => game.getState(), [game, tick]);

  const dispatch = useCallback(
    (cmd: Command): GameEvent[] | null => {
      try {
        const events = game.dispatch(cmd);
        setError(null);
        setTick((t) => t + 1);
        return events;
      } catch (e) {
        setError(friendlyError(e));
        return null;
      }
    },
    [game],
  );

  const newGame = useCallback(
    (seed?: number) => {
      setGame(new Game({ seed, players: toEnginePlayers(seats) }));
      setError(null);
      setTick((t) => t + 1);
    },
    [seats],
  );

  const isBot = useCallback(
    (playerId: string) =>
      seats.find((s, i) => `p${i + 1}` === playerId)?.isBot ?? false,
    [seats],
  );

  const humanId = useMemo(() => {
    const idx = seats.findIndex((s) => !s.isBot);
    return idx === -1 ? null : `p${idx + 1}`;
  }, [seats]);

  const clearError = useCallback(() => setError(null), []);

  return { game, state, seats, dispatch, error, clearError, newGame, isBot, humanId };
}
