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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/me/stats');
        if (!res.ok) return;
        const data = (await res.json()) as { stats: PlayerStats };
        if (!cancelled) setStats(data.stats);
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
