/**
 * Game history API client (M6). All requests authenticated via useAuth.
 */
export interface HistoryGameSummary {
  id: string;
  gameType: 'ONLINE' | 'LOCAL';
  gameMode: string;
  status: string;
  mapId: string;
  playerCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  winnerUserId: string | null;
  matchType: 'PRIVATE' | 'MATCHMADE';
}

export interface HistoryPlayer {
  seat: number;
  playerId: string;
  userId: string | null;
  displayName: string;
  playerColor: string;
  isAi: boolean;
  aiDifficulty: string | null;
  aiPersonality: string | null;
  finishPosition: number | null;
  victoryPoints: number | null;
  won: boolean | null;
}

export interface GameDetail {
  game: HistoryGameSummary & { winnerPlayerId: string | null };
  players: HistoryPlayer[];
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  averageVp: number;
  averageFinish: number;
  bestVp: number;
  totalPlayTimeSeconds: number;
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null || totalSeconds < 0) return '—';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function matchTypeLabel(matchType: 'PRIVATE' | 'MATCHMADE'): string {
  return matchType === 'MATCHMADE' ? 'Casual Matchmaking' : 'Private Room';
}
