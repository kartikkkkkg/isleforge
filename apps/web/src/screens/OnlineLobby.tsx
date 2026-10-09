/* OnlineLobby — create/join rooms and ready up for multiplayer games. */

import { useState } from 'react';
import type { Difficulty } from '@isleforge/protocol';
import type { UseMultiplayer } from '../game/useMultiplayerGame';
import { InviteFriends } from '../components/InviteFriends';

const DIFFS: { v: Difficulty; label: string }[] = [
  { v: 'easy', label: 'Easy' },
  { v: 'normal', label: 'Normal' },
  { v: 'hard', label: 'Hard' },
  { v: 'expert', label: 'Expert' },
];

function ConnBadge({ connection }: { connection: UseMultiplayer['connection'] }) {
  return (
    <span className={`if-conn if-conn--${connection}`} role="status">
      <span className="if-conn__dot" aria-hidden="true" />
      {connection === 'connected'
        ? 'Connected'
        : connection === 'reconnecting'
          ? 'Reconnecting…'
          : 'Disconnected'}
    </span>
  );
}

export function OnlineLobby({
  mp,
  serverUrl,
  onQuit,
}: {
  mp: UseMultiplayer;
  serverUrl: string;
  onQuit: () => void;
}) {
  const [name, setName] = useState('Skipper');
  const [code, setCode] = useState('');
  const [roomSize, setRoomSize] = useState<3 | 4>(4);
  const [aiDiff, setAiDiff] = useState<Difficulty>('normal');
  const { room, connection, error, clearError, playerId } = mp;

  const me = room?.players.find((p) => p.playerId === playerId) ?? null;
  const isHost = !!me && room?.hostPlayerId === me.playerId;
  const humans = room?.players.filter((p) => !p.isBot) ?? [];
  const readyCount = humans.filter((p) => p.ready).length;

  if (!room) {
    return (
      <div className="if-menu">
        <div className="if-menu__hero">
          <h1 className="if-menu__title">ISLEFORGE</h1>
          <p className="if-menu__tag">Online multiplayer.</p>
          <p className="if-menu__sub">
            Create a room and share the code, or join a friend's room. The
            server runs the game — no funny business.
          </p>
        </div>
        <div className="if-panel if-menu__card">
          <div className="if-lobby__connrow">
            <ConnBadge connection={connection} />
            <span className="if-lobby__server" title={serverUrl}>
              {serverUrl.replace(/^wss?:\/\//, '')}
            </span>
          </div>
          {error && (
            <div className="if-toast if-toast--error" role="alert">
              {error}
              <button className="if-btn if-btn--sm if-btn--ghost" onClick={clearError}>
                Dismiss
              </button>
            </div>
          )}
          <label className="if-field">
            <span className="if-field__label">Your captain name</span>
            <input
              className="if-input"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              placeholder="Skipper"
              aria-label="Your captain name"
            />
          </label>

          <div className="if-lobby__split">
            <div className="if-lobby__col">
              <h3 className="if-lobby__h">Create room</h3>
              <div className="if-field">
                <span className="if-field__label">Table size</span>
                <div className="if-seg" role="group" aria-label="Table size">
                  {([3, 4] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`if-seg__btn${roomSize === n ? ' if-seg__btn--on' : ''}`}
                      aria-pressed={roomSize === n}
                      onClick={() => setRoomSize(n)}
                    >
                      {n} seats
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="if-btn if-btn--primary"
                disabled={connection !== 'connected' || !name.trim()}
                onClick={() => mp.createRoom(name.trim(), roomSize)}
              >
                Create Room
              </button>
            </div>
            <div className="if-lobby__col">
              <h3 className="if-lobby__h">Join room</h3>
              <label className="if-field">
                <span className="if-field__label">Room code</span>
                <input
                  className="if-input if-lobby__code"
                  value={code}
                  maxLength={8}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="A7K9P"
                  aria-label="Room code"
                />
              </label>
              <button
                className="if-btn if-btn--primary"
                disabled={connection !== 'connected' || !name.trim() || code.trim().length < 4}
                onClick={() => mp.joinRoom(code.trim(), name.trim())}
              >
                Join Game
              </button>
            </div>
          </div>

          <div className="if-menu__btns">
            <button className="if-btn if-btn--ghost" onClick={onQuit}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const seatsFilled = room.players.length === room.roomSize;
  const canStart =
    isHost && humans.length >= 2 && seatsFilled && humans.every((p) => p.ready);

  return (
    <div className="if-menu">
      <div className="if-menu__hero">
        <h1 className="if-menu__title">ISLEFORGE</h1>
        <p className="if-menu__tag">Room {room.code}</p>
        <p className="if-menu__sub">Share the code — friends join from the menu.</p>
        <InviteFriends roomCode={room.code} />
      </div>
      <div className="if-panel if-menu__card">
        <div className="if-lobby__connrow">
          <ConnBadge connection={connection} />
          {me && <span className="if-lobby__me">You: {me.name}</span>}
        </div>
        {error && (
          <div className="if-toast if-toast--error" role="alert">
            {error}
            <button className="if-btn if-btn--sm if-btn--ghost" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}

        <ul className="if-lobby__players" aria-label="Players in room">
          {room.players.map((p) => (
            <li key={p.playerId} className="if-lobby__player">
              <span
                className={`if-conn__dot if-conn__dot--${p.connected ? 'on' : 'off'}`}
                title={p.connected ? 'Connected' : 'Disconnected'}
                aria-hidden="true"
              />
              <span className="if-lobby__pname">
                {p.name}
                {p.isHost && <span className="if-lobby__host" title="Host"> ♛</span>}
                {p.isBot && <span className="if-lobby__bot"> · AI {p.difficulty}</span>}
              </span>
              <span className={`if-lobby__ready${p.ready ? ' if-lobby__ready--on' : ''}`}>
                {p.isBot ? 'READY' : p.ready ? 'READY' : 'NOT READY'}
              </span>
              {isHost && p.isBot && (
                <button
                  className="if-btn if-btn--sm if-btn--ghost"
                  onClick={() => mp.removeAI(p.playerId)}
                  aria-label={`Remove ${p.name}`}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: room.roomSize - room.players.length }).map((_, i) => (
            <li key={`empty-${i}`} className="if-lobby__player if-lobby__player--empty">
              <span className="if-lobby__pname">Empty seat</span>
              <span />
            </li>
          ))}
        </ul>

        <div className="if-lobby__actions">
          {!me?.isBot && (
            <button
              className="if-btn if-btn--ghost"
              onClick={() => mp.setReady(!(me?.ready ?? false))}
            >
              {me?.ready ? 'Not Ready' : 'Ready Up'}
            </button>
          )}
          {isHost && !seatsFilled && (
            <div className="if-lobby__airow">
              <select
                className="if-input if-input--sm"
                value={aiDiff}
                onChange={(e) => setAiDiff(e.target.value as Difficulty)}
                aria-label="AI difficulty"
              >
                {DIFFS.map((d) => (
                  <option key={d.v} value={d.v}>
                    AI · {d.label}
                  </option>
                ))}
              </select>
              <button className="if-btn if-btn--ghost" onClick={() => mp.addAI(aiDiff)}>
                Add AI
              </button>
            </div>
          )}
        </div>

        {!seatsFilled && (
          <p className="if-menu__note">
            {readyCount}/{humans.length} ready · fill all {room.roomSize} seats to start
            {humans.length < 2 ? ' (need at least 2 humans)' : ''}.
          </p>
        )}

        <div className="if-menu__btns">
          {isHost && (
            <button
              className="if-btn if-btn--primary if-btn--lg"
              disabled={!canStart}
              onClick={mp.startGame}
              title={
                canStart
                  ? 'Start the game'
                  : 'Need 2+ humans, everyone ready, and all seats filled'
              }
            >
              Start Game
            </button>
          )}
          <button className="if-btn if-btn--ghost" onClick={mp.leaveRoom}>
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}
