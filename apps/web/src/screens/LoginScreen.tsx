/* LoginScreen — sign in with email/username + password. */

import { useState } from 'react';
import { friendlyAuthError, useAuth } from '../game/useAuth';

export function LoginScreen({
  onDone,
  onSwitchToRegister,
  onBack,
}: {
  onDone: () => void;
  onSwitchToRegister: () => void;
  onBack: () => void;
}) {
  const { login } = useAuth();
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(loginInput.trim(), password);
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
        <p className="if-menu__tag">Welcome back, captain.</p>
      </div>
      <form className="if-panel if-menu__card if-auth__card" onSubmit={submit}>
        {error && (
          <div className="if-toast if-toast--error" role="alert">
            {error}
          </div>
        )}
        <label className="if-field">
          <span className="if-field__label">Email or username</span>
          <input
            className="if-input"
            value={loginInput}
            onChange={(e) => setLoginInput(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            aria-label="Email or username"
          />
        </label>
        <label className="if-field">
          <span className="if-field__label">Password</span>
          <input
            className="if-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            aria-label="Password"
          />
        </label>
        <div className="if-menu__btns">
          <button className="if-btn if-btn--primary if-btn--lg" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
          <button
            className="if-btn if-btn--ghost"
            type="button"
            onClick={onSwitchToRegister}
          >
            New here? Create account
          </button>
          <button className="if-btn if-btn--ghost" type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
