/* useAuth — authentication state for the web client.
   Access token lives in memory only (never localStorage). The refresh token
   lives in an HttpOnly cookie managed by the server. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarId: string;
  emailVerified: boolean;
  createdAt: string;
}

interface AuthState {
  user: AuthUser | null;
  /** Null = unknown (checking), 'guest' = anonymous, 'user' = signed in. */
  status: 'loading' | 'guest' | 'user';
  accessToken: string | null;
  serverUrl: string;
  authEnabled: boolean;
  login: (login: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
    avatarId?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: { displayName?: string; avatarId?: string }) => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshNow: () => Promise<boolean>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthState | null>(null);

function apiBase(serverUrl: string): string {
  return serverUrl.replace(/^ws/, 'http');
}

async function readError(res: Response): Promise<Error> {
  let code = 'UNKNOWN';
  let message = 'Something went wrong.';
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    if (body.error) code = body.error;
    if (body.message) message = body.message;
  } catch {
    /* ignore */
  }
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = code;
  err.status = res.status;
  return err;
}

export function AuthProvider({
  serverUrl,
  children,
}: {
  serverUrl: string;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'guest' | 'user'>('loading');
  const [authEnabled, setAuthEnabled] = useState(true);

  const base = useMemo(() => apiBase(serverUrl), [serverUrl]);

  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) ?? {}),
      };
      // Read the latest token from state via a ref-free approach: the caller
      // passes it through closure; we use a mutable ref below.
      return fetch(`${base}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      });
    },
    [base],
  );

  // Token ref so callbacks always use the freshest token.
  const tokenRef = useMemo(() => ({ current: null as string | null }), []);
  tokenRef.current = accessToken;

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) ?? {}),
      };
      if (tokenRef.current) headers['Authorization'] = `Bearer ${tokenRef.current}`;
      return fetch(`${base}${path}`, { ...init, headers, credentials: 'include' });
    },
    [base, tokenRef],
  );

  const refreshNow = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const body = (await res.json()) as {
        user: AuthUser;
        accessToken: string;
      };
      setAccessToken(body.accessToken);
      setUser(body.user);
      setStatus('user');
      return true;
    } catch {
      return false;
    }
  }, [base]);

  // On mount: try to restore a session from the refresh cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Probe: is auth even enabled on this server?
      try {
        const probe = await fetch(`${base}/auth/me`, { credentials: 'include' });
        // 401 with JSON error shape => auth enabled but no session.
        // Network failure / 404 => auth not enabled.
        if (probe.status === 404) {
          if (!cancelled) {
            setAuthEnabled(false);
            setStatus('guest');
          }
          return;
        }
      } catch {
        if (!cancelled) {
          setAuthEnabled(false);
          setStatus('guest');
        }
        return;
      }
      const ok = await refreshNow();
      if (!cancelled && !ok) setStatus('guest');
    })();
    return () => {
      cancelled = true;
    };
  }, [base, refreshNow]);

  const login = useCallback(
    async (loginInput: string, password: string) => {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ login: loginInput, password }),
      });
      if (!res.ok) throw await readError(res);
      const body = (await res.json()) as { user: AuthUser; accessToken: string };
      setAccessToken(body.accessToken);
      setUser(body.user);
      setStatus('user');
    },
    [base],
  );

  const register = useCallback(
    async (input: {
      email: string;
      username: string;
      password: string;
      displayName?: string;
      avatarId?: string;
    }) => {
      const res = await fetch(`${base}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res);
      // Registration does not log in; the user signs in next.
    },
    [base],
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    setUser(null);
    setStatus('guest');
  }, [base]);

  const updateProfile = useCallback(
    async (patch: { displayName?: string; avatarId?: string }) => {
      const res = await authedFetch('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw await readError(res);
      const body = (await res.json()) as { user: AuthUser };
      setUser(body.user);
    },
    [authedFetch],
  );

  const logoutAll = useCallback(async () => {
    const res = await authedFetch('/auth/logout-all', { method: 'POST' });
    if (!res.ok) throw await readError(res);
    setAccessToken(null);
    setUser(null);
    setStatus('guest');
  }, [authedFetch]);

  const value: AuthState = {
    user,
    status,
    accessToken,
    serverUrl,
    authEnabled,
    login,
    register,
    logout,
    updateProfile,
    logoutAll,
    refreshNow,
    authFetch: authedFetch,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Friendly messages for auth error codes. */
export function friendlyAuthError(code?: string, fallback?: string): string {
  switch (code) {
    case 'INVALID_EMAIL':
      return 'That email address doesn\u2019t look right.';
    case 'INVALID_USERNAME':
      return 'Usernames are 3\u201320 characters: letters, numbers, underscores.';
    case 'USERNAME_RESERVED':
      return 'That username is reserved. Pick another.';
    case 'WEAK_PASSWORD':
      return fallback ?? 'Password needs 10+ characters with 3 of: lowercase, UPPERCASE, digit, symbol.';
    case 'EMAIL_ALREADY_EXISTS':
      return 'An account with that email already exists. Try signing in.';
    case 'USERNAME_ALREADY_EXISTS':
      return 'That username is taken. Try another.';
    case 'INVALID_CREDENTIALS':
      return 'Wrong email/username or password.';
    case 'ACCOUNT_LOCKED':
      return 'Too many attempts \u2014 try again in a bit.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Slow down and try again.';
    case 'INVALID_DISPLAY_NAME':
      return 'Display name must be 1\u201332 characters.';
    case 'INVALID_AVATAR':
      return 'Pick one of the avatars shown.';
    default:
      return fallback ?? 'Something went wrong. Try again.';
  }
}
