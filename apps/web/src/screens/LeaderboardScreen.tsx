/**
 * M8: Global ranked leaderboard with cursor pagination and personal position.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../game/useAuth';
import { Avatar } from '../components/Avatar';

interface LeaderboardEntry {
  userId: string;
  username: string;
  displayName: string;
  avatarId: string;
  rating: number;
  gamesRated: number;
  wins: number;
  rankName: string;
  tier: string;
}

export function LeaderboardScreen({ onBack }: { onBack: () => void }) {
  const { user, authFetch } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [personal, setPersonal] = useState<{ position: number; rating: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (cursor: string | null) => {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) params.set('before', cursor);
      const res = await authFetch(`/leaderboard?${params}`);
      if (!res.ok) throw new Error('Failed to load leaderboard');
      const data = (await res.json()) as {
        leaderboard: LeaderboardEntry[];
        nextCursor: string | null;
        personalPosition: { position: number; rating: number } | null;
      };
      setEntries((prev) => (cursor ? [...prev, ...data.leaderboard] : data.leaderboard));
      setNextCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
      setPersonal(data.personalPosition);
    },
    [authFetch],
  );

  useEffect(() => {
    setLoading(true);
    load(null)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [load]);

  if (!user) return <div className="screen"><p>Sign in to view the leaderboard.</p></div>;

  return (
    <div className="screen leaderboard-screen">
      <button className="secondary back-btn" onClick={onBack}>← Menu</button>
      <h1>Leaderboard</h1>

      {personal && (
        <div className="personal-position">
          <span>Your position</span>
          <strong>#{personal.position}</strong>
          <span className="muted">{personal.rating.toLocaleString()} MMR</span>
        </div>
      )}

      {loading && <p className="muted">Loading…</p>}

      <ol className="leaderboard-list">
        {entries.map((e, i) => (
          <li key={e.userId} className={e.userId === user.id ? 'me' : ''}>
            <span className="lb-pos">#{i + 1}</span>
            <Avatar id={e.avatarId} size={32} />
            <span className="lb-name">{e.displayName}</span>
            <span className="lb-tier">{e.rankName}</span>
            <span className="lb-rating">{e.rating.toLocaleString()}</span>
          </li>
        ))}
      </ol>

      {hasMore && (
        <button className="secondary" onClick={() => load(nextCursor)}>
          Load more
        </button>
      )}
    </div>
  );
}
