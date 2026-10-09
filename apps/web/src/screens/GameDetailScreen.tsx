/**
 * Game Detail screen (M6): standings, metadata, participants.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../game/useAuth';
import { Avatar } from '../components/Avatar';
import { formatDate, formatDuration, type GameDetail } from '../game/history';

export function GameDetailScreen({ gameId, onBack }: { gameId: string; onBack: () => void }) {
  const { authFetch } = useAuth();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/games/${encodeURIComponent(gameId)}`);
        if (!res.ok) throw new Error(res.status === 404 ? 'Game not found.' : 'Failed to load game.');
        const data = (await res.json()) as GameDetail;
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load game.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, authFetch]);

  if (loading) return <div className="screen"><p className="muted">Loading…</p></div>;
  if (error || !detail)
    return (
      <div className="screen">
        <p className="error">{error || 'Game not found.'}</p>
        <button className="secondary" onClick={onBack}>Back</button>
      </div>
    );

  const { game, players } = detail;
  const ordered = [...players].sort((a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99));

  return (
    <div className="screen game-detail-screen">
      <button className="secondary back-btn" onClick={onBack}>← History</button>
      <h1>Game Details</h1>
      <dl className="detail-grid">
        <div><dt>Date</dt><dd>{formatDate(game.finishedAt)}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(game.durationSeconds)}</dd></div>
        <div><dt>Mode</dt><dd>{game.gameMode.charAt(0) + game.gameMode.slice(1).toLowerCase()}</dd></div>
        <div><dt>Players</dt><dd>{game.playerCount}</dd></div>
      </dl>
      <h2>Final Standings</h2>
      <ol className="standings-list">
        {ordered.map((p) => (
          <li key={p.seat} className={p.won ? 'winner' : ''}>
            <span className="standing-pos">#{p.finishPosition ?? '—'}</span>
            <Avatar id={p.isAi ? 'helm' : 'compass'} size={28} />
            <span className="standing-name">{p.displayName}</span>
            {p.isAi && <span className="ai-badge">AI{p.aiDifficulty ? ` · ${p.aiDifficulty}` : ''}</span>}
            <span className="standing-vp">{p.victoryPoints ?? '—'} VP</span>
            {p.won && <span className="winner-badge">Winner</span>}
          </li>
        ))}
      </ol>
      <button className="secondary" disabled title="Replay viewing ships in M8">
        Watch Replay (coming in M8)
      </button>
      <p className="muted tiny">Game ID: {game.id}</p>
    </div>
  );
}
