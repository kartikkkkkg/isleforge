/* RegisterScreen — create a persistent IsleForge account. */

import { useState } from 'react';
import { friendlyAuthError, useAuth } from '../game/useAuth';
import { Avatar, AVATAR_IDS } from '../components/Avatar';

export function RegisterScreen({
  onDone,
  onSwitchToLogin,
  onBack,
}: {
  onDone: () => void;
  onSwitchToLogin: () => void;
  onBack: () => void;
}) {
  const { register, login } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [avatarId, setAvatarId] = useState<string>('compass');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({
        email: email.trim(),
        username: username.trim(),
        password,
        avatarId,
      });
      // Registration doesn't log in; sign in immediately for a smooth flow.
      await login(username.trim(), password);
      onDone();
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(friendlyAuthError(code, (err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="if-menu">
      <div className="if-menu__hero">
        <h1 className="if-menu__title">ISLEFORGE</h1>
        <p className="if-menu__tag">Claim your captain's name.</p>
        <p className="if-menu__sub">
          One account, every device. Your name is yours — pick wisely.
        </p>
      </div>
      <form className="if-panel if-menu__card if-auth__card" onSubmit={submit}>
        {error && (
          <div className="if-toast if-toast--error" role="alert">
            {error}
          </div>
        )}
        <label className="if-field">
          <span className="if-field__label">Email</span>
          <input
            className="if-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            aria-label="Email"
          />
        </label>
        <label className="if-field">
          <span className="if-field__label">Username (3–20: letters, numbers, _)</span>
          <input
            className="if-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            required
            aria-label="Username"
          />
        </label>
        <label className="if-field">
          <span className="if-field__label">Password (10+ chars, 3 of: aA1!)</span>
          <input
            className="if-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            aria-label="Password"
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
          <button className="if-btn if-btn--primary if-btn--lg" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create Account'}
          </button>
          <button className="if-btn if-btn--ghost" type="button" onClick={onSwitchToLogin}>
            Have an account? Sign in
          </button>
          <button className="if-btn if-btn--ghost" type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
