/**
 * Room lifecycle over real WebSockets: create, join, ready, AI seats,
 * host migration, leaving, and start-game gating.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomView, ServerMessage } from '@isleforge/protocol';

import { IsleforgeServer } from '../src/server.js';
import { serverUrl, startServer, TestClient } from './helpers.js';

describe('rooms', () => {
  let server: IsleforgeServer;
  let url: string;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    server = await startServer();
    url = serverUrl(server);
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
    await server.stop();
  });

  const connect = async (): Promise<TestClient> => {
    const c = await TestClient.connect(url);
    clients.push(c);
    return c;
  };

  const createRoom = async (
    c: TestClient,
    name = 'Host',
  ): Promise<{ room: RoomView; sessionId: string; playerId: string }> => {
    c.send({ v: 1, type: 'CREATE_ROOM', name });
    const m = (await c.next('ROOM_CREATED')) as Extract<ServerMessage, { type: 'ROOM_CREATED' }>;
    return { room: m.room, sessionId: m.sessionId, playerId: m.playerId };
  };

  it('creates a room with a short code and host seat', async () => {
    const c = await connect();
    const { room, playerId } = await createRoom(c, 'Kartik');
    expect(room.code).toMatch(/^[A-Z0-9]{5}$/);
    expect(room.status).toBe('WAITING');
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.name).toBe('Kartik');
    expect(room.players[0]!.isHost).toBe(true);
    expect(playerId).toBe('p1');
  });

  it('joins a room by code (case-insensitive) and broadcasts presence', async () => {
    const a = await connect();
    const { room } = await createRoom(a, 'Host');
    const b = await connect();
    b.send({ v: 1, type: 'JOIN_ROOM', code: room.code.toLowerCase(), name: 'Alex' });
    const created = (await b.next('ROOM_CREATED')) as Extract<
      ServerMessage,
      { type: 'ROOM_CREATED' }
    >;
    expect(created.room.players).toHaveLength(2);
    expect(created.playerId).toBe('p2');

    const joined = (await a.next('PLAYER_JOINED')) as Extract<
      ServerMessage,
      { type: 'PLAYER_JOINED' }
    >;
    expect(joined.player.name).toBe('Alex');
    const state = (await a.next('ROOM_STATE')) as Extract<ServerMessage, { type: 'ROOM_STATE' }>;
    expect(state.room.players).toHaveLength(2);
  });

  it('rejects joining unknown rooms and duplicate names', async () => {
    const c = await connect();
    c.send({ v: 1, type: 'JOIN_ROOM', code: 'ZZZZZ', name: 'X' });
    const err = (await c.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('ROOM_NOT_FOUND');

    const { room } = await createRoom(c, 'Host');
    const d = await connect();
    d.send({ v: 1, type: 'JOIN_ROOM', code: room.code, name: 'host' });
    const err2 = (await d.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err2.code).toBe('NAME_TAKEN');
  });

  it('tracks ready state and lets the host manage AI seats', async () => {
    const host = await connect();
    const { room, playerId } = await createRoom(host, 'Host');
    expect(playerId).toBe('p1');

    // Non-host cannot add AI.
    const guest = await connect();
    guest.send({ v: 1, type: 'JOIN_ROOM', code: room.code, name: 'Guest' });
    await guest.next('ROOM_CREATED');
    await guest.next('PLAYER_JOINED');
    await guest.next('ROOM_STATE');
    await host.next('PLAYER_JOINED');
    await host.next('ROOM_STATE');
    guest.send({ v: 1, type: 'ADD_AI', difficulty: 'hard' });
    const err = (await guest.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('NOT_HOST');

    // Host adds two AI seats.
    host.send({ v: 1, type: 'ADD_AI', difficulty: 'easy' });
    await host.next('ROOM_STATE');
    host.send({ v: 1, type: 'ADD_AI', personality: 'aggressive' });
    const st = (await host.next('ROOM_STATE')) as Extract<ServerMessage, { type: 'ROOM_STATE' }>;
    expect(st.room.players).toHaveLength(4);
    const bots = st.room.players.filter((p) => p.isBot);
    expect(bots).toHaveLength(2);
    expect(bots[0]!.difficulty).toBe('easy');
    expect(bots[1]!.personality).toBe('aggressive');
    expect(bots.every((b) => b.ready)).toBe(true);

    // Host removes one AI.
    host.send({ v: 1, type: 'REMOVE_AI', playerId: bots[0]!.playerId });
    const st2 = (await host.next('ROOM_STATE')) as Extract<ServerMessage, { type: 'ROOM_STATE' }>;
    expect(st2.room.players.filter((p) => p.isBot)).toHaveLength(1);
  });

  it('migrates host when the host leaves a waiting room', async () => {
    const host = await connect();
    const { room } = await createRoom(host, 'Host');
    const guest = await connect();
    guest.send({ v: 1, type: 'JOIN_ROOM', code: room.code, name: 'Guest' });
    await guest.next('ROOM_CREATED');
    await guest.next('PLAYER_JOINED');
    await guest.next('ROOM_STATE');
    await host.next('PLAYER_JOINED');
    await host.next('ROOM_STATE');

    host.send({ v: 1, type: 'LEAVE_ROOM' });
    const left = (await guest.next('PLAYER_LEFT')) as Extract<
      ServerMessage,
      { type: 'PLAYER_LEFT' }
    >;
    expect(left.playerId).toBe('p1');
    const st = (await guest.next('ROOM_STATE')) as Extract<ServerMessage, { type: 'ROOM_STATE' }>;
    expect(st.room.hostPlayerId).toBe('p2');
    expect(st.room.players[0]!.isHost).toBe(true);
  });

  it('gates START_GAME: needs 2+ ready humans and full seats', async () => {
    const host = await connect();
    const { room } = await createRoom(host, 'Host');

    // Fill to 4 seats with AI but only one human: cannot start.
    host.send({ v: 1, type: 'ADD_AI' });
    await host.next('ROOM_STATE');
    host.send({ v: 1, type: 'ADD_AI' });
    await host.next('ROOM_STATE');
    host.send({ v: 1, type: 'ADD_AI' });
    await host.next('ROOM_STATE');
    host.send({ v: 1, type: 'START_GAME' });
    const err = (await host.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err.code).toBe('INVALID_GAME_STATE');

    // Fresh room: two humans + two AI, host ready but guest not: cannot start.
    const host2 = await connect();
    const created = await createRoom(host2, 'H2');
    const guest2 = await connect();
    guest2.send({ v: 1, type: 'JOIN_ROOM', code: created.room.code, name: 'G2' });
    await guest2.next('ROOM_CREATED');
    await guest2.next('PLAYER_JOINED');
    await guest2.next('ROOM_STATE');
    await host2.next('PLAYER_JOINED');
    await host2.next('ROOM_STATE');
    host2.send({ v: 1, type: 'ADD_AI' });
    await host2.next('ROOM_STATE');
    host2.send({ v: 1, type: 'ADD_AI' });
    await host2.next('ROOM_STATE');
    host2.send({ v: 1, type: 'SET_READY', ready: true });
    await host2.next('ROOM_STATE');
    host2.send({ v: 1, type: 'START_GAME' });
    const err2 = (await host2.next('ERROR')) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(err2.code).toBe('INVALID_GAME_STATE');

    // Everyone ready: starts.
    guest2.send({ v: 1, type: 'SET_READY', ready: true });
    await guest2.waitFor(() => {
      const m = guest2.lastOfType('ROOM_STATE') as Extract<
        ServerMessage,
        { type: 'ROOM_STATE' }
      > | undefined;
      return m?.room.players.find((p) => p.name === 'G2')?.ready === true;
    });
    host2.send({ v: 1, type: 'START_GAME' });
    const started = (await host2.next('GAME_STARTED')) as Extract<
      ServerMessage,
      { type: 'GAME_STARTED' }
    >;
    expect(started.gameId).toMatch(/^g[0-9a-f]+$/);
    const snap = await host2.next('GAME_STATE');
    expect(snap.type).toBe('GAME_STATE');
    expect(room.code).not.toBe(created.room.code);
  });

  it('closes the room when the last player leaves', async () => {
    const c = await connect();
    const { room } = await createRoom(c, 'Solo');
    c.send({ v: 1, type: 'LEAVE_ROOM' });
    await c.waitFor(() => server.rooms.getRoom(room.code) === undefined);
    expect(server.rooms.getRoom(room.code)).toBeUndefined();
  });
});
