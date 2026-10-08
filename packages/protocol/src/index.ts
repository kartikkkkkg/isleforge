/**
 * @isleforge/protocol — versioned WebSocket protocol for Isleforge multiplayer.
 * Message types + runtime validators. Zero runtime dependencies.
 */

export {
  CLIENT_MESSAGE_TYPES,
  DIFFICULTIES,
  MAX_CHAT_LENGTH,
  MAX_COMMAND_ID_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  PERSONALITIES,
  PROTOCOL_VERSION,
} from './types.js';
export type {
  ChatMessage,
  ClientMessage,
  CreateRoomSettings,
  Difficulty,
  ErrorCode,
  Personality,
  RoomPlayerView,
  RoomStatus,
  RoomView,
  ServerMessage,
  WireCommand,
} from './types.js';
export {
  isValidRoomCode,
  parseClientMessage,
  validateWireCommand,
} from './validate.js';
export type { ParseFail, ParseOk, ParseResult } from './validate.js';
