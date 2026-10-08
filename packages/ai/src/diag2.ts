import { Game } from '@isleforge/game-engine';
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

const counts: Record<string, number> = {};
let moves = 0;
const t0 = Date.now();
while (moves < 3000) {
  const st = game.getState();
  if (st.phase === 'gameover') break;
  const actor = activeActor(st)!;
  const agent = agents[Number(actor.slice(1)) - 1]!;
  const cmd = agent.chooseAction(st, actor);
  if (!cmd) { console.log('STUCK', st.phase, actor); break; }
  counts[cmd.type] = (counts[cmd.type] ?? 0) + 1;
  game.dispatch(cmd);
  moves++;
  if (moves % 500 === 0) {
    console.log(`move ${moves}: turn ${st.turnNumber} phase ${st.phase} elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
const st = game.getState();
console.log(`finished: moves=${moves} turn=${st.turnNumber} phase=${st.phase} winner=${st.winnerId}`);
console.log(JSON.stringify(counts));
for (const p of st.players) {
  console.log(p.name, 'vp=', p.settlements.length + p.cities.length * 2, 'sett=', p.settlements.length, 'city=', p.cities.length, 'road=', p.roads.length, 'res=', JSON.stringify(p.resources));
}
