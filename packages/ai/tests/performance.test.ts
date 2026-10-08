/**
 * Decision latency. The dominant cost is the engine's legalCommands()
 * (~50ms in busy play phases — the engine probes each candidate); the AI's
 * own scoring adds ~8ms. The UI presents AI moves on a 700ms cadence, so
 * these budgets are comfortably imperceptible. Targets are set with headroom
 * over measured p95s (see AI_ARCHITECTURE.md).
 */
import { describe, expect, it } from 'vitest';
import { activeActor, makeAgent, newGame, playUntil } from './helpers.js';
import type { Difficulty } from '../src/types.js';

const TARGETS: Record<Difficulty, number> = {
  easy: 100,
  normal: 150,
  hard: 300,
  expert: 600,
};

describe('performance', () => {
  for (const difficulty of Object.keys(TARGETS) as Difficulty[]) {
    it(`${difficulty} decides within ${TARGETS[difficulty]}ms (p95)`, () => {
      const samples: number[] = [];
      // Sample across fresh games so an early game-over can't starve us.
      for (let g = 0; g < 6 && samples.length < 40; g++) {
        const game = newGame(42 + g);
        const agents = [1, 2, 3, 4].map(() => makeAgent(difficulty, 'balanced', 7));
        playUntil(game, agents, (x) => x.getState().turnNumber >= 12, 1500);
        for (let i = 0; i < 15 && samples.length < 40; i++) {
          const st = game.getState();
          if (st.phase === 'gameover') break;
          const actor = activeActor(st);
          if (!actor) break;
          const agent = agents[Number(actor.slice(1)) - 1]!;
          const t0 = Date.now();
          const cmd = agent.chooseAction(st, actor);
          samples.push(Date.now() - t0);
          if (!cmd) break;
          game.dispatch(cmd);
        }
      }
      expect(samples.length).toBeGreaterThan(10);
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.floor(samples.length * 0.95)]!;
      const max = samples[samples.length - 1]!;
      console.log(`${difficulty}: p95=${p95}ms max=${max}ms over ${samples.length} decisions`);
      expect(p95).toBeLessThan(TARGETS[difficulty]);
    }, 240000);
  }
});
