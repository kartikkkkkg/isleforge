/**
 * GameRecorder — persists completed games to PostgreSQL.
 *
 * The engine is authoritative: every value recorded here is derived from
 * engine state / server-generated engine events. The database never decides
 * who won. All finalization is idempotent (safe to run twice) and atomic
 * (single transaction per game).
 */
import type { Pool } from 'pg';
import { GamesRepo, type GamePlayerInput, type PersistedEvent, type PlayerGameStatsInput } from '@isleforge/db';
import { victoryPoints, type GameState, type GameEvent } from '@isleforge/game-engine';

export interface RecorderSeat {
  /** 0-based seat index. */
  seat: number;
  /** Engine seat id: p1, p2, … */
  playerId: string;
  /** Authenticated user id, or null for guests. */
  userId: string | null;
  /** Display name at game time (snapshot). */
  displayName: string;
  playerColor: string;
  isAi: boolean;
  aiDifficulty?: string | null;
  aiPersonality?: string | null;
}

export interface RecordStartInput {
  gameId: string;
  gameType: 'ONLINE' | 'LOCAL';
  gameMode?: 'CASUAL' | 'RANKED' | 'RUSH' | 'CUSTOM' | undefined;
  mapId?: string | undefined;
  matchType?: 'PRIVATE' | 'MATCHMADE' | undefined;
  seats: RecorderSeat[];
  startedAt: Date;
}

export interface RecordEndInput {
  gameId: string;
  /** Full engine state at gameover. */
  state: GameState;
  /** All server-generated engine events, ordered. */
  events: GameEvent[];
  seats: RecorderSeat[];
  finishedAt: Date;
}

export interface Standing {
  seat: number;
  playerId: string;
  userId: string | null;
  victoryPoints: number;
  finishPosition: number;
  won: boolean;
}

/**
 * Compute final standings from engine state. Sorted by total VP desc;
 * ties broken by public VP, then by seat order (deterministic).
 */
export function computeStandings(state: GameState, seats: RecorderSeat[]): Standing[] {
  const scored = seats.map((s) => {
    const p = state.players.find((pl) => pl.id === s.playerId);
    const vp = p ? victoryPoints(p, state).total : 0;
    const pub = p ? victoryPoints(p, state).public : 0;
    return { ...s, vp, pub };
  });
  scored.sort((a, b) => b.vp - a.vp || b.pub - a.pub || a.seat - b.seat);
  const winnerId = state.winnerId;
  return scored.map((s, i) => ({
    seat: s.seat,
    playerId: s.playerId,
    userId: s.userId,
    victoryPoints: s.vp,
    finishPosition: i + 1,
    won: winnerId ? s.playerId === winnerId : i === 0,
  }));
}

export class GameRecorder {
  private repo: GamesRepo;

  constructor(private pool: Pool) {
    this.repo = new GamesRepo(pool);
  }

  get games(): GamesRepo {
    return this.repo;
  }

  /** Persist game start + seat roster. Idempotent. */
  async recordStart(input: RecordStartInput): Promise<void> {
    await this.repo.insertGame({
      id: input.gameId,
      gameType: input.gameType,
      gameMode: input.gameMode,
      mapId: input.mapId,
      playerCount: input.seats.length,
      startedAt: input.startedAt,
      matchType: input.matchType,
    });
    const players: GamePlayerInput[] = input.seats.map((s) => ({
      seat: s.seat,
      playerId: s.playerId,
      userId: s.userId,
      displayNameSnapshot: s.displayName,
      playerColor: s.playerColor,
      isAi: s.isAi,
      aiDifficulty: s.aiDifficulty ?? null,
      aiPersonality: s.aiPersonality ?? null,
    }));
    await this.repo.insertPlayers(input.gameId, players);
  }

  /**
   * Persist game completion. Idempotent: if the game is already COMPLETED,
   * returns false and writes nothing. Otherwise writes game + players +
   * events + stats in one transaction.
   */
  async recordEnd(input: RecordEndInput): Promise<{ recorded: boolean; standings: Standing[] }> {
    const standings = computeStandings(input.state, input.seats);
    const winner = standings.find((s) => s.won) ?? null;

    // Duration is server-side: finished_at - started_at from the games row.
    const existing = await this.repo.findById(input.gameId);
    const startedAt = existing?.started_at ?? input.finishedAt;
    const durationSeconds = Math.max(
      0,
      Math.round((input.finishedAt.getTime() - startedAt.getTime()) / 1000),
    );

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = new GamesRepo(client);
      const transitioned = await tx.completeGame({
        id: input.gameId,
        winnerUserId: winner?.userId ?? null,
        winnerPlayerId: winner?.playerId ?? null,
        finishedAt: input.finishedAt,
        durationSeconds,
      });
      if (!transitioned) {
        await client.query('ROLLBACK');
        return { recorded: false, standings };
      }

      await tx.finalizePlayers(
        input.gameId,
        standings.map((s) => ({
          seat: s.seat,
          finishPosition: s.finishPosition,
          victoryPoints: s.victoryPoints,
          won: s.won,
        })),
      );

      // Events: server-generated engine events only, ordered by seq.
      const seatByPlayerId = new Map(input.seats.map((s) => [s.playerId, s.seat]));
      const persisted: PersistedEvent[] = input.events.map((e) => ({
        sequence: e.seq,
        eventType: e.type,
        actorSeat: e.playerId ? (seatByPlayerId.get(e.playerId) ?? null) : null,
        payload: 'data' in e ? e.data : {},
      }));
      await tx.insertEvents(input.gameId, persisted);

      // Per-user stats (authenticated users only; guests have no user_id).
      const stats = this.buildStats(input, standings);
      await tx.insertPlayerStats(input.gameId, stats);

      await client.query('COMMIT');
      return { recorded: true, standings };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private buildStats(input: RecordEndInput, standings: Standing[]): PlayerGameStatsInput[] {
    const byPlayer = new Map<string, GameState['players'][number]>();
    for (const p of input.state.players) byPlayer.set(p.id, p);

    const bought = new Map<string, number>();
    const played = new Map<string, number>();
    for (const e of input.events) {
      if (!e.playerId) continue;
      if (e.type === 'CARD_PURCHASED') bought.set(e.playerId, (bought.get(e.playerId) ?? 0) + 1);
      if (e.type === 'CARD_PLAYED') played.set(e.playerId, (played.get(e.playerId) ?? 0) + 1);
    }

    const out: PlayerGameStatsInput[] = [];
    for (const st of standings) {
      if (!st.userId) continue; // guests/AI without accounts: no per-user stats
      const p = byPlayer.get(st.playerId);
      out.push({
        userId: st.userId,
        seat: st.seat,
        vp: st.victoryPoints,
        finishPosition: st.finishPosition,
        won: st.won,
        roadsBuilt: p?.roads.length ?? 0,
        settlementsBuilt: p?.settlements.length ?? 0,
        citiesBuilt: p?.cities.length ?? 0,
        devCardsBought: bought.get(st.playerId) ?? 0,
        devCardsPlayed: played.get(st.playerId) ?? 0,
      });
    }
    return out;
  }
}
