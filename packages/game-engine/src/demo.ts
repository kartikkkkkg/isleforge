/**
 * Milestone 1 smoke demo: plays complete games with random legal moves.
 * Usage: npx tsx src/demo.ts [seed] [games]
 * Every command goes through the same validation + event pipeline as a
 * real client would, and each finished game is replay-verified.
 */

import { Game, replayEvents, victoryPoints } from './index.js';
import { mulberry32 } from './rng.js';

function playOne(seed: number, verbose: boolean): { winner: string | null; turns: number; events: number } {
  const game = new Game({
    seed,
    players: [{ name: 'Ash' }, { name: 'Bryn' }, { name: 'Cora' }, { name: 'Dev' }],
  });
  const rng = mulberry32((seed ^ 0xd3d0) >>> 0);
  let guard = 0;

  while (game.getState().phase !== 'gameover' && guard++ < 8000) {
    let s = game.getState();

    // Keep the flow moving: decline trades addressed to anyone but the actor.
    let actor: string | null;
    if (s.phase === 'discard' && s.pendingDiscards) {
      actor = Object.keys(s.pendingDiscards)[0] ?? null;
    } else if (s.phase === 'setup' && s.setup) {
      actor = s.setup.order[s.setup.cursor] ?? null;
    } else {
      actor = s.currentPlayerId;
    }
    if (!actor) break;

    for (const t of s.pendingTrades) {
      if (t.toPlayerId !== actor) {
        game.dispatch({ type: 'TRADE_DECLINE', playerId: t.toPlayerId, tradeId: t.id });
      }
    }
    s = game.getState();

    const legal = game
      .legalCommands(actor)
      .filter((c) => c.type !== 'TRADE_PROPOSE' && c.type !== 'RESIGN');
    if (legal.length === 0) {
      console.log(`  STUCK: phase=${s.phase} actor=${actor}`);
      break;
    }
    // Bias toward productive moves so demo games finish in reasonable time.
    const productive = legal.filter(
      (c) =>
        c.type === 'BUILD_ROAD' ||
        c.type === 'BUILD_SETTLEMENT' ||
        c.type === 'BUILD_CITY' ||
        c.type === 'BUY_DEVELOPMENT_CARD' ||
        c.type === 'PLAY_DEVELOPMENT_CARD',
    );
    const pool = productive.length > 0 && rng.next() < 0.85 ? productive : legal;
    const cmd = pool[rng.int(pool.length)] as (typeof legal)[number];
    game.dispatch(cmd);
    if (guard % 500 === 0) {
      const st = game.getState();
      console.log(`  ... turn ${st.turnNumber}, ${st.events.length} events so far`);
    }
  }

  const end = game.getState();
  // Replay-verify: rebuilding from the event log must reproduce the state.
  const replayed = replayEvents(game.getEvents());
  const a = JSON.stringify({ ...end, events: [] });
  const b = JSON.stringify({ ...replayed, events: [] });
  if (a !== b) throw new Error(`replay mismatch on seed ${seed}`);

  if (verbose) {
    console.log(`seed=${seed} winner=${end.winnerId} turns=${end.turnNumber} events=${end.events.length}`);
    for (const p of end.players) {
      const vp = victoryPoints(p, end);
      console.log(
        `  ${p.name}: vp=${vp.total} (public ${vp.public}) settlements=${p.settlements.length} ` +
          `cities=${p.cities.length} roads=${p.roads.length} guardians=${p.guardiansPlayed}`,
      );
    }
  }
  return { winner: end.winnerId, turns: end.turnNumber, events: end.events.length };
}

const seedArg = Number(process.argv[2] ?? '1');
const gamesArg = Number(process.argv[3] ?? '3');
for (let i = 0; i < gamesArg; i++) {
  playOne(seedArg + i, true);
}
console.log('demo complete — all games replay-verified');
