/**
 * M6 UI tests: profile statistics, history list, game detail, formatters.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { formatDate, formatDuration } from '../src/game/history';

vi.mock('../src/game/useAuth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../src/game/useAuth';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { MatchHistoryScreen } from '../src/screens/MatchHistoryScreen';
import { GameDetailScreen } from '../src/screens/GameDetailScreen';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

const user = {
  id: 'usr_1',
  username: 'captain',
  displayName: 'Captain',
  avatarId: 'compass',
  emailVerified: true,
  createdAt: new Date('2026-01-01').toISOString(),
};

function authState(overrides: Record<string, unknown> = {}) {
  return {
    user,
    status: 'user',
    logout: vi.fn(),
    authFetch: vi.fn(),
    ...overrides,
  };
}

describe('history UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats durations and dates', () => {
    expect(formatDuration(1453)).toBe('24m 13s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(null)).toBe('—');
    expect(formatDate('2026-10-09T12:00:00Z')).toContain('2026');
  });

  it('shows profile statistics', async () => {
    const authFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stats: {
          gamesPlayed: 3, wins: 2, losses: 1, winRate: 2 / 3,
          averageVp: 9, averageFinish: 1.67, bestVp: 10, totalPlayTimeSeconds: 1200,
        },
      }),
    });
    mockUseAuth.mockReturnValue(authState({ authFetch }));
    render(<ProfileScreen onBack={vi.fn()} onOpenSettings={vi.fn()} onOpenHistory={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('66.7%')).not.toBeNull());
    expect(screen.getByText('3')).not.toBeNull(); // games
    expect(screen.getByText('9.0')).not.toBeNull(); // avg VP
  });

  it('shows empty history state', async () => {
    const authFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null, hasMore: false }),
    });
    mockUseAuth.mockReturnValue(authState({ authFetch }));
    render(<MatchHistoryScreen onSelectGame={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No games yet.')).not.toBeNull());
  });

  it('lists games with win/loss states and filters', async () => {
    const authFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { id: 'g1', gameType: 'ONLINE', gameMode: 'CASUAL', playerCount: 4, durationSeconds: 1453, finishedAt: '2026-10-09T12:00:00Z', winnerUserId: 'usr_1' },
          { id: 'g2', gameType: 'ONLINE', gameMode: 'CASUAL', playerCount: 3, durationSeconds: 900, finishedAt: '2026-10-08T12:00:00Z', winnerUserId: 'usr_9' },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    });
    mockUseAuth.mockReturnValue(authState({ authFetch }));
    render(<MatchHistoryScreen onSelectGame={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Victory')).not.toBeNull());
    expect(screen.getByText('Defeat')).not.toBeNull();

    fireEvent.click(screen.getByText('Wins'));
    expect(screen.getByText('Victory')).not.toBeNull();
    expect(screen.queryByText('Defeat')).toBeNull();
  });

  it('shows game detail with standings and AI badge', async () => {
    const authFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        game: {
          id: 'g1', gameType: 'ONLINE', gameMode: 'CASUAL', playerCount: 3,
          durationSeconds: 1453, finishedAt: '2026-10-09T12:00:00Z',
          winnerUserId: 'usr_1', winnerPlayerId: 'p1',
        },
        players: [
          { seat: 0, playerId: 'p1', userId: 'usr_1', displayName: 'Captain', playerColor: 'red', isAi: false, finishPosition: 1, victoryPoints: 10, won: true },
          { seat: 1, playerId: 'p2', userId: null, displayName: 'Bot', playerColor: 'blue', isAi: true, aiDifficulty: 'hard', aiPersonality: null, finishPosition: 2, victoryPoints: 7, won: false },
        ],
      }),
    });
    mockUseAuth.mockReturnValue(authState({ authFetch }));
    render(<GameDetailScreen gameId="g1" onBack={vi.fn()} onWatchReplay={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Captain')).not.toBeNull());
    expect(screen.getByText('Bot')).not.toBeNull();
    expect(screen.getByText(/AI · hard/)).not.toBeNull();
    expect(screen.getByText('Winner')).not.toBeNull();
    expect(screen.getByText('10 VP')).not.toBeNull();
  });

  it('handles game detail 404', async () => {
    const authFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    mockUseAuth.mockReturnValue(authState({ authFetch }));
    render(<GameDetailScreen gameId="nope" onBack={vi.fn()} onWatchReplay={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Game not found.')).not.toBeNull());
  });
});
