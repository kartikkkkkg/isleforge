import { Game, legalCommands } from '@isleforge/game-engine';
import { createBot } from './agent.js';

const game = new Game({
  seed: 1000,
  players: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `AI-${i}` })),
});
const agents = [1, 2, 3, 4].map((i) =>
  createBot({ difficulty: 'normal', personality: 'balanced', seed: 1000 + i }),
);

function activeActor(s: ReturnType<Game['getState']>): string | null {
  if (s.phase === 'gameover') return null;
  if (s.phase === 'setup' && s.setup) return s.setup.order[s.setup.cursor] ?? null;
  if (s.phase === 'discard' && s.pendingDiscards) return Object.keys(s.pendingDiscards)[0] ?? null;
  return s.currentPlayerId;
}

let moves = 0;
let legalMs = 0;
let agentMs = 0;
const t0 = Date.now();
while (moves < 300) {
  const st = game.getState();
  if (st.phase === 'gameover') break;
  const actor = activeActor(st)!;
  const agent = agents[Number(actor.slice(1)) - 1]!;
  const t1 = Date.now();
  const legal = legalCommands(game.getState(), actor);
  const t2 = Date.now();
  const cmd = agent.chooseAction(game.getState(), actor);
  const t3 = Date.now();
  legalMs += t2 - t1;
  agentMs += t3 - t2;
  if (!cmd) { console.log('STUCK at move', moves, 'phase', st.phase); break; }
  game.dispatch(cmd);
  moves++;
  if (moves % 100 === 0) {
    console.log(`move ${moves}: turn ${st.turnNumber} phase ${st.phase} | legal ${legalMs}ms agent ${agentMs}ms total ${Date.now() - t0}ms`);
  }
}
console.log(`done: ${moves} moves, legal ${legalMs}ms, agent-overhead ${agentMs - legalMs}ms`);
