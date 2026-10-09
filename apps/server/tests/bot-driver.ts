/**
 * Shared bot-driven test client (extracted from integration.test.ts).
 * Not a .test.ts file — vitest does not run it directly.
 */
import { createBot, type BotAgent, type Difficulty, type Personality } from '@isleforge/ai';
import type { GameEvent, GameState, PublicGameState } from '@isleforge/game-engine';
import type { ServerMessage } from '@isleforge/protocol';
import { sleep, randomUUID, TestClient } from './helpers.js';

function activeActor(state: PublicGameState): string | null {
  if (state.phase === 'gameover') return null;
  if (state.phase === 'setup' && state.setup) return state.setup.order[state.setup.cursor] ?? null;
  if (state.phase === 'discard' && state.pendingDiscards) {
    return Object.keys(state.pendingDiscards)[0] ?? null;
  }
  return state.currentPlayerId;
}
export class BotDriver {
  playerId = '';
  roomCode = '';
  sessionId = '';
  state: PublicGameState | null = null;
  version = 0;
  ended = false;
  winnerId: string | null = null;
  events: GameEvent[] = [];
  lastSeq = -1;
  private bot: BotAgent;
  private stopped = false;

  constructor(
    readonly client: TestClient,
    difficulty: Difficulty,
    personality: Personality,
    seed: number,
  ) {
    this.bot = createBot({ difficulty, personality, seed });
    client.onMessage((m) => this.pump(m));
  }

  private pump(m: ServerMessage): void {
    switch (m.type) {
      case 'ROOM_CREATED':
        this.playerId = m.playerId;
        this.sessionId = m.sessionId;
        this.roomCode = m.room.code;
        break;
      case 'GAME_STARTED':
        this.playerId = m.playerId;
        break;
      case 'RECONNECT_SUCCESS':
        this.playerId = m.playerId;
        this.roomCode = m.room.code;
        // Missed events arrive oldest-first; seed the stream.
        for (const e of m.missedEvents) this.events.push(e);
        const last = m.missedEvents[m.missedEvents.length - 1];
        if (last) {
          this.lastSeq = last.seq;
        }
        break;
      case 'GAME_STATE':
        this.state = m.state;
        this.lastSeq = m.lastSeq;
        this.version++;
        break;
      case 'GAME_EVENT':
        this.events.push(m.event);
        break;
      case 'GAME_ENDED':
        this.ended = true;
        this.winnerId = m.winnerId;
        break;
      default:
        break;
    }
  }

  errorCount(): number {
    return this.client.ofType('ERROR').length;
  }

  stop(): void {
    this.stopped = true;
  }

  async waitReady(): Promise<void> {
    await this.client.waitFor(() => this.playerId !== '');
  }

  /** Play until GAME_ENDED (or stop() / a stall). */
  async drive(): Promise<void> {
    while (!this.ended && !this.stopped) {
      const st = this.state;
      if (st && !this.stopped && activeActor(st) === this.playerId) {
        let cmd: ReturnType<BotAgent['chooseAction']>;
        try {
          cmd = this.bot.chooseAction(st as unknown as GameState, this.playerId);
        } catch {
          await sleep(200);
          continue;
        }
        if (cmd) {
          const v0 = this.version;
          const e0 = this.errorCount();
          this.client.send({ v: 1, type: 'GAME_COMMAND', commandId: randomUUID(), command: cmd });
          try {
            await this.client.waitFor(
              () => this.version > v0 || this.ended || this.stopped || this.errorCount() > e0,
              30000,
            );
          } catch {
            throw new Error(`Bot ${this.playerId} stalled waiting for server response`);
          }
          if (this.stopped || this.ended) break;
          if (this.errorCount() > e0 && this.version === v0) {
            // Rejected on the same state. Retrying the same decision would
            // just fail again (and hammer the rate limiter), so wait for the
            // game to advance first. If it never advances, the decision was
            // genuinely illegal — surface the real error instead of a
            // RATE_LIMITED storm.
            const errs = this.client.ofType('ERROR') as Extract<
              ServerMessage,
              { type: 'ERROR' }
            >[];
            const mine = errs.slice(e0);
            try {
              await this.client.waitFor(
                () => this.version > v0 || this.ended || this.stopped,
                15000,
              );
            } catch {
              throw new Error(
                `Bot ${this.playerId}: command rejected and game never advanced: ${JSON.stringify(mine.slice(-2).map((e) => e.code))}`,
              );
            }
            continue;
          }
        } else {
          await sleep(200);
        }
      } else {
        await sleep(25);
      }
    }
  }
}

export async function setupLobby(
  url: string,
  names: string[],
  opts: { roomSize?: 3 | 4; ai?: number } = {},
): Promise<BotDriver[]> {
  const personalities: Personality[] = ['balanced', 'aggressive', 'builder', 'trader'];
  const drivers: BotDriver[] = [];
  for (let i = 0; i < names.length; i++) {
    const client = await TestClient.connect(url);
    const d = new BotDriver(client, 'normal', personalities[i % personalities.length]!, 1000 + i);
    drivers.push(d);
    if (i === 0) {
      client.send({
        v: 1,
        type: 'CREATE_ROOM',
        name: names[0]!,
        ...(opts.roomSize !== undefined ? { settings: { roomSize: opts.roomSize } } : {}),
      });
    } else {
      await drivers[0]!.client.waitFor(() => drivers[0]!.roomCode !== '');
      client.send({ v: 1, type: 'JOIN_ROOM', code: drivers[0]!.roomCode, name: names[i]! });
    }
    await d.waitReady();
  }
  return drivers;
}


export async function readyAndStart(drivers: BotDriver[], aiCount = 0): Promise<void> {
  const host = drivers[0]!;
  for (let i = 0; i < aiCount; i++) {
    host.client.send({ v: 1, type: 'ADD_AI', difficulty: 'normal' });
    await host.client.waitFor(() => {
      const m = host.client.lastOfType('ROOM_STATE') as Extract<
        ServerMessage,
        { type: 'ROOM_STATE' }
      > | undefined;
      return (m?.room.players.length ?? 0) >= drivers.length + i + 1;
    });
  }
  for (const d of drivers) {
    d.client.send({ v: 1, type: 'SET_READY', ready: true });
  }
  await host.client.waitFor(() => {
    const m = host.client.lastOfType('ROOM_STATE') as Extract<
      ServerMessage,
      { type: 'ROOM_STATE' }
    > | undefined;
    const humans = m?.room.players.filter((p) => !p.isBot) ?? [];
    return humans.length === drivers.length && humans.every((p) => p.ready);
  });
  host.client.send({ v: 1, type: 'START_GAME' });
  await host.client.waitFor(() =>
    host.client.ofType('GAME_STARTED').length > 0,
  );
  // Every driver sees the start + initial snapshot.
  for (const d of drivers) {
    await d.client.waitFor(
      () => d.client.ofType('GAME_STARTED').length > 0,
    );
  }
}
