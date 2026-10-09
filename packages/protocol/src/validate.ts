/**
 * Runtime validation for inbound client messages.
 *
 * TypeScript types are erased at runtime — every field of every inbound
 * message is checked here before the server acts on it. Semantic validation
 * (turn ownership, legality, affordability) happens later in the engine.
 */

import {
  CLIENT_MESSAGE_TYPES,
  DIFFICULTIES,
  MAX_CHAT_LENGTH,
  MAX_COMMAND_ID_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  PERSONALITIES,
  PROTOCOL_VERSION,
} from './types.js';
import type { ClientMessage, Difficulty, ErrorCode, Personality, WireCommand } from './types.js';

export interface ParseOk {
  ok: true;
  message: ClientMessage;
}
export interface ParseFail {
  ok: false;
  code: ErrorCode;
  message: string;
}
export type ParseResult = ParseOk | ParseFail;

const fail = (code: ErrorCode, message: string): ParseFail => ({
  ok: false,
  code,
  message,
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

const RESOURCES = ['wood', 'brick', 'grain', 'wool', 'ore'] as const;
type ResourceName = (typeof RESOURCES)[number];
const isResource = (v: unknown): v is ResourceName =>
  typeof v === 'string' && (RESOURCES as readonly string[]).includes(v);

const isNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9999;

/** A resource-count map: valid resource keys, non-negative integer values. */
function isResourceCount(v: unknown): boolean {
  if (!isRecord(v)) return false;
  for (const [k, val] of Object.entries(v)) {
    if (!isResource(k) || !isNonNegInt(val)) return false;
  }
  return true;
}

function isValidName(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.trim().length <= MAX_NAME_LENGTH
  );
}

const COMMAND_TYPES = [
  'PLACE_SETTLEMENT',
  'PLACE_ROAD',
  'ROLL_DICE',
  'DISCARD_RESOURCES',
  'MOVE_RAIDER',
  'STEAL_RESOURCE',
  'BUILD_ROAD',
  'BUILD_SETTLEMENT',
  'BUILD_CITY',
  'BUY_DEVELOPMENT_CARD',
  'PLAY_DEVELOPMENT_CARD',
  'TRADE_BANK',
  'TRADE_PROPOSE',
  'TRADE_ACCEPT',
  'TRADE_DECLINE',
  'END_TURN',
  'RESIGN',
] as const;

/**
 * Structural validation of a game command. Mirrors the engine's Command
 * union loosely: required fields present with the right primitive types.
 * The engine re-validates everything semantically on dispatch.
 */
export function validateWireCommand(cmd: unknown): ParseResult & { command?: WireCommand } {
  if (!isRecord(cmd)) return fail('INVALID_COMMAND', 'Command must be an object.');
  const { type, playerId } = cmd;
  if (typeof type !== 'string' || !(COMMAND_TYPES as readonly string[]).includes(type)) {
    return fail('INVALID_COMMAND', `Unknown command type: ${String(type)}.`);
  }
  if (!isNonEmptyString(playerId, 64)) {
    return fail('INVALID_COMMAND', 'Command playerId must be a non-empty string.');
  }
  const str = (key: string, max = 128): boolean =>
    isNonEmptyString(cmd[key], max);

  switch (type) {
    case 'PLACE_SETTLEMENT':
    case 'BUILD_SETTLEMENT':
    case 'BUILD_CITY':
      if (!str('cornerId')) return fail('INVALID_COMMAND', `${type} requires cornerId.`);
      break;
    case 'PLACE_ROAD':
    case 'BUILD_ROAD':
      if (!str('edgeId')) return fail('INVALID_COMMAND', `${type} requires edgeId.`);
      break;
    case 'MOVE_RAIDER':
      if (!str('tileKey')) return fail('INVALID_COMMAND', 'MOVE_RAIDER requires tileKey.');
      break;
    case 'STEAL_RESOURCE':
      if (!str('targetPlayerId', 64))
        return fail('INVALID_COMMAND', 'STEAL_RESOURCE requires targetPlayerId.');
      break;
    case 'DISCARD_RESOURCES':
      if (!isResourceCount(cmd['resources']))
        return fail('INVALID_COMMAND', 'DISCARD_RESOURCES requires a valid resources map.');
      break;
    case 'PLAY_DEVELOPMENT_CARD': {
      if (!str('cardUid')) return fail('INVALID_COMMAND', 'PLAY_DEVELOPMENT_CARD requires cardUid.');
      const params = cmd['params'];
      if (params !== undefined) {
        if (!isRecord(params)) return fail('INVALID_COMMAND', 'Invalid card params.');
        const { resources, resource } = params;
        if (resources !== undefined) {
          if (
            !Array.isArray(resources) ||
            resources.length !== 2 ||
            !resources.every(isResource)
          ) {
            return fail('INVALID_COMMAND', 'Card params.resources must be two resources.');
          }
        }
        if (resource !== undefined && !isResource(resource)) {
          return fail('INVALID_COMMAND', 'Card params.resource must be a resource.');
        }
      }
      break;
    }
    case 'TRADE_BANK': {
      const { give, receive } = cmd;
      if (!isResource(give) || !isResource(receive) || give === receive) {
        return fail('INVALID_COMMAND', 'TRADE_BANK requires two different resources.');
      }
      break;
    }
    case 'TRADE_PROPOSE': {
      if (!str('toPlayerId', 64))
        return fail('INVALID_COMMAND', 'TRADE_PROPOSE requires toPlayerId.');
      if (!isResourceCount(cmd['offer']) || !isResourceCount(cmd['request'])) {
        return fail('INVALID_COMMAND', 'TRADE_PROPOSE requires valid offer/request maps.');
      }
      break;
    }
    case 'TRADE_ACCEPT':
    case 'TRADE_DECLINE':
      if (!str('tradeId')) return fail('INVALID_COMMAND', `${type} requires tradeId.`);
      break;
    case 'ROLL_DICE':
    case 'BUY_DEVELOPMENT_CARD':
    case 'END_TURN':
    case 'RESIGN':
      break;
    default:
      return fail('INVALID_COMMAND', `Unhandled command type: ${type}.`);
  }
  return { ok: true, message: undefined as never, command: cmd as WireCommand };
}

const ROOM_CODE_RE = /^[A-Z0-9]{4,8}$/;

/** Room codes are uppercase alphanumerics, 4–8 chars. */
export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && ROOM_CODE_RE.test(code.toUpperCase());
}

/**
 * Parse and validate one inbound client message.
 * `byteLength` (UTF-8 length of the raw text) enforces MAX_MESSAGE_BYTES.
 */
export function parseClientMessage(data: unknown, byteLength?: number): ParseResult {
  if (byteLength !== undefined && byteLength > MAX_MESSAGE_BYTES) {
    return fail('MESSAGE_TOO_LARGE', `Message exceeds ${MAX_MESSAGE_BYTES} bytes.`);
  }
  if (!isRecord(data)) return fail('INVALID_MESSAGE', 'Message must be a JSON object.');
  if (data['v'] !== PROTOCOL_VERSION) {
    return fail(
      'INVALID_PROTOCOL_VERSION',
      `Unsupported protocol version (got ${String(data['v'])}, want ${PROTOCOL_VERSION}).`,
    );
  }
  const { type } = data;
  if (typeof type !== 'string' || !CLIENT_MESSAGE_TYPES.includes(type)) {
    return fail('INVALID_MESSAGE', `Unknown message type: ${String(type)}.`);
  }

  switch (type) {
    case 'CREATE_ROOM': {
      if (!isValidName(data['name'])) {
        return fail('INVALID_MESSAGE', 'CREATE_ROOM requires a name (1–24 chars).');
      }
      const settings = data['settings'];
      let roomSize: 3 | 4 | undefined;
      if (settings !== undefined) {
        if (!isRecord(settings)) return fail('INVALID_MESSAGE', 'Invalid room settings.');
        const rs = settings['roomSize'];
        if (rs !== undefined && rs !== 3 && rs !== 4) {
          return fail('INVALID_MESSAGE', 'roomSize must be 3 or 4.');
        }
        roomSize = rs as 3 | 4 | undefined;
      }
      return {
        ok: true,
        message: {
          v: 1,
          type: 'CREATE_ROOM',
          name: (data['name'] as string).trim(),
          ...(roomSize !== undefined ? { settings: { roomSize } } : {}),
        },
      };
    }
    case 'JOIN_ROOM': {
      if (!isValidRoomCode(data['code'])) {
        return fail('INVALID_MESSAGE', 'JOIN_ROOM requires a valid room code.');
      }
      if (!isValidName(data['name'])) {
        return fail('INVALID_MESSAGE', 'JOIN_ROOM requires a name (1–24 chars).');
      }
      return {
        ok: true,
        message: {
          v: 1,
          type: 'JOIN_ROOM',
          code: (data['code'] as string).toUpperCase(),
          name: (data['name'] as string).trim(),
        },
      };
    }
    case 'LEAVE_ROOM':
      return { ok: true, message: { v: 1, type: 'LEAVE_ROOM' } };
    case 'SET_READY': {
      if (typeof data['ready'] !== 'boolean') {
        return fail('INVALID_MESSAGE', 'SET_READY requires a boolean ready flag.');
      }
      return { ok: true, message: { v: 1, type: 'SET_READY', ready: data['ready'] } };
    }
    case 'ADD_AI': {
      const difficulty = data['difficulty'];
      const personality = data['personality'];
      if (
        difficulty !== undefined &&
        (typeof difficulty !== 'string' ||
          !(DIFFICULTIES as readonly string[]).includes(difficulty))
      ) {
        return fail('INVALID_MESSAGE', 'Invalid AI difficulty.');
      }
      if (
        personality !== undefined &&
        (typeof personality !== 'string' ||
          !(PERSONALITIES as readonly string[]).includes(personality))
      ) {
        return fail('INVALID_MESSAGE', 'Invalid AI personality.');
      }
      return {
        ok: true,
        message: {
          v: 1,
          type: 'ADD_AI',
          ...(difficulty !== undefined ? { difficulty: difficulty as Difficulty } : {}),
          ...(personality !== undefined ? { personality: personality as Personality } : {}),
        },
      };
    }
    case 'REMOVE_AI': {
      if (!isNonEmptyString(data['playerId'], 64)) {
        return fail('INVALID_MESSAGE', 'REMOVE_AI requires a playerId.');
      }
      return { ok: true, message: { v: 1, type: 'REMOVE_AI', playerId: data['playerId'] } };
    }
    case 'START_GAME':
      return { ok: true, message: { v: 1, type: 'START_GAME' } };
    case 'GAME_COMMAND': {
      if (!isNonEmptyString(data['commandId'], MAX_COMMAND_ID_LENGTH)) {
        return fail('INVALID_COMMAND', 'GAME_COMMAND requires a commandId (1–64 chars).');
      }
      const cmdRes = validateWireCommand(data['command']);
      if (!cmdRes.ok) return cmdRes;
      return {
        ok: true,
        message: { v: 1, type: 'GAME_COMMAND', commandId: data['commandId'], command: cmdRes.command! },
      };
    }
    case 'PING': {
      if (typeof data['ts'] !== 'number' || !Number.isFinite(data['ts'])) {
        return fail('INVALID_MESSAGE', 'PING requires a numeric ts.');
      }
      return { ok: true, message: { v: 1, type: 'PING', ts: data['ts'] } };
    }
    case 'RECONNECT': {
      if (!isNonEmptyString(data['sessionId'], 128)) {
        return fail('INVALID_MESSAGE', 'RECONNECT requires a sessionId.');
      }
      const lastSeq = data['lastSeq'];
      if (
        lastSeq !== undefined &&
        (typeof lastSeq !== 'number' || !Number.isInteger(lastSeq) || lastSeq < 0)
      ) {
        return fail('INVALID_MESSAGE', 'RECONNECT lastSeq must be a non-negative integer.');
      }
      return {
        ok: true,
        message: {
          v: 1,
          type: 'RECONNECT',
          sessionId: data['sessionId'],
          ...(lastSeq !== undefined ? { lastSeq } : {}),
        },
      };
    }
    case 'GAME_CHAT': {
      if (
        typeof data['text'] !== 'string' ||
        data['text'].trim().length === 0 ||
        data['text'].length > MAX_CHAT_LENGTH
      ) {
        return fail('INVALID_MESSAGE', `GAME_CHAT text must be 1–${MAX_CHAT_LENGTH} chars.`);
      }
      return { ok: true, message: { v: 1, type: 'GAME_CHAT', text: data['text'].trim() } };
    }
    case 'AUTHENTICATE': {
      if (
        typeof data['accessToken'] !== 'string' ||
        data['accessToken'].length === 0 ||
        data['accessToken'].length > 4096
      ) {
        return fail('INVALID_MESSAGE', 'AUTHENTICATE accessToken must be a non-empty string.');
      }
      return { ok: true, message: { v: 1, type: 'AUTHENTICATE', accessToken: data['accessToken'] } };
    }
    case 'QUEUE_JOIN': {
      const mode = data['mode'];
      if (mode !== undefined && mode !== 'CASUAL' && mode !== 'RANKED') {
        return fail('INVALID_MESSAGE', 'QUEUE_JOIN mode must be CASUAL or RANKED.');
      }
      return { ok: true, message: { v: 1, type: 'QUEUE_JOIN', ...(mode ? { mode } : {}) } };
    }
    case 'QUEUE_LEAVE':
      return { ok: true, message: { v: 1, type: 'QUEUE_LEAVE' } };
    case 'QUEUE_STATUS':
      return { ok: true, message: { v: 1, type: 'QUEUE_STATUS' } };
    case 'SOCIAL_SUBSCRIBE':
      return { ok: true, message: { v: 1, type: 'SOCIAL_SUBSCRIBE' } };
    case 'SOCIAL_UNSUBSCRIBE':
      return { ok: true, message: { v: 1, type: 'SOCIAL_UNSUBSCRIBE' } };
    default:
      return fail('INVALID_MESSAGE', `Unhandled message type: ${type}.`);
  }
}
