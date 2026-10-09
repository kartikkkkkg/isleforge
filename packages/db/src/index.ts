/** @isleforge/db — PostgreSQL persistence for Isleforge accounts. */
export { getPool, closePool, createPool } from './client.js';
export { migrate, migrationStatus, resetTestDatabase } from './migrate.js';
export { startEmbeddedPostgres, type EmbeddedOptions, type EmbeddedPostgresHandle } from './embedded.js';
export { newUserId, newSessionId, newFamilyId, newResetId } from './ids.js';
export { UsersRepo, type CreateUserInput } from './repos/users.js';
export { SessionsRepo, type CreateSessionInput } from './repos/sessions.js';
export { ResetsRepo } from './repos/resets.js';
export { AuditRepo, assertNoSecrets, type AuthAuditEvent } from './repos/audit.js';
export {
  GamesRepo,
  type GameRow,
  type GamePlayerInput,
  type GamePlayerRow,
  type PersistedEvent,
  type PlayerGameStatsInput,
} from './repos/games.js';
export type {
  UserRow,
  ProfileRow,
  SessionRow,
  PasswordResetRow,
  EmailVerificationRow,
  PublicAccount,
} from './types.js';
