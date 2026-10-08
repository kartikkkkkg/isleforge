# Isleforge Multiplayer Protocol — v1

JSON over WebSocket. Every message carries `v: 1`. The server rejects any
message with a missing/unknown `v` (`INVALID_PROTOCOL_VERSION`), any unknown
`type` (`INVALID_MESSAGE`), and any text frame over 64 KiB
(`MESSAGE_TOO_LARGE`).

Types live in `@isleforge/protocol` (`src/types.ts`); runtime validation in
`src/validate.ts`. Both server and web client import them — the contract is
defined once.

## Client → Server

| Type | Fields | Notes |
|---|---|---|
| `CREATE_ROOM` | `name` (1–24), `settings.roomSize?` (3\|4) | → `ROOM_CREATED`. Rate-limited 5/min. |
| `JOIN_ROOM` | `code` (4–8 alnum, case-insensitive), `name` | → `ROOM_CREATED` + `PLAYER_JOINED` broadcast. Only into `WAITING` rooms. |
| `LEAVE_ROOM` | — | Frees the seat (`WAITING`) or marks disconnected (`IN_GAME`). |
| `SET_READY` | `ready: boolean` | Humans only, `WAITING` only. |
| `ADD_AI` | `difficulty?`, `personality?` | Host only, `WAITING` only. |
| `REMOVE_AI` | `playerId` | Host only, `WAITING` only. |
| `START_GAME` | — | Host only. Needs 2+ humans, all ready, seats filled. |
| `GAME_COMMAND` | `commandId` (1–64, idempotency key), `command` | `command` is structurally validated, then engine-dispatched. `command.playerId` must equal the session's player. Rate-limited 40/10s. |
| `PING` | `ts: number` | → `PONG`. |
| `RECONNECT` | `sessionId`, `lastSeq?: number` | → `RECONNECT_SUCCESS` (+ missed events + snapshot) or `ERROR/RECONNECT_FAILED`. Rate-limited 10/min. |
| `GAME_CHAT` | `text` (1–200) | → `CHAT_MESSAGE` broadcast. Rate-limited 5/10s. |

`command` shapes mirror the engine's `Command` union and are validated
field-by-field (required ids, resource maps with non-negative integers, valid
resource/card values). Semantic validation (turn, legality, cost) is the
engine's job at dispatch.

## Server → Client

| Type | Fields | Notes |
|---|---|---|
| `ROOM_CREATED` | `room: RoomView`, `sessionId`, `playerId` | Your seat credentials. Persist `sessionId`. |
| `ROOM_STATE` | `room: RoomView` | Broadcast on every lobby change. |
| `PLAYER_JOINED` | `player: RoomPlayerView` | — |
| `PLAYER_LEFT` | `playerId` | — |
| `GAME_STARTED` | `gameId`, `playerId` | Your seat id for this game. |
| `GAME_EVENT` | `seq: number`, `event: GameEvent` | Masked per viewer. `seq` is gapless from 0. |
| `GAME_STATE` | `state: PublicGameState`, `lastSeq: number` | Authoritative masked snapshot. Render this. |
| `COMMAND_ACCEPTED` | `commandId`, `seqs: number[]` | Your command executed; `seqs` are its events. |
| `CHAT_MESSAGE` | `from`, `fromName`, `text`, `ts` | — |
| `ERROR` | `code: ErrorCode`, `message`, `commandId?` | — |
| `PONG` | `ts: number` | Echo of `PING`. |
| `RECONNECT_SUCCESS` | `playerId`, `room: RoomView`, `missedEvents: GameEvent[]` | `missedEvents` are masked, seq > `lastSeq`. A `GAME_STATE` follows. |
| `GAME_ENDED` | `winnerId: string \| null`, `reason` | Room moves to `FINISHED`. |

`RoomView` carries only public lobby info: code, status, roomSize, players
(id, name, color, ready, isBot, connected, isHost, AI config), hostPlayerId,
gameId, createdAt. It never carries secrets.

## Error codes

`INVALID_MESSAGE` · `INVALID_PROTOCOL_VERSION` · `MESSAGE_TOO_LARGE` ·
`INVALID_COMMAND` · `NOT_AUTHORIZED` · `NOT_HOST` · `NOT_YOUR_TURN` ·
`NOT_IN_ROOM` · `ALREADY_IN_ROOM` · `GAME_NOT_FOUND` · `ROOM_NOT_FOUND` ·
`ROOM_CLOSED` · `ROOM_FULL` · `SEATS_FULL` · `GAME_ALREADY_STARTED` ·
`GAME_NOT_STARTED` · `PLAYER_NOT_FOUND` · `INVALID_GAME_STATE` ·
`RECONNECT_FAILED` · `RATE_LIMITED` · `NAME_TAKEN` · `DUPLICATE_COMMAND` ·
`INTERNAL_ERROR`

## Typical flows

**Create & start**
```
C: CREATE_ROOM { name }            S: ROOM_CREATED { room, sessionId, playerId }
C: ADD_AI { difficulty }           S: ROOM_STATE (× all)
C: JOIN_ROOM { code, name }        S: ROOM_CREATED / PLAYER_JOINED / ROOM_STATE
C: SET_READY { true } (× humans)   S: ROOM_STATE
C: START_GAME (host)               S: GAME_STARTED, GAME_EVENT(0…), GAME_STATE (× each)
```

**Command**
```
C: GAME_COMMAND { commandId, command }
S: COMMAND_ACCEPTED { commandId, seqs }          (to sender)
S: GAME_EVENT { seq, event } …                   (to each human, masked)
S: GAME_STATE { state, lastSeq }                 (to each human, masked)
```

**Reconnect**
```
C: RECONNECT { sessionId, lastSeq }
S: RECONNECT_SUCCESS { playerId, room, missedEvents }
S: GAME_STATE { state, lastSeq }
```

## Versioning

`v` is checked on every message. Future protocol versions will negotiate or
reject cleanly via `INVALID_PROTOCOL_VERSION`; v1 clients and servers only
speak v1.
