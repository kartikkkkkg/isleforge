/* ProfileScreen — the captain's profile, with M6 statistics. */

import { useEffect, useState } from 'react';
import { useAuth } from '../game/useAuth';
import { Avatar } from '../components/Avatar';
import { formatDuration, type PlayerStats } from '../game/history';

export function ProfileScreen({
  onBack,
  onOpenSettings,
  onOpenHistory,
}: {
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  const { user, logout, authFetch } = useAuth();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [rating, setRating] = useState<{
    rating: number;
    gamesRated: number;
    wins: number;
    rank: { tier: string; division: number | null; name: string; provisional: boolean; progress: number; nextThreshold: number | null };
  } | null>(null);
  const [ratingHistory, setRatingHistory] = useState<{
    game_id: string;
    rating_before: number;
    rating_after: number;
    rating_delta: number;
    placement: number;
    created_at: string;
  }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statsRes, ratingRes, histRes] = await Promise.all([
          authFetch('/me/stats'),
          authFetch('/me/rating'),
          authFetch('/me/rating-history?limit=10'),
        ]);
        if (!cancelled) {
          if (statsRes.ok) {
            const data = (await statsRes.json()) as { stats: PlayerStats };
            setStats(data.stats);
          }
          if (ratingRes.ok) {
            const data = await ratingRes.json();
            setRating(data);
          }
          if (histRes.ok) {
            const data = (await histRes.json()) as { history: typeof ratingHistory };
            setRatingHistory(data.history);
          }
        }
      } catch {
        /* stats stay hidden on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  if (!user) return null;

  const created = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="if-menu">
      <div className="if-menu__hero">
        <h1 className="if-menu__title">ISLEFORGE</h1>
        <p className="if-menu__tag">Captain's profile.</p>
      </div>
      <div className="if-panel if-menu__card">
        <div className="if-profile__head">
          <Avatar id={user.avatarId} size={72} label={`${user.displayName}'s avatar`} />
          <div>
            <div className="if-profile__name">{user.displayName}</div>
            <div className="if-profile__sub">@{user.username}</div>
          </div>
        </div>
        {stats && (
          <div className="if-stats">
            <div className="if-stat">
              <span className="if-stat__value">{stats.gamesPlayed}</span>
              <span className="if-stat__label">Games</span>
            </div>
            <div className="if-stat">
              <span className="if-stat__value">{stats.wins}</span>
              <span className="if-stat__label">Wins</span>
            </div>
            <div className="if-stat">
              <span className="if-stat__value">
                {stats.gamesPlayed > 0 ? `${(stats.winRate * 100).toFixed(1)}%` : '—'}
              </span>
              <span className="if-stat__label">Win Rate</span>
            </div>
            <div className="if-stat">
              <span className="if-stat__value">
                {stats.gamesPlayed > 0 ? stats.averageVp.toFixed(1) : '—'}
              </span>
              <span className="if-stat__label">Avg VP</span>
            </div>
            <div className="if-stat">
              <span className="if-stat__value">
                {stats.gamesPlayed > 0 ? stats.averageFinish.toFixed(1) : '—'}
              </span>
              <span className="if-stat__label">Avg Finish</span>
            </div>
            <div className="if-stat">
              <span className="if-stat__value">{formatDuration(stats.totalPlayTimeSeconds)}</span>
              <span className="if-stat__label">Time Played</span>
            </div>
          </div>
        )}
        {rating && (
          <>
            <div className="rank-display">
              <div className="rank-tier">{rating.rank.name}</div>
              {!rating.rank.provisional && rating.rank.nextThreshold && (
                <>
                  <div className="rank-progress">
                    <div style={{ width: `${rating.rank.progress * 100}%` }} />
                  </div>
                  <div className="muted tiny">
                    {rating.rating.toLocaleString()} / {rating.rank.nextThreshold.toLocaleString()}
                  </div>
                </>
              )}
              {rating.rank.provisional && (
                <div className="muted tiny">
                  Provisional — {rating.gamesRated} / 10 games
                </div>
              )}
            </div>
            <div className="if-mmr">
              <div className="if-stat if-stat--wide">
                <span className="if-stat__value">{rating.rating.toLocaleString()}</span>
                <span className="if-stat__label">MMR</span>
              </div>
              <div className="if-stat if-stat--wide">
                <span className="if-stat__value">{rating.gamesRated}</span>
                <span className="if-stat__label">Rated Games</span>
              </div>
            </div>
          </>
        )}
        <dl className="if-profile__facts">
          <div>
            <dt>Joined</dt>
            <dd>{created}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.emailVerified ? 'Verified' : 'Not verified'}</dd>
          </div>
        </dl>
        {ratingHistory.length > 0 && (
          <div className="rating-history">
            <h3>Rating History</h3>
            <ul>
              {ratingHistory.map((h) => (
                <li key={h.game_id}>
                  <span>{new Date(h.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  <span>#{h.placement}</span>
                  <span>
                    {h.rating_before} → {h.rating_after}
                  </span>
                  <span className={h.rating_delta >= 0 ? 'positive' : 'negative'}>
                    {h.rating_delta >= 0 ? '+' : ''}{h.rating_delta}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="if-menu__btns">
          <button className="if-btn" onClick={onOpenHistory}>
            Match History
          </button>
          <button className="if-btn if-btn--ghost" onClick={onOpenSettings}>
            Account Settings
          </button>
          <button className="if-btn if-btn--ghost" onClick={onBack}>
            Back
          </button>
          <button
            className="if-btn if-btn--danger"
            onClick={() => {
              void logout();
              onBack();
            }}
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
