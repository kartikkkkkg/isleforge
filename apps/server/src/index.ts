#!/usr/bin/env node
/**
 * Isleforge multiplayer server entry point.
 *
 *   npm run dev --workspace @isleforge/server [-- --port 8080]
 *   npm run start --workspace @isleforge/server
 *
 * The server is authoritative: it owns game state via @isleforge/game-engine.
 * Browsers are untrusted clients communicating over the versioned protocol
 * defined in @isleforge/protocol.
 */

import { IsleforgeServer } from './server.js';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const port = Number(argValue('--port') ?? process.env.PORT ?? 8080);
const reconnectGraceMs = Number(
  argValue('--grace-ms') ?? process.env.RECONNECT_GRACE_MS ?? 120_000,
);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Invalid port: ${process.argv}`);
  process.exit(1);
}

const server = new IsleforgeServer({ port, reconnectGraceMs });
await server.start();
console.log(`Isleforge multiplayer server listening on ws://localhost:${server.port}`);
console.log(`Reconnect grace period: ${reconnectGraceMs}ms`);

const shutdown = async (): Promise<void> => {
  console.log('\nShutting down…');
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
