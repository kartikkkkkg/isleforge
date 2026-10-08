import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_LENGTH,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  validateWireCommand,
} from '../src/index.js';

const v = (msg: unknown, bytes?: number) => parseClientMessage(msg, bytes);

describe('protocol envelope', () => {
  it('rejects non-objects and bad JSON shapes', () => {
    expect(v(null).ok).toBe(false);
    expect(v('hello').ok).toBe(false);
    expect(v([]).ok).toBe(false);
  });

  it('rejects wrong protocol versions', () => {
    const r = v({ v: 2, type: 'PING', ts: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_PROTOCOL_VERSION');
  });

  it('rejects unknown message types', () => {
    const r = v({ v: 1, type: 'HACK_THE_PLANET' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_MESSAGE');
  });

  it('rejects oversized messages', () => {
    const r = v({ v: 1, type: 'PING', ts: 1 }, MAX_MESSAGE_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('MESSAGE_TOO_LARGE');
  });
});

describe('room messages', () => {
  it('accepts a valid CREATE_ROOM', () => {
    const r = v({ v: 1, type: 'CREATE_ROOM', name: 'Kartik' });
    expect(r.ok).toBe(true);
  });

  it('rejects empty or overlong names', () => {
    expect(v({ v: 1, type: 'CREATE_ROOM', name: '   ' }).ok).toBe(false);
    expect(v({ v: 1, type: 'CREATE_ROOM', name: 'x'.repeat(25) }).ok).toBe(false);
    expect(v({ v: 1, type: 'CREATE_ROOM' }).ok).toBe(false);
  });

  it('validates roomSize', () => {
    expect(v({ v: 1, type: 'CREATE_ROOM', name: 'A', settings: { roomSize: 3 } }).ok).toBe(true);
    expect(v({ v: 1, type: 'CREATE_ROOM', name: 'A', settings: { roomSize: 5 } }).ok).toBe(false);
  });

  it('validates JOIN_ROOM codes', () => {
    expect(v({ v: 1, type: 'JOIN_ROOM', code: 'a7k9p', name: 'A' }).ok).toBe(true);
    const r = v({ v: 1, type: 'JOIN_ROOM', code: 'a7k9p', name: 'A' });
    if (r.ok && r.message.type === 'JOIN_ROOM') expect(r.message.code).toBe('A7K9P');
    expect(v({ v: 1, type: 'JOIN_ROOM', code: '!!!', name: 'A' }).ok).toBe(false);
    expect(v({ v: 1, type: 'JOIN_ROOM', code: 'ABC', name: 'A' }).ok).toBe(false);
  });

  it('validates SET_READY / ADD_AI / REMOVE_AI', () => {
    expect(v({ v: 1, type: 'SET_READY', ready: true }).ok).toBe(true);
    expect(v({ v: 1, type: 'SET_READY', ready: 'yes' }).ok).toBe(false);
    expect(v({ v: 1, type: 'ADD_AI', difficulty: 'hard' }).ok).toBe(true);
    expect(v({ v: 1, type: 'ADD_AI', difficulty: 'impossible' }).ok).toBe(false);
    expect(v({ v: 1, type: 'REMOVE_AI', playerId: 'p2' }).ok).toBe(true);
  });
});

describe('game command validation', () => {
  it('accepts structurally valid commands', () => {
    const r = validateWireCommand({ type: 'ROLL_DICE', playerId: 'p1' });
    expect(r.ok).toBe(true);
  });

  it('rejects unknown command types', () => {
    const r = validateWireCommand({ type: 'GRANT_ALL_RESOURCES', playerId: 'p1' });
    expect(r.ok).toBe(false);
  });

  it('rejects commands missing required fields', () => {
    expect(validateWireCommand({ type: 'BUILD_ROAD', playerId: 'p1' }).ok).toBe(false);
    expect(
      validateWireCommand({ type: 'BUILD_ROAD', playerId: 'p1', edgeId: 'e1' }).ok,
    ).toBe(true);
  });

  it('validates resource maps', () => {
    expect(
      validateWireCommand({
        type: 'DISCARD_RESOURCES',
        playerId: 'p1',
        resources: { wood: 2, gold: 1 },
      }).ok,
    ).toBe(false);
    expect(
      validateWireCommand({
        type: 'DISCARD_RESOURCES',
        playerId: 'p1',
        resources: { wood: 2, brick: -1 },
      }).ok,
    ).toBe(false);
    expect(
      validateWireCommand({
        type: 'DISCARD_RESOURCES',
        playerId: 'p1',
        resources: { wood: 2, brick: 1 },
      }).ok,
    ).toBe(true);
  });

  it('validates bank trades', () => {
    expect(
      validateWireCommand({ type: 'TRADE_BANK', playerId: 'p1', give: 'wood', receive: 'wood' })
        .ok,
    ).toBe(false);
    expect(
      validateWireCommand({ type: 'TRADE_BANK', playerId: 'p1', give: 'wood', receive: 'ore' })
        .ok,
    ).toBe(true);
  });

  it('wraps GAME_COMMAND with commandId checks', () => {
    const good = {
      v: 1,
      type: 'GAME_COMMAND',
      commandId: 'cmd_1',
      command: { type: 'END_TURN', playerId: 'p1' },
    };
    expect(v(good).ok).toBe(true);
    expect(v({ ...good, commandId: '' }).ok).toBe(false);
    expect(v({ ...good, command: { type: 'END_TURN' } }).ok).toBe(false);
  });
});

describe('chat and misc', () => {
  it('validates chat length', () => {
    expect(v({ v: 1, type: 'GAME_CHAT', text: 'hi' }).ok).toBe(true);
    expect(v({ v: 1, type: 'GAME_CHAT', text: '' }).ok).toBe(false);
    expect(v({ v: 1, type: 'GAME_CHAT', text: 'x'.repeat(MAX_CHAT_LENGTH + 1) }).ok).toBe(
      false,
    );
  });

  it('validates RECONNECT', () => {
    expect(v({ v: 1, type: 'RECONNECT', sessionId: 'abc' }).ok).toBe(true);
    expect(v({ v: 1, type: 'RECONNECT', sessionId: 'abc', lastSeq: -1 }).ok).toBe(false);
    expect(v({ v: 1, type: 'RECONNECT' }).ok).toBe(false);
  });

  it('validates PING', () => {
    expect(v({ v: 1, type: 'PING', ts: 123 }).ok).toBe(true);
    expect(v({ v: 1, type: 'PING', ts: 'now' }).ok).toBe(false);
  });
});
