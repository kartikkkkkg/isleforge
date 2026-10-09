/**
 * Auth UI tests: avatars, error messages, menu auth states.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, AVATAR_IDS, avatarLabel } from '../src/components/Avatar';
import { friendlyAuthError } from '../src/game/useAuth';

vi.mock('../src/game/useAuth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/game/useAuth')>();
  return { ...mod, useAuth: vi.fn() };
});

import { useAuth } from '../src/game/useAuth';
import { MainMenu } from '../src/screens/MainMenu';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function authState(overrides: Record<string, unknown> = {}) {
  return {
    user: null,
    status: 'guest',
    accessToken: null,
    serverUrl: 'ws://localhost:8080',
    authEnabled: true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
    logoutAll: vi.fn(),
    refreshNow: vi.fn(),
    authFetch: vi.fn(),
    ...overrides,
  };
}

describe('auth UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all built-in avatars', () => {
    expect(AVATAR_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of AVATAR_IDS) {
      const { unmount } = render(<Avatar id={id} size={40} />);
      expect(avatarLabel(id)).toBeTruthy();
      unmount();
    }
  });

  it('falls back for unknown avatar ids', () => {
    const { container } = render(<Avatar id="not-real" size={40} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('maps error codes to friendly messages', () => {
    expect(friendlyAuthError('INVALID_CREDENTIALS')).toContain('Wrong');
    expect(friendlyAuthError('EMAIL_ALREADY_EXISTS')).toContain('already exists');
    expect(friendlyAuthError('WEAK_PASSWORD')).toContain('Password');
    expect(friendlyAuthError('RATE_LIMITED')).toContain('Slow down');
    expect(friendlyAuthError('NOPE', 'fallback here')).toBe('fallback here');
  });

  it('shows guest menu when signed out', () => {
    mockUseAuth.mockReturnValue(authState());
    render(
      <MainMenu
        onStart={vi.fn()}
        onPlayOnline={vi.fn()}
        onPlayMatchmaking={vi.fn()}
        onLeaderboard={vi.fn()}
        onFriends={vi.fn()}
        onSignIn={vi.fn()}
        onRegister={vi.fn()}
        onProfile={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.getByText('Play Local')).not.toBeNull();
    expect(screen.getByText('Play Online as Guest')).not.toBeNull();
    expect(screen.getByText('Sign In')).not.toBeNull();
    expect(screen.getByText('Create Account')).not.toBeNull();
  });

  it('shows account menu when signed in', () => {
    mockUseAuth.mockReturnValue(
      authState({
        status: 'user',
        user: {
          id: 'usr_abc',
          username: 'captain',
          displayName: 'Captain',
          avatarId: 'compass',
          emailVerified: false,
          createdAt: new Date().toISOString(),
        },
      }),
    );
    render(
      <MainMenu
        onStart={vi.fn()}
        onPlayOnline={vi.fn()}
        onPlayMatchmaking={vi.fn()}
        onLeaderboard={vi.fn()}
        onFriends={vi.fn()}
        onSignIn={vi.fn()}
        onRegister={vi.fn()}
        onProfile={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.getByText('Play Online')).not.toBeNull();
    expect(screen.getByText('Profile')).not.toBeNull();
    expect(screen.getByText('Settings')).not.toBeNull();
    expect(screen.getByText('Log Out')).not.toBeNull();
    // Guest-only options hidden.
    expect(screen.queryByText('Sign In')).toBeNull();
    expect(screen.queryByText('Create Account')).toBeNull();
  });

  it('hides auth buttons when the server has auth disabled', () => {
    mockUseAuth.mockReturnValue(authState({ authEnabled: false }));
    render(
      <MainMenu
        onStart={vi.fn()}
        onPlayOnline={vi.fn()}
        onPlayMatchmaking={vi.fn()}
        onLeaderboard={vi.fn()}
        onFriends={vi.fn()}
        onSignIn={vi.fn()}
        onRegister={vi.fn()}
        onProfile={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.queryByText('Sign In')).toBeNull();
    expect(screen.getByText('Play Online as Guest')).not.toBeNull();
  });
});
