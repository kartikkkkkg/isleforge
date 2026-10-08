/**
 * Deterministic replay: rebuild any game state purely from its event log.
 * This is the foundation for replays, spectators, game history, analytics,
 * anti-cheat review and debugging (milestones 5, 9, 10).
 */

import { applyEvent } from './events.js';
import { blankState } from './state.js';
import { EngineError, type GameEvent, type GameState } from './types.js';

/** Reconstruct state by folding the event log from a blank slate. */
export function replayEvents(events: GameEvent[]): GameState {
  if (events.length === 0 || events[0]?.type !== 'GAME_CREATED') {
    throw new EngineError('INVALID_REPLAY', 'An event log must start with GAME_CREATED');
  }
  const state = blankState();
  for (const e of events) {
    applyEvent(state, e);
    state.events.push(e);
  }
  return state;
}

/** Serialize a full game state (for saves / transfer). */
export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

/** Parse a serialized game state, with a version check. */
export function deserializeGame(json: string): GameState {
  const parsed = JSON.parse(json) as GameState;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events)) {
    throw new EngineError('INVALID_SAVE', 'Not a valid Isleforge game save');
  }
  return parsed;
}

/** Serialize just the event log (compact replay artifact). */
export function serializeEvents(events: GameEvent[]): string {
  return JSON.stringify(events);
}

/** Rebuild state from a serialized event log. */
export function replaySerializedEvents(json: string): GameState {
  return replayEvents(JSON.parse(json) as GameEvent[]);
}
