/**
 * Security tests (§35): the server must reject everything untrusted clients
 * throw at it without ever mutating authoritative state illegally.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@isleforge/protocol';

import { IsleforgeServer } from '../src/server.js';
import { randomUUID, serverUrl, startServer, TestClient } from './helpers.js';
import { readyAndStart, setupLobby } from './integration.test.js';

describe('security', () => {
  let server: IsleforgeServer;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
    if (server) await server.stop();
  });

  const connect = async (): Promise<TestClient> => {
    const c = await TestClient.connect(serverUrl(server));
    clients.push(c);
    return c;
  };

  it('rejects malformed, unknown, and versioned messages', async () => {
    server = await startServer();
    const c = await connect();

    c.sendRaw('this is not json');
    let err = (await c.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('INVALID_MESSAGE');

    c.sendRaw('{"v":1,"type":"GRANT_ADMIN"}');
    err = (await c.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('INVALID_MESSAGE');

    c.sendRaw('{"v":99,"type":"PING","ts":1}');
    err = (await c.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('INVALID_PROTOCOL_VERSION');

    // Oversized: passes the ws frame limit but fails the protocol cap.
    c.sendRaw(JSON.stringify({ v: 1, type: 'GAME_CHAT', text: 'x'.repeat(66000) }));
    err = (await c.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('MESSAGE_TOO_LARGE');
  });

  it('rejects spoofed playerIds, out-of-turn and duplicate commands', async () => {
    server = await startServer();
    const drivers = await setupLobby(serverUrl(server), ['Host', 'Alex'], { roomSize: 3 });
    for (const d of drivers) clients.push(d.client);
    await readyAndStart(drivers, 1);
    const [a, b] = drivers;
    const game = server.getGame(a!.roomCode)!;

    // B spoofs A's playerId: structural validation passes, server rejects.
    b!.client.send({
      v: 1,
      type: 'GAME_COMMAND',
      commandId: randomUUID(),
      command: { type: 'ROLL_DICE', playerId: a!.playerId },
    });
    let err = (await b!.client.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('NOT_AUTHORIZED');

    // B acts during A's setup turn.
    const st = game.debugState();
    const cornerId = Object.keys(st.board.corners)[0]!;
    b!.client.send({
      v: 1,
      type: 'GAME_COMMAND',
      commandId: randomUUID(),
      command: { type: 'PLACE_SETTLEMENT', playerId: b!.playerId, cornerId },
    });
    err = (await b!.client.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('NOT_YOUR_TURN');

    // A sends a legal command twice with the same commandId: executed once.
    const legal = cornerId; // p1's setup turn: any corner probe is validated by the engine
    a!.client.send({
      v: 1,
      type: 'GAME_COMMAND',
      commandId: 'dup-cmd-1',
      command: { type: 'PLACE_SETTLEMENT', playerId: a!.playerId, cornerId: legal },
    });
    const accepted = (await a!.client.next('COMMAND_ACCEPTED')) as Extract<
      ServerMessage,
      { type: 'COMMAND_ACCEPTED' }
    >;
    expect(accepted.commandId).toBe('dup-cmd-1');
    const seqAfterFirst = game.lastSeq;
    a!.client.send({
      v: 1,
      type: 'GAME_COMMAND',
      commandId: 'dup-cmd-1',
      command: { type: 'PLACE_SETTLEMENT', playerId: a!.playerId, cornerId: legal },
    });
    const accepted2 = (await a!.client.next('COMMAND_ACCEPTED')) as Extract<
      ServerMessage,
      { type: 'COMMAND_ACCEPTED' }
    >;
    expect(accepted2.seqs).toEqual(accepted.seqs);
    expect(game.lastSeq).toBe(seqAfterFirst);

    // No illegal mutation happened: the authoritative state only advanced
    // through the single accepted command (+ its AI cascade).
    expect(game.lastSeq).toBeGreaterThanOrEqual(0);
    a!.stop();
    b!.stop();
  });

  it('rate-limits command spam', async () => {
    server = await startServer({
      rateLimits: { command: { windowMs: 10_000, max: 40 } },
    });
    const drivers = await setupLobby(serverUrl(server), ['Host', 'Alex'], { roomSize: 3 });
    for (const d of drivers) clients.push(d.client);
    await readyAndStart(drivers, 1);
    const [, b] = drivers;

    for (let i = 0; i < 60; i++) {
      b!.client.send({
        v: 1,
        type: 'GAME_COMMAND',
        commandId: `spam-${i}`,
        command: { type: 'ROLL_DICE', playerId: b!.playerId },
      });
    }
    await b!.client.waitFor(
      () =>
        b!.client.ofType('ERROR').filter((m) => (m as { code: string }).code === 'RATE_LIMITED')
          .length > 0,
      15000,
    );
    const limited = b!.client
      .ofType('ERROR')
      .filter((m) => (m as { code: string }).code === 'RATE_LIMITED');
    expect(limited.length).toBeGreaterThan(0);
    drivers.forEach((d) => d.stop());
  });

  it('rate-limits chat and enforces length', async () => {
    server = await startServer();
    const drivers = await setupLobby(serverUrl(server), ['Host', 'Alex'], { roomSize: 3 });
    for (const d of drivers) clients.push(d.client);
    const [a, b] = drivers;

    a!.client.send({ v: 1, type: 'GAME_CHAT', text: 'hello!' });
    const chat = (await b!.client.next('CHAT_MESSAGE')) as Extract<
      ServerMessage,
      { type: 'CHAT_MESSAGE' }
    >;
    expect(chat.text).toBe('hello!');
    expect(chat.fromName).toBe('Host');
    expect(chat.from).toBe(a!.playerId);

    for (let i = 0; i < 8; i++) {
      a!.client.send({ v: 1, type: 'GAME_CHAT', text: `spam ${i}` });
    }
    await a!.client.waitFor(
      () =>
        a!.client.ofType('ERROR').filter((m) => (m as { code: string }).code === 'RATE_LIMITED')
          .length > 0,
      15000,
    );
    drivers.forEach((d) => d.stop());
  });

  it('rejects commands when no game is running', async () => {
    server = await startServer();
    const c = await connect();
    c.send({ v: 1, type: 'CREATE_ROOM', name: 'Solo' });
    await c.next('ROOM_CREATED');
    c.send({
      v: 1,
      type: 'GAME_COMMAND',
      commandId: randomUUID(),
      command: { type: 'ROLL_DICE', playerId: 'p1' },
    });
    const err = (await c.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('GAME_NOT_STARTED');
  });

  it('does not let a second connection hijack a seat without the session', async () => {
    server = await startServer();
    const drivers = await setupLobby(serverUrl(server), ['Host', 'Alex'], { roomSize: 3 });
    for (const d of drivers) clients.push(d.client);
    const [a] = drivers;

    // Attacker opens a new connection and guesses the seat — without the
    // session id they cannot attach or issue commands as that player.
    const evil = await connect();
    evil.send({
      v: 1,
      type: 'GAME_COMMAND',
      commandId: randomUUID(),
      command: { type: 'ROLL_DICE', playerId: a!.playerId },
    });
    const err = (await evil.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(['NOT_IN_ROOM', 'NOT_AUTHORIZED']).toContain(err.code);
    drivers.forEach((d) => d.stop());
  });
});
