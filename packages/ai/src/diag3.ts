import { Game, legalCommands } from '@isleforge/game-engine';
import { createBot } from './agent.js';

// Reconstruct a rich mid-game state by playing with the agent, then inspect
// one AI's scored actions when it holds buildable resources.
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

// Play until AI-3 (p3) has a play phase with 4+ wood/brick/grain/wool.
let moves = 0;
let inspected = false;
while (moves < 3000 && !inspected) {
  const st = game.getState();
  if (st.phase === 'gameover') break;
  const actor = activeActor(st)!;
  const agent = agents[Number(actor.slice(1)) - 1]!;
  if (actor === 'p3' && st.phase === 'play') {
    const p3 = st.players.find((p) => p.id === 'p3')!;
    if (p3.resources.wood >= 2 && p3.resources.brick >= 2 && p3.resources.grain >= 2 && p3.resources.wool >= 2) {
      const legal = legalCommands(st, 'p3', { skipTradePropose: true });
      console.log('p3 resources:', JSON.stringify(p3.resources));
      console.log('legal types:', [...new Set(legal.map((c) => c.type))].join(','));
      const d = agent.lastDecision;
      // force a decision to populate lastDecision
      agent.chooseAction(st, 'p3');
      const dd = agent.lastDecision!;
      console.log('goal:', dd.goal);
      for (const c of dd.candidates.slice(0, 12)) {
        console.log(`  ${c.score.toFixed(1)} ${c.label}`);
      }
      console.log('reasons for best:', JSON.stringify(dd.reasons));
      inspected = true;
      break;
    }
  }
  const cmd = agent.chooseAction(st, actor);
  if (!cmd) break;
  game.dispatch(cmd);
  moves++;
}
console.log('moves:', moves, 'inspected:', inspected);
