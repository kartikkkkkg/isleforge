/**
 * ServerGame — the authoritative game instance.
 *
 * Owns exactly one @isleforge/game-engine Game. Every command (human or AI)
 * flows through handleCommand(); the engine validates and executes it, and
 * the resulting events are broadcast. Game rules are never duplicated here.
 *
 * Hidden information: snapshots use engine.publicView(playerId) and events
 * are masked per viewer (maskEventForViewer) before broadcast.
 */

import {
  EngineError,
  Game,
  publicGameState,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerColor,
  type PublicGameState,
} from '@isleforge/game-engine';
import { createBot, shouldAcceptTrade, type BotAgent, type Difficulty, type Personality } from '@isleforge/ai';
import type { ErrorCode } from '@isleforge/protocol';

export interface ServerPlayerDef {
  id: string;
  name: string;
  color: PlayerColor;
}

export interface AiSeatConfig {
  difficulty: Difficulty;
  personality: Personality;
}

export interface ServerGameOptions {
  gameId: string;
  players: ServerPlayerDef[];
  /** Seats piloted by the server AI (playerId -> config). */
  aiSeats: Map<string, AiSeatConfig>;
  seed?: number;
}

export type CommandOutcome =
  | {
      ok: true;
      /** Event seqs produced by this command (including AI follow-ups). */
      seqs: number[];
      events: GameEvent[];
      ended: boolean;
      winnerId: string | null;
    }
  | { ok: false; code: ErrorCode; message: string };

const MAX_AI_CASCADE = 500;

export class ServerGame {
  readonly gameId: string;
  private engine: Game;
  private agents = new Map<string, BotAgent>();
  private aiConfigs = new Map<string, { difficulty: Difficulty; personality: Personality; seed: number }>();
  /**
   * Seats temporarily piloted by the server AI (disconnected humans past
   * their reconnect grace). Part of the game so every AI cascade — including
   * the one inside handleCommand — plays them. Cleared on reconnect.
   */
  private takeoverAgents = new Map<string, BotAgent>();
  /** Idempotency: commandId -> seqs already produced. */
  private seenCommands = new Map<string, number[]>();
  private ended = false;
  private winnerId: string | null = null;

  constructor(opts: ServerGameOptions) {
    this.gameId = opts.gameId;
    this.engine = new Game({
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      players: opts.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    });
    for (const [playerId, cfg] of opts.aiSeats) {
      const seed = ((opts.seed ?? 1) ^ playerId.length) >>> 0;
      this.agents.set(
        playerId,
        createBot({ difficulty: cfg.difficulty, personality: cfg.personality, seed }),
      );
      this.aiConfigs.set(playerId, { ...cfg, seed });
    }
  }

  /** Who must act now: setup cursor, a discarder, or the current player. */
  activeActor(): string | null {
    const s = this.engine.getState();
    if (s.phase === 'gameover') return null;
    if (s.phase === 'setup' && s.setup) return s.setup.order[s.setup.cursor] ?? null;
    if (s.phase === 'discard' && s.pendingDiscards) {
      return Object.keys(s.pendingDiscards)[0] ?? null;
    }
    return s.currentPlayerId;
  }

  isAiSeat(playerId: string): boolean {
    return this.agents.has(playerId);
  }

  /**
   * Set or clear server-AI piloting for a (disconnected human) seat.
   * Takeover agents run inside every AI cascade, so the game never stalls.
   */
  setTakeover(playerId: string, cfg: AiSeatConfig | null): void {
    if (cfg) {
      this.takeoverAgents.set(
        playerId,
        createBot({ difficulty: cfg.difficulty, personality: cfg.personality, seed: 0x7a1ab1 }),
      );
    } else {
      this.takeoverAgents.delete(playerId);
    }
  }

  isEnded(): boolean {
    return this.ended;
  }

  getWinnerId(): string | null {
    return this.winnerId;
  }

  /** Monotonic seq of the latest engine event (-1 when no events yet). */
  get lastSeq(): number {
    return this.engine.getEvents().length - 1;
  }

  eventsAfter(seq: number): GameEvent[] {
    return this.engine.getEvents().filter((e) => e.seq > seq);
  }

  /** Masked snapshot for one viewer. Never leaks hidden information. */
  snapshotFor(playerId: string): { state: PublicGameState; lastSeq: number } {
    return { state: this.engine.publicView(playerId), lastSeq: this.lastSeq };
  }

  /** Full state for server-side use (AI, tests). Never sent to clients. */
  debugState(): GameState {
    return this.engine.getState();
  }

  /**
   * Validate and execute one command from `playerId`.
   * Anti-cheat: the command's playerId must match the sender; the engine
   * enforces turn ownership, legality, and affordability.
   */
  handleCommand(playerId: string, commandId: string, command: Command): CommandOutcome {
    if (this.ended) {
      return { ok: false, code: 'INVALID_GAME_STATE', message: 'The game has ended.' };
    }
    const seen = this.seenCommands.get(commandId);
    if (seen) {
      // Idempotent retransmit: do not execute twice.
      const events = this.engine.getEvents().filter((e) => seen.includes(e.seq));
      return { ok: true, seqs: seen, events, ended: false, winnerId: null };
    }
    if (command.playerId !== playerId) {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        message: 'Command playerId does not match your session.',
      };
    }
    let produced: GameEvent[];
    try {
      produced = this.engine.dispatch(command);
    } catch (e) {
      return this.mapEngineError(e);
    }
    const seqs = produced.map((e) => e.seq);
    this.seenCommands.set(commandId, seqs);

    // Server-side AI cascade: AI seats act through the same pipeline.
    const aiEvents = this.pumpAi();
    // AI seats auto-answer pending player trades (mirrors the local bot runner).
    const tradeEvents = this.answerAiTrades();
    const allEvents = [...produced, ...aiEvents, ...tradeEvents];
    const allSeqs = allEvents.map((e) => e.seq);

    const ended = this.checkEnded();
    return {
      ok: true,
      seqs: allSeqs,
      events: allEvents,
      ended,
      winnerId: this.winnerId,
    };
  }

  /**
   * AI seats answer pending player trade proposals via shouldAcceptTrade.
   * Runs through the same dispatch pipeline — never a direct state mutation.
   */
  answerAiTrades(): GameEvent[] {
    const out: GameEvent[] = [];
    if (this.ended) return out;
    // Snapshot the list first: answering mutates pendingTrades.
    const pending = this.engine.getState().pendingTrades.slice();
    for (const tr of pending) {
      const cfg = this.aiConfigs.get(tr.toPlayerId);
      if (!cfg) continue;
      let accept: boolean;
      try {
        accept = shouldAcceptTrade(this.engine.getState(), tr.toPlayerId, tr.offer, tr.request, {
          difficulty: cfg.difficulty,
          personality: cfg.personality,
          seed: cfg.seed,
        });
      } catch {
        continue;
      }
      try {
        const produced = this.engine.dispatch({
          type: accept ? 'TRADE_ACCEPT' : 'TRADE_DECLINE',
          playerId: tr.toPlayerId,
          tradeId: tr.id,
        });
        out.push(...produced);
      } catch {
        /* trade vanished mid-answer — ignore */
      }
      if (this.checkEnded()) break;
    }
    return out;
  }

  /**
   * Run AI seats until a human must act (or the game ends). Covers configured
   * AI seats and disconnected humans under AI takeover.
   */
  pumpAi(): GameEvent[] {
    const out: GameEvent[] = [];
    for (let i = 0; i < MAX_AI_CASCADE; i++) {
      if (this.ended) break;
      const actor = this.activeActor();
      if (!actor) break;
      const agent = this.agents.get(actor) ?? this.takeoverAgents.get(actor);
      if (!agent) break;
      let cmd: Command | null;
      try {
        cmd = agent.chooseAction(this.engine.getState(), actor);
      } catch {
        break;
      }
      if (!cmd) break;
      try {
        const produced = this.engine.dispatch(cmd);
        out.push(...produced);
      } catch {
        // AI chose an illegal command (shouldn't happen — it only picks
        // from legalCommands). Stop the cascade rather than spinning.
        break;
      }
      if (this.checkEnded()) break;
    }
    return out;
  }

  private checkEnded(): boolean {
    if (this.ended) return true;
    const s = this.engine.getState();
    if (s.phase === 'gameover') {
      this.ended = true;
      this.winnerId = s.winnerId ?? null;
      return true;
    }
    return false;
  }

  private mapEngineError(e: unknown): CommandOutcome {
    if (e instanceof EngineError) {
      if (e.code === 'NOT_YOUR_TURN') {
        return { ok: false, code: 'NOT_YOUR_TURN', message: 'Wait for your turn.' };
      }
      return { ok: false, code: 'INVALID_COMMAND', message: e.message };
    }
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Command failed.' };
  }
}

/**
 * Mask one engine event for a viewer. The two leaks in the raw event stream:
 * - CARD_PURCHASED carries the drafted cardType (secret until played).
 * - RESOURCE_STOLEN carries the stolen resource (secret from bystanders).
 */
export function maskEventForViewer(event: GameEvent, viewerId: string): GameEvent {
  if (event.type === 'CARD_PURCHASED' && event.playerId !== viewerId) {
    const clone = structuredClone(event);
    (clone.data as { cardType: unknown }).cardType = 'hidden';
    return clone;
  }
  if (event.type === 'RESOURCE_STOLEN') {
    const from = (event.data as { fromPlayerId?: string }).fromPlayerId;
    if (event.playerId !== viewerId && from !== viewerId) {
      const clone = structuredClone(event);
      (clone.data as { resource: unknown }).resource = null;
      return clone;
    }
  }
  return event;
}

/** Convenience: masked public view without a ServerGame (tests). */
export function maskedView(state: GameState, viewerId: string): PublicGameState {
  return publicGameState(state, viewerId);
}
