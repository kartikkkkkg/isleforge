/**
 * M8: Replay viewer. Reconstructs game state from persisted events.
 * Read-only: never sends commands to the server.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { replayEvents } from '@isleforge/game-engine';
import type { GameEvent, GameState } from '@isleforge/game-engine';
import { GameBoard } from '../components/Board';
import { useAuth } from '../game/useAuth';

type Speed = 0.5 | 1 | 2 | 4;

export function ReplayScreen({ gameId, onBack }: { gameId: string; onBack: () => void }) {
  const { authFetch } = useAuth();
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0); // current event index (0 = after event 0)
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/games/${encodeURIComponent(gameId)}/events`);
        if (!res.ok) throw new Error(res.status === 404 ? 'Replay not found.' : 'Failed to load replay.');
        const data = (await res.json()) as { events: GameEvent[] };
        if (!cancelled) {
          setEvents(data.events);
          setIndex(data.events.length > 0 ? 0 : -1);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load replay.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, authFetch]);

  // Reconstruct state up to current index. For typical game sizes (<1000 events)
  // full replay is fast; checkpoints can be added if needed.
  const state: GameState | null = useMemo(() => {
    if (events.length === 0 || index < 0) return null;
    try {
      return replayEvents(events.slice(0, index + 1));
    } catch {
      return null;
    }
  }, [events, index]);

  // Playback.
  useEffect(() => {
    if (!playing || events.length === 0) return;
    const interval = 1000 / speed / 2; // 2 events per second at 1x
    timerRef.current = window.setInterval(() => {
      setIndex((i) => {
        if (i >= events.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, interval);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, speed, events.length]);

  const seek = (i: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(events.length - 1, i)));
  };

  if (loading) return <div className="screen"><p className="muted">Loading replay…</p></div>;
  if (error || !state) {
    return (
      <div className="screen">
        <p className="error">{error || 'Replay unavailable.'}</p>
        <button className="secondary" onClick={onBack}>Back</button>
      </div>
    );
  }

  const currentEvent = events[index];
  const progress = events.length > 1 ? (index / (events.length - 1)) * 100 : 0;

  return (
    <div className="screen replay-screen">
      <div className="replay-header">
        <button className="secondary" onClick={onBack}>← Back</button>
        <h1>Replay</h1>
        <span className="replay-badge">READ-ONLY</span>
      </div>

      <div className="replay-board">
        <GameBoard
          state={state}
          mode={{ kind: 'idle' }}
          onPlace={() => {}}
          onMoveRaider={() => {}}
          freshIds={new Set()}
          colorOf={(pid) => state.players.find((p) => p.id === pid)?.color ?? '#888'}
        />
      </div>

      <div className="replay-info">
        <span>Event {index + 1} / {events.length}</span>
        {currentEvent && <span className="replay-event-type">{currentEvent.type}</span>}
        <span>Turn: {state.currentPlayerId ?? '—'}</span>
      </div>

      <input
        type="range"
        min={0}
        max={events.length - 1}
        value={index}
        onChange={(e) => seek(parseInt(e.target.value, 10))}
        className="replay-timeline"
        aria-label="Replay timeline"
      />

      <div className="replay-controls">
        <button onClick={() => seek(0)} title="Restart">⏮</button>
        <button onClick={() => seek(index - 1)} title="Previous">◀</button>
        <button onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'} className="primary">
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => seek(index + 1)} title="Next">▶</button>
        <button onClick={() => seek(events.length - 1)} title="End">⏭</button>
      </div>

      <div className="replay-speed">
        {([0.5, 1, 2, 4] as Speed[]).map((s) => (
          <button
            key={s}
            className={speed === s ? 'active' : ''}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
