/**
 * Full multiplayer integration test (§31):
 *
 *   4 bot-driven clients -> create room -> join -> ready -> start ->
 *   play a complete game over real WebSockets -> GAME_ENDED on all clients.
 *
 * Also verifies §32 consistency (client state == server authoritative state)
 * and §26 event ordering (gapless, monotonic seqs).
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent, GameState, PublicGameState } from '@isleforge/game-engine';
import type { ServerMessage } from '@isleforge/protocol';
import { BotDriver, readyAndStart, setupLobby } from './bot-driver.js';

import { IsleforgeServer } from '../src/server.js';
import { randomUUID, serverUrl, sleep, startServer, TestClient } from './helpers.js';

function activeActor(state: PublicGameState): string | null {
  if (state.phase === 'gameover') return null;
  if (state.phase === 'setup' && state.setup) return state.setup.order[state.setup.cursor] ?? null;
  if (state.phase === 'discard' && state.pendingDiscards) {
    return Object.keys(state.pendingDiscards)[0] ?? null;
  }
  return state.currentPlayerId;
}

/** A test client piloted by a local @isleforge/ai bot. */
describe('multiplayer integration', () => {
  let server: IsleforgeServer;
  let url: string;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
    if (server) await server.stop();
  });

  it(
    'plays a full 4-player game to victory with consistent state',
    async () => {
      server = await startServer();
      url = serverUrl(server);
      const drivers = await setupLobby(url, ['Host', 'Alex', 'Sam', 'Jordan']);
      for (const d of drivers) clients.push(d.client);
      await readyAndStart(drivers);

      try {
        await Promise.all(drivers.map((d) => d.drive()));
      } finally {
        for (const d of drivers) d.stop();
      }

      // Every client observed the ending and agrees on the winner.
      for (const d of drivers) {
        expect(d.ended).toBe(true);
      }
      const winners = new Set(drivers.map((d) => d.winnerId));
      expect(winners.size).toBe(1);
      const winnerId = drivers[0]!.winnerId;
      expect(winnerId).not.toBeNull();

      const game = server.getGame(drivers[0]!.roomCode)!;
      expect(game).toBeDefined();
      expect(game.isEnded()).toBe(true);
      expect(game.getWinnerId()).toBe(winnerId);

      for (const d of drivers) {
        // §26: event stream is gapless and monotonically sequenced.
        const serverSeqs = new Set(game.eventsAfter(-1).map((e) => e.seq));
        const clientSeqs = new Set(d.events.map((e) => e.seq));
        const missing = [...serverSeqs].filter((s) => !clientSeqs.has(s));
        const extra = [...clientSeqs].filter((s) => !serverSeqs.has(s));
        if (missing.length > 0 || extra.length > 0) {
          console.log(
            `DRIVER ${d.playerId}: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)} ` +
              `missingTypes=${JSON.stringify(missing.map((s) => game.eventsAfter(-1).find((e) => e.seq === s)?.type))}`,
          );
        }
        expect(d.events.length).toBe(d.lastSeq + 1);
        d.events.forEach((e, i) => expect(e.seq).toBe(i));
        // The final snapshot carries the game-over event.
        expect(d.events[d.events.length - 1]!.type).toBe('GAME_ENDED');

        // §32: client state == server authoritative masked state.
        const authoritative = game.snapshotFor(d.playerId).state;
        expect(JSON.stringify(d.state)).toBe(JSON.stringify(authoritative));

        // Hidden info stayed hidden: no opponent card types leaked.
        for (const p of d.state!.players) {
          if (p.id === d.playerId) continue;
          for (const c of p.devCards) {
            expect(c.type).toBe('hidden');
          }
        }
      }
    },
    300000,
  );

  it(
    'supports 2 humans + 2 server AI to a full game',
    async () => {
      server = await startServer();
      url = serverUrl(server);
      const drivers = await setupLobby(url, ['Host', 'Alex']);
      for (const d of drivers) clients.push(d.client);
      await readyAndStart(drivers, 2);

      try {
        await Promise.all(drivers.map((d) => d.drive()));
      } finally {
        for (const d of drivers) d.stop();
      }
      for (const d of drivers) expect(d.ended).toBe(true);
      expect(new Set(drivers.map((d) => d.winnerId)).size).toBe(1);
    },
    300000,
  );
});
