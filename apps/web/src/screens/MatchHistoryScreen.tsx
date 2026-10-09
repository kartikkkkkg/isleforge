/**
 * Match History screen (M6): cursor-paginated list of completed games.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../game/useAuth';
import {
  formatDate,
  formatDuration,
  matchTypeLabel,
  type HistoryGameSummary,
} from '../game/history';

type Filter = 'all' | 'wins' | 'losses';

export function MatchHistoryScreen({ onSelectGame }: { onSelectGame: (gameId: string) => void }) {
  const { user, authFetch } = useAuth();
  const [items, setItems] = useState<HistoryGameSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!user) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (cursor) params.set('before', cursor);
        const res = await authFetch(`/games?${params}`);
        if (!res.ok) throw new Error('Failed to load history');
        const data = (await res.json()) as {
          items: HistoryGameSummary[];
          nextCursor: string | null;
          hasMore: boolean;
        };
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch {
        setError('Could not load match history.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [user, authFetch],
  );

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load(null, false);
  }, [load]);

  const visible = items.filter((g) => {
    if (filter === 'all') return true;
    const won = g.winnerUserId === user?.id;
    return filter === 'wins' ? won : !won;
  });

  if (!user) return <div className="screen"><p>Sign in to view your match history.</p></div>;

  return (
    <div className="screen history-screen">
      <h1>Match History</h1>
      <div className="history-filters" role="tablist" aria-label="Filter games">
        {(['all', 'wins', 'losses'] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={filter === f ? 'active' : ''}
            onClick={() => setFilter(f)}
          >
            {f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && visible.length === 0 && (
        <div className="empty-state">
          <p>No games yet.</p>
          <p className="muted">Play a multiplayer game and it will appear here.</p>
        </div>
      )}
      <ul className="history-list">
        {visible.map((g) => {
          const won = g.winnerUserId === user.id;
          return (
            <li key={g.id}>
              <button className="history-item" onClick={() => onSelectGame(g.id)}>
                <span className={`history-result ${won ? 'win' : 'loss'}`}>
                  {won ? 'Victory' : 'Defeat'}
                </span>
                <span className="history-meta">
                  {g.playerCount}-player · {matchTypeLabel(g.matchType)}
                </span>
                <span className="history-sub">
                  {formatDuration(g.durationSeconds)} · {formatDate(g.finishedAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <button
          className="secondary"
          disabled={loadingMore}
          onClick={() => void load(nextCursor, true)}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
