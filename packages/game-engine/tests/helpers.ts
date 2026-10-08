import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  bankTradeRatio,
  BOARD_RADIUS,
  CLASSIC_MAP_ID,
  cornersAdjacentToCorner,
  cornersOfEdge,
  edgesAdjacentToCorner,
  EngineError,
  generateBoard,
  hexCoords,
  planCommand,
  tilesAdjacentToCorner,
  type Command,
  type GameEvent,
  type GameState,
  type ResourceCount,
  type ResourceType,
} from '../src/index.js';
import { mulberry32, type Rng } from '../src/rng.js';
import { Game } from '../src/index.js';

/** Rng that plays a scripted intRange sequence, then falls back to `min`. */
export function scriptedRng(intRanges: number[] = []): Rng {
  let i = 0;
  return {
    next: () => 0,
    int: () => 0,
    intRange: (min: number, _max: number) => (i < intRanges.length ? (intRanges[i++] as number) : min),
  };
}

export function newGame(seed = 1): Game {
  return new Game({
    seed,
    players: [{ name: 'Ash' }, { name: 'Bryn' }, { name: 'Cora' }, { name: 'Dev' }],
  });
}

/** Drive a fresh game through the full snake setup using first-legal placements. */
export function completeSetup(game: Game): GameState {
  let guard = 0;
  while (game.getState().phase === 'setup' && guard++ < 30) {
    const s = game.getState();
    const actor = s.setup?.order[s.setup.cursor];
    if (!actor) throw new Error('setup stuck: no actor');
    const legal = game.legalCommands(actor);
    const cmd = legal.find((c) => c.type === 'PLACE_SETTLEMENT' || c.type === 'PLACE_ROAD');
    if (!cmd) throw new Error('setup stuck: no placement');
    game.dispatch(cmd);
  }
  const done = game.getState();
  if (done.phase !== 'roll') throw new Error(`setup did not finish (phase=${done.phase})`);
  return done;
}

/** Plan + apply a command against a state snapshot, recording events (white-box). */
export function runCmd(state: GameState, cmd: Command, rng?: Rng): GameEvent[] {
  const planned = planCommand(state, cmd, rng ?? mulberry32(0xc0ffee));
  for (const e of planned) {
    e.seq = state.events.length;
    applyEvent(state, e);
    state.events.push(e);
  }
  return planned;
}

/** Advance a post-setup state into the 'play' phase via a scripted non-7 roll. */
export function toPlay(state: GameState): GameState {
  const s: GameState = structuredClone(state);
  if (s.phase === 'roll') {
    runCmd(s, { type: 'ROLL_DICE', playerId: s.currentPlayerId! }, scriptedRng());
  }
  if (s.phase !== 'play') throw new Error(`fixture stuck in phase ${s.phase}`);
  return s;
}

/** Snapshot with every player topped up to the given resources. */
export function boosted(state: GameState, resources: Partial<ResourceCount>): GameState {
  const s: GameState = structuredClone(state);
  for (const p of s.players) {
    for (const [r, n] of Object.entries(resources)) {
      p.resources[r as ResourceType] = n as number;
    }
  }
  return s;
}

export function expectEngineError(fn: () => void, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError(${code}) but nothing was thrown`);
}

describe('test helpers', () => {
  it('hexCoords(2) yields 19 tiles', () => {
    expect(hexCoords(BOARD_RADIUS)).toHaveLength(19);
  });
  it('exports are wired', () => {
    expect(CLASSIC_MAP_ID).toBe('archipelago-classic');
    expect(typeof cornersAdjacentToCorner).toBe('function');
    expect(typeof cornersOfEdge).toBe('function');
    expect(typeof edgesAdjacentToCorner).toBe('function');
    expect(typeof tilesAdjacentToCorner).toBe('function');
    expect(typeof bankTradeRatio).toBe('function');
  });
});
