/**
 * Shared test helpers: build games, drive them to interesting states.
 */
import { Game, legalCommands, type GameState } from '@isleforge/game-engine';
import { createBot } from '../src/agent.js';
import type { BotAgent } from '../src/types.js';
import type { Difficulty, Personality } from '../src/types.js';

export function newGame(seed = 42, n = 4): Game {
  return new Game({
    seed,
    players: Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      name: `AI-${i + 1}`,
    })),
  });
}

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

export function makeAgent(
  difficulty: Difficulty = 'normal',
  personality: Personality = 'balanced',
  seed = 7,
): BotAgent {
  return createBot({ difficulty, personality, seed });
}

/** Play up to maxMoves or until cond(game) is true. Returns the game. */
export function playUntil(
  game: Game,
  agents: BotAgent[],
  cond: (g: Game) => boolean,
  maxMoves = 2000,
): Game {
  let moves = 0;
  while (moves < maxMoves && !cond(game)) {
    const st = game.getState();
    if (st.phase === 'gameover') break;
    const actor = activeActor(st);
    if (!actor) break;
    const agent = agents[Number(actor.slice(1)) - 1]!;
    const cmd = agent.chooseAction(st, actor);
    if (!cmd) break;
    game.dispatch(cmd);
    moves++;
  }
  return game;
}

/** Legal commands for the actor on the full (unmasked) state. */
export function legalFor(game: Game, actor: string) {
  return legalCommands(game.getState(), actor);
}
