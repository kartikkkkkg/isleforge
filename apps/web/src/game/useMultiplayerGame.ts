/* Multiplayer adapter: the bridge between React and the authoritative
   Isleforge server. Mirrors the GameApi surface from useGame.ts so the same
   GameScreen components work for local and online games.

   The client NEVER mutates game state: it sends GAME_COMMANDs and renders
   server snapshots (GAME_STATE) + events (GAME_EVENT). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Command,
  type GameEvent,
  type GameState,
  type PublicGameState,
} from '@isleforge/game-engine';
import {
  type ChatMessage,
  type ClientMessage,
  type Difficulty,
  type ErrorCode,
  type Personality,
  type RoomView,
  type ServerMessage,
} from '@isleforge/protocol';

import type { Seat } from './useGame';

export type ConnectionHealth = 'connected' | 'reconnecting' | 'disconnected';
export type OnlinePhase = 'lobby' | 'game';

const SESSION_KEY = 'isleforge:mp-session';

interface StoredSession {
  sessionId: string;
  url: string;
}

const loadSession = (): StoredSession | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
};

/** Server error codes -> human-friendly UI text. */
const FRIENDLY_SERVER_ERRORS: Record<ErrorCode, string> = {
  INVALID_MESSAGE: 'Invalid message.',
  INVALID_PROTOCOL_VERSION: 'Server version mismatch. Refresh the page.',
  MESSAGE_TOO_LARGE: 'Message too large.',
  INVALID_COMMAND: "That move isn't legal right now.",
  NOT_AUTHORIZED: 'Not authorized.',
  NOT_HOST: 'Only the host can do that.',
  NOT_YOUR_TURN: 'Wait for your turn.',
  NOT_IN_ROOM: 'You are not in this room.',
  ALREADY_IN_ROOM: 'Leave your current room first.',
  GAME_NOT_FOUND: 'Game not found.',
  ROOM_NOT_FOUND: 'Room not found. Check the code.',
  ROOM_CLOSED: 'That room is closed.',
  ROOM_FULL: 'Room is full.',
  SEATS_FULL: 'Room is full.',
  GAME_ALREADY_STARTED: 'The game already started.',
  GAME_NOT_STARTED: 'The game has not started yet.',
  PLAYER_NOT_FOUND: 'Player not found.',
  INVALID_GAME_STATE: 'Not possible right now.',
  RECONNECT_FAILED: 'Could not reconnect. The room may have closed.',
  RATE_LIMITED: 'Too fast — slow down a little.',
  NAME_TAKEN: 'That name is taken in this room.',
  DUPLICATE_COMMAND: 'Command already sent.',
  INTERNAL_ERROR: 'Something went wrong.',
};

export function serverFriendlyError(code: ErrorCode, fallback: string): string {
  return FRIENDLY_SERVER_ERRORS[code] ?? fallback;
}

export interface MultiplayerApi {
  /** GameScreen-compatible surface. */
  state: GameState;
  seats: Seat[];
  dispatch: (cmd: Command) => null;
  error: string | null;
  clearError: () => void;
  isBot: (playerId: string) => boolean;
  humanId: string | null;
  remote: true;
  /** Recent server events (drives piece-placement animations). */
  recentEvents: GameEvent[];
  remoteInfo: {
    connection: ConnectionHealth;
    roomCode: string | null;
  };
  chat: {
    messages: ChatMessage[];
    sendChat: (text: string) => void;
  };
  /** Online extras. */
  online: {
    connection: ConnectionHealth;
    room: RoomView | null;
    playerId: string | null;
    chat: ChatMessage[];
    sendChat: (text: string) => void;
    ended: { winnerId: string | null } | null;
  };
}

export interface UseMultiplayer {
  phase: OnlinePhase;
  connection: ConnectionHealth;
  room: RoomView | null;
  /** Our own seat id (set after ROOM_CREATED / RECONNECT_SUCCESS). */
  playerId: string | null;
  api: MultiplayerApi | null;
  createRoom: (name: string, roomSize: 3 | 4) => void;
  joinRoom: (code: string, name: string) => void;
  leaveRoom: () => void;
  setReady: (ready: boolean) => void;
  addAI: (difficulty?: Difficulty, personality?: Personality) => void;
  removeAI: (playerId: string) => void;
  startGame: () => void;
  error: string | null;
  clearError: () => void;
}

export function useMultiplayer(
  url: string,
  opts: { getAccessToken?: () => string | null; initialSessionId?: string | null } = {},
): UseMultiplayer {
  const [connection, setConnection] = useState<ConnectionHealth>('disconnected');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pubState, setPubState] = useState<PublicGameState | null>(null);
  const [recentEvents, setRecentEvents] = useState<GameEvent[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [ended, setEnded] = useState<{ winnerId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  sessionRef.current = sessionId;

  const clearError = useCallback(() => setError(null), []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  /* ── connection lifecycle with auto-reconnect ── */
  useEffect(() => {
    let closed = false;
    let retryMs = 500;
    let ws: WebSocket | null = null;

    const handleMessage = (m: ServerMessage): void => {
      switch (m.type) {
        case 'ROOM_CREATED':
          setRoom(m.room);
          setPlayerId(m.playerId);
          setSessionId(m.sessionId);
          try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: m.sessionId, url }));
          } catch {
            /* private mode */
          }
          break;
        case 'ROOM_STATE':
          setRoom(m.room);
          break;
        case 'GAME_STARTED':
          setPlayerId(m.playerId);
          setEnded(null);
          break;
        case 'GAME_STATE':
          setPubState(m.state);
          break;
        case 'GAME_EVENT':
          setRecentEvents((evs) => [...evs.slice(-29), m.event]);
          break;
        case 'CHAT_MESSAGE':
          setChat((c) => [...c.slice(-99), { from: m.from, fromName: m.fromName, text: m.text, ts: m.ts }]);
          break;
        case 'ERROR':
          setError(serverFriendlyError(m.code, m.message));
          break;
        case 'RECONNECT_SUCCESS':
          setRoom(m.room);
          setPlayerId(m.playerId);
          setPubState(null);
          setEnded(null);
          for (const e of m.missedEvents) {
            setRecentEvents((evs) => [...evs.slice(-29), e]);
          }
          break;
        case 'GAME_ENDED':
          setEnded({ winnerId: m.winnerId });
          break;
        case 'PONG':
        case 'PLAYER_JOINED':
        case 'PLAYER_LEFT':
        case 'COMMAND_ACCEPTED':
        case 'AUTHENTICATED':
          break;
      }
    };

    const open = (): void => {
      if (closed) return;
      const sock = new WebSocket(url);
      ws = sock;
      wsRef.current = sock;
      sock.onopen = () => {
        retryMs = 500;
        setConnection('connected');
        // M5: authenticate the socket when signed in. The server verifies
        // the token itself; guests simply skip this.
        const token = opts.getAccessToken?.();
        if (token) {
          sock.send(JSON.stringify({ v: 1, type: 'AUTHENTICATE', accessToken: token }));
        }
        // Resume a previous session if we have one for this server.
        const stored = loadSession();
        const sid =
          opts.initialSessionId ??
          sessionRef.current ??
          (stored?.url === url ? stored.sessionId : null);
        if (sid) {
          setConnection('connected');
          sock.send(JSON.stringify({ v: 1, type: 'RECONNECT', sessionId: sid }));
        }
        sock.send(JSON.stringify({ v: 1, type: 'PING', ts: Date.now() }));
      };
      sock.onmessage = (ev) => {
        try {
          handleMessage(JSON.parse(ev.data as string) as ServerMessage);
        } catch {
          /* ignore malformed server frames */
        }
      };
      sock.onclose = () => {
        if (wsRef.current === sock) wsRef.current = null;
        if (closed) return;
        setConnection(sessionRef.current ? 'reconnecting' : 'disconnected');
        retryMs = Math.min(retryMs * 2, 5000);
        reconnectTimer.current = window.setTimeout(open, retryMs);
      };
      sock.onerror = () => {
        /* onclose follows */
      };
    };

    setConnection('disconnected');
    open();
    const t = window.setTimeout(() => {
      // If the socket never opened, show reconnecting rather than hanging.
      if (wsRef.current?.readyState !== WebSocket.OPEN) setConnection('reconnecting');
    }, 2500);
    return () => {
      closed = true;
      window.clearTimeout(t);
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      ws?.close();
      wsRef.current = null;
    };
  }, [url]);

  /* ── lobby + game actions ── */
  const createRoom = useCallback(
    (name: string, roomSize: 3 | 4) => {
      setError(null);
      send({ v: 1, type: 'CREATE_ROOM', name, settings: { roomSize } });
    },
    [send],
  );
  const joinRoom = useCallback(
    (code: string, name: string) => {
      setError(null);
      send({ v: 1, type: 'JOIN_ROOM', code, name });
    },
    [send],
  );
  const leaveRoom = useCallback(() => {
    send({ v: 1, type: 'LEAVE_ROOM' });
    setRoom(null);
    setPlayerId(null);
    setSessionId(null);
    setPubState(null);
    setRecentEvents([]);
    setEnded(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, [send]);
  const setReady = useCallback((ready: boolean) => send({ v: 1, type: 'SET_READY', ready }), [send]);
  const addAI = useCallback(
    (difficulty?: Difficulty, personality?: Personality) =>
      send({ v: 1, type: 'ADD_AI', ...(difficulty ? { difficulty } : {}), ...(personality ? { personality } : {}) }),
    [send],
  );
  const removeAI = useCallback((pid: string) => send({ v: 1, type: 'REMOVE_AI', playerId: pid }), [send]);
  const startGame = useCallback(() => send({ v: 1, type: 'START_GAME' }), [send]);
  const sendChat = useCallback((text: string) => send({ v: 1, type: 'GAME_CHAT', text }), [send]);

  const seats: Seat[] = useMemo(
    () =>
      (room?.players ?? []).map((p) => ({
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        playerId: p.playerId,
        difficulty: p.difficulty,
        personality: p.personality,
      })),
    [room],
  );

  const seatById = useMemo(() => {
    const m = new Map<string, Seat>();
    for (const s of seats) {
      if (s.playerId) m.set(s.playerId, s);
    }
    return m;
  }, [seats]);

  const isBot = useCallback((pid: string) => seatById.get(pid)?.isBot ?? false, [seatById]);

  const dispatch = useCallback(
    (cmd: Command): null => {
      send({
        v: 1,
        type: 'GAME_COMMAND',
        commandId:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
        command: cmd,
      });
      return null;
    },
    [send],
  );

  const api: MultiplayerApi | null = useMemo(() => {
    if (!pubState) return null;
    const chatApi = {
      messages: chat,
      sendChat,
    };
    return {
      state: pubState as unknown as GameState,
      seats,
      dispatch,
      error,
      clearError,
      isBot,
      humanId: playerId,
      remote: true as const,
      recentEvents,
      remoteInfo: {
        connection,
        roomCode: room?.code ?? null,
      },
      chat: chatApi,
      online: {
        connection,
        room,
        playerId,
        chat,
        sendChat,
        ended,
      },
    };
  }, [pubState, seats, dispatch, error, clearError, isBot, playerId, recentEvents, connection, room, chat, sendChat, ended]);

  const phase: OnlinePhase = pubState ? 'game' : 'lobby';

  return {
    phase,
    connection,
    room,
    playerId,
    api,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    addAI,
    removeAI,
    startGame,
    error,
    clearError,
  };
}
