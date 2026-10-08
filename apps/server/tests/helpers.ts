/**
 * Test helpers: in-process IsleforgeServer + a small WebSocket test client.
 */

import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import type { ClientMessage, ServerMessage } from '@isleforge/protocol';

import { IsleforgeServer } from '../src/server.js';
import type { RateLimit } from '../src/ratelimit.js';

export async function startServer(
  opts: { reconnectGraceMs?: number; rateLimits?: Record<string, RateLimit> } = {},
): Promise<IsleforgeServer> {
  // Test bots act far faster than humans; give them headroom on commands.
  // Security tests override this with a low limit to verify the limiter.
  const rateLimits = { command: { windowMs: 10_000, max: 1000 }, ...opts.rateLimits };
  const server = new IsleforgeServer({ port: 0, reconnectGraceMs: 400, ...opts, rateLimits });
  await server.start();
  return server;
}

export function serverUrl(server: IsleforgeServer): string {
  return `ws://localhost:${server.port}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class TestClient {
  readonly received: ServerMessage[] = [];
  private waiters: { type: string; resolve: (m: ServerMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  private hooks: ((m: ServerMessage) => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data.toString('utf8')) as ServerMessage;
      } catch {
        return;
      }
      for (const h of this.hooks) {
        try {
          h(msg);
        } catch {
          /* hook errors must not break the client */
        }
      }
      this.received.push(msg);
      for (const w of this.waiters.splice(0)) {
        if (w.type === (msg as { type: string }).type || w.type === '*') {
          clearTimeout(w.timer);
          w.resolve(msg);
        } else {
          this.waiters.push(w);
        }
      }
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', (e) => reject(e));
    });
    return new TestClient(ws);
  }

  /** Subscribe to every incoming message (fires before queue/waiters). */
  onMessage(hook: (m: ServerMessage) => void): void {
    this.hooks.push(hook);
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendRaw(text: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
    }
  }

  /**
   * Wait for the next message of `type`, consuming it. Already-received
   * (unconsumed) messages are checked first, so each message is observed once.
   */
  next(type: string, timeoutMs = 8000): Promise<ServerMessage> {
    const idx = this.received.findIndex((m) => (m as { type: string }).type === type);
    if (idx !== -1) return Promise.resolve(this.received.splice(idx, 1)[0]!);
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      const wrapped = (msg: ServerMessage): void => {
        const i = this.received.indexOf(msg);
        if (i !== -1) this.received.splice(i, 1);
        resolve(msg);
      };
      this.waiters.push({ type, resolve: wrapped, reject, timer });
    });
  }

  ofType(type: string): ServerMessage[] {
    return this.received.filter((m) => (m as { type: string }).type === type);
  }

  lastOfType(type: string): ServerMessage | undefined {
    const all = this.ofType(type);
    return all[all.length - 1];
  }

  async waitFor(fn: () => boolean, timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (!fn()) {
      if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
      await sleep(25);
    }
  }

  terminate(): void {
    this.ws.terminate();
  }

  async close(): Promise<void> {
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.close();
      await sleep(50);
    }
  }
}

export { sleep };
export { randomUUID };
