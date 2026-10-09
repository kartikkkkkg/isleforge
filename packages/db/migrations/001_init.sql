-- 001_init: users, profiles, sessions, password resets, email verifications, audit log.
-- All queries in the app use parameterized statements ($1, $2, …); this file
-- is the only place raw DDL lives.

CREATE TABLE users (
  id                TEXT PRIMARY KEY,              -- usr_ + base36, immutable
  email             TEXT NOT NULL,                 -- as provided (display)
  email_normalized  TEXT NOT NULL UNIQUE,          -- lowercased + trimmed
  username          TEXT NOT NULL,                 -- as provided (display)
  username_normalized TEXT NOT NULL UNIQUE,        -- lowercased
  password_hash     TEXT NOT NULL,                 -- scrypt envelope, never plaintext
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','deleted')),
  email_verified_at TIMESTAMPTZ,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ
);

CREATE TABLE account_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_id    TEXT NOT NULL DEFAULT 'compass',
  country      TEXT,                                -- ISO code, only if explicitly provided
  locale       TEXT,                                -- only if explicitly provided
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side refresh-token sessions. The refresh token itself is never
-- stored: only its SHA-256 hash. Rotation creates a new row in the same
-- family; reuse of a superseded token revokes the whole family.
CREATE TABLE sessions (
  id                 TEXT PRIMARY KEY,             -- ses_ + base36; also the JWT 'sid' claim
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  family_id          TEXT NOT NULL,                -- fam_ + base36
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  replaced_by        TEXT,                         -- session id that rotated this one
  device_label       TEXT,                         -- truncated User-Agent, no IP stored
  last_used_at       TIMESTAMPTZ
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_family_id_idx ON sessions(family_id);

-- Single-use, short-lived password reset tokens (hash only).
CREATE TABLE password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX password_resets_user_id_idx ON password_resets(user_id);

-- Single-use email verification tokens (hash only). Not a login blocker.
CREATE TABLE email_verifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

-- Security audit log. NEVER store passwords, hashes, or tokens here.
CREATE TABLE auth_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  event      TEXT NOT NULL,                        -- login_success, login_failure, logout, …
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details    JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX auth_audit_log_user_id_idx ON auth_audit_log(user_id);
