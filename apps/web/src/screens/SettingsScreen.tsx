/* SettingsScreen — display name, avatar, sessions, log out everywhere. */

import { useEffect, useState } from 'react';
import { friendlyAuthError, useAuth } from '../game/useAuth';
import { Avatar, AVATAR_IDS } from '../components/Avatar';

interface SessionInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceLabel: string | null;
  current: string | null;
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { user, updateProfile, logoutAll, authFetch } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatarId, setAvatarId] = useState(user?.avatarId ?? 'compass');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/auth/sessions');
        if (!res.ok) return;
        const body = (await res.json()) as { sessions: SessionInfo[] };
        if (!cancelled) setSessions(body.sessions);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  if (!user) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await updateProfile({ displayName: displayName.trim(), avatarId });
      setNotice('Profile updated.');
    } catch (err) {
      setError(friendlyAuthError((err as { code?: string }).code, (err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogoutAll() {
    setError(null);
    setNotice(null);
    try {
      await logoutAll();
      onBack();
    } catch (err) {
      setError(friendlyAuthError((err as { code?: string }).code, (err as Error).message));
    }
  }

  return (
    <div className="if-menu">
      <div className="if-menu__hero">
        <h1 className="if-menu__title">ISLEFORGE</h1>
        <p className="if-menu__tag">Account settings.</p>
      </div>
      <div className="if-panel if-menu__card">
        {error && (
          <div className="if-toast if-toast--error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="if-toast" role="status">
            {notice}
          </div>
        )}
        <form onSubmit={save}>
          <label className="if-field">
            <span className="if-field__label">Display name</span>
            <input
              className="if-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
              autoComplete="nickname"
              aria-label="Display name"
            />
          </label>
          <div className="if-field">
            <span className="if-field__label">Avatar</span>
            <div className="if-avatar-grid" role="radiogroup" aria-label="Avatar">
              {AVATAR_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={avatarId === id}
                  className={`if-avatar-pick${avatarId === id ? ' if-avatar-pick--on' : ''}`}
                  onClick={() => setAvatarId(id)}
                  title={id}
                >
                  <Avatar id={id} size={44} />
                </button>
              ))}
            </div>
          </div>
          <div className="if-menu__btns">
            <button className="if-btn if-btn--primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>

        <h3 className="if-lobby__h" style={{ marginTop: 20 }}>
          Sessions
        </h3>
        {sessions.length === 0 ? (
          <p className="if-menu__note">No other sessions.</p>
        ) : (
          <ul className="if-lobby__players">
            {sessions.map((s) => (
              <li key={s.id} className="if-lobby__player">
                <span className="if-lobby__pname">
                  {s.deviceLabel ?? 'Unknown device'}
                  {s.current && <span className="if-lobby__bot"> · this device</span>}
                </span>
                <span className="if-lobby__ready">
                  {s.lastUsedAt
                    ? new Date(s.lastUsedAt).toLocaleDateString()
                    : 'never used'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="if-menu__btns">
          <button className="if-btn if-btn--danger" onClick={handleLogoutAll}>
            Log Out All Devices
          </button>
          <button className="if-btn if-btn--ghost" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
