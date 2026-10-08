/**
 * Disconnect / reconnect tests (§33):
 * a player drops mid-game, misses events, reconnects with a session id,
 * receives the missed events + an authoritative snapshot, and resumes.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent, PublicGameState } from '@isleforge/game-engine';
import type { ServerMessage } from '@isleforge/protocol';

import { IsleforgeServer } from '../src/server.js';
import { serverUrl, startServer, TestClient } from './helpers.js';
import { BotDriver, readyAndStart, setupLobby } from './integration.test.js';

describe('reconnect', () => {
  let server: IsleforgeServer;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
    if (server) await server.stop();
  });

  it(
    'reconnects mid-game, replays missed events, and resumes play',
    async () => {
      server = await startServer({ reconnectGraceMs: 60000 });
      const url = serverUrl(server);
      const drivers = await setupLobby(url, ['Host', 'Alex'], { roomSize: 4 });
      for (const d of drivers) clients.push(d.client);
      await readyAndStart(drivers, 2);

      const [a, b] = drivers as [BotDriver, BotDriver];
      const driveA = a.drive();
      const driveB = b.drive();

      // Let the game progress, then drop B abruptly.
      await b.client.waitFor(() => b.version > 4, 30000);
      const lastSeq = b.lastSeq;
      const sessionId = b.sessionId;
      const playerId = b.playerId;
      expect(sessionId).not.toBe('');
      b.stop();
      b.client.terminate();

      // The server marks the seat disconnected (amber) but keeps it.
      await a.client.waitFor(() => {
        const m = a.client.lastOfType('ROOM_STATE') as Extract<
          ServerMessage,
          { type: 'ROOM_STATE' }
        > | undefined;
        return m?.room.players.find((p) => p.playerId === playerId)?.connected === false;
      });

      // Reconnect on a fresh connection with the session id + last seen seq.
      const c2 = await TestClient.connect(url);
      clients.push(c2);
      c2.send({ v: 1, type: 'RECONNECT', sessionId, lastSeq });
      const ok = (await c2.next('RECONNECT_SUCCESS')) as Extract<
        ServerMessage,
        { type: 'RECONNECT_SUCCESS' }
      >;
      expect(ok.playerId).toBe(playerId);

      // Missed events replay gaplessly from lastSeq + 1.
      const missed: GameEvent[] = ok.missedEvents;
      missed.forEach((e, i) => expect(e.seq).toBe(lastSeq + 1 + i));

      // Followed by an authoritative snapshot…
      const snap = (await c2.next('GAME_STATE')) as Extract<
        ServerMessage,
        { type: 'GAME_STATE' }
      >;
      const state = snap.state as PublicGameState;
      expect(state.players.some((p) => p.id === playerId)).toBe(true);

      // …and the seat shows connected again.
      await a.client.waitFor(() => {
        const m = a.client.lastOfType('ROOM_STATE') as Extract<
          ServerMessage,
          { type: 'ROOM_STATE' }
        > | undefined;
        return m?.room.players.find((p) => p.playerId === playerId)?.connected === true;
      });

      // Resume play on the new connection through to GAME_ENDED.
      // The driver attaches after RECONNECT_SUCCESS/GAME_STATE already
      // arrived, so seed its identity and snapshot directly.
      const b2 = new BotDriver(c2, 'normal', 'aggressive', 9999);
      b2.playerId = playerId;
      b2.sessionId = sessionId;
      b2.roomCode = a.roomCode;
      b2.state = state;
      b2.lastSeq = snap.lastSeq;
      b2.version = 1;
      const driveB2 = b2.drive();
      try {
        await Promise.all([driveA, driveB2]);
      } finally {
        a.stop();
        b2.stop();
      }
      expect(a.ended).toBe(true);
      expect(b2.ended).toBe(true);
      expect(a.winnerId).toBe(b2.winnerId);
    },
    300000,
  );

  it('rejects reconnects with unknown or revoked sessions', async () => {
    server = await startServer();
    const url = serverUrl(server);
    const c = await TestClient.connect(url);
    clients.push(c);
    c.send({ v: 1, type: 'RECONNECT', sessionId: 'nope-not-real' });
    const err = (await c.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('RECONNECT_FAILED');
  });

  it('AI-takeover keeps the game moving when a player never returns', async () => {
    server = await startServer({ reconnectGraceMs: 500 });
    const url = serverUrl(server);
    const drivers = await setupLobby(url, ['Host', 'Alex'], { roomSize: 3 });
    for (const d of drivers) clients.push(d.client);
    await readyAndStart(drivers, 1);

    const [a, b] = drivers as [BotDriver, BotDriver];
    const driveA = a.drive();
    const driveB = b.drive();
    await b.client.waitFor(() => b.version > 2, 30000);
    const seqBefore = server.getGame(a.roomCode)!.lastSeq;
    b.stop();
    b.client.terminate();

    // After the grace period the server AI pilots the seat: the game advances
    // with no human driving it.
    await a.client.waitFor(() => {
      return server.getGame(a.roomCode)!.lastSeq > seqBefore + 5;
    }, 60000);

    const m = a.client.lastOfType('ROOM_STATE') as Extract<
      ServerMessage,
      { type: 'ROOM_STATE' }
    > | undefined;
    expect(m?.room.players.find((p) => p.playerId === b.playerId)?.connected).toBe(false);

    // The game completes with A driving and B AI-piloted.
    try {
      await driveA;
    } finally {
      a.stop();
    }
    try {
      await driveB;
    } catch {
      /* already stopped */
    }
    expect(a.ended).toBe(true);
  }, 180000);
});
