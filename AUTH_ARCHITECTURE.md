# IsleForge — Authentication Architecture (Milestone 5)

Persistent user accounts for IsleForge. Identity (`User`) is separate from
game participation (`Session` → seat): one account can hold many game
sessions, and a game seat references a user id where available. Guests keep
working exactly as in M4.

```
User (usr_…)
 ├── Session A (ses_…) → seat p1 in room ABCD
 ├── Session B (ses_…) → seat p2 in room EFGH
 └── Session C (ses_…) → idle / logged in on another device
```

Never used as identity: WebSocket connection id, IP address, browser
fingerprint, room id.

---

## 1. Database

PostgreSQL. `packages/db` (`@isleforge/db`) owns the schema, a versioned
migration runner, and typed repositories. Production points `DATABASE_URL`
at managed Postgres; development/tests can start an embedded PostgreSQL
(real binaries, same SQL) via `startEmbeddedPostgres()`.

### Migrations

`packages/db/migrations/NNN_name.sql`, applied in order, recorded in
`schema_migrations`. Never destructive. Commands:

```bash
# development (uses DATABASE_URL)
cd packages/db && npm run migrate
```

Tests create an isolated database per file (`resetTestDatabase` +
`migrate`) — they never touch dev/prod data.

### Schema (001_init)

| Table | Purpose |
|---|---|
| `users` | id (`usr_…`), email + normalized unique, username + normalized unique, `password_hash` (scrypt envelope), status, `email_verified_at`, failed-login counters, lockout, timestamps |
| `account_profiles` | user_id FK, display_name, avatar_id, optional country/locale (only if explicitly provided) |
| `sessions` | id (`ses_…`), user_id FK, **refresh_token_hash** (SHA-256, never the raw token), family_id, expires_at, revoked_at, replaced_by, device_label |
| `password_resets` | single-use token hashes with expiry |
| `email_verifications` | single-use token hashes with expiry (not a login blocker) |
| `auth_audit_log` | security events **without secrets** (guarded by `assertNoSecrets`) |

---

## 2. Passwords

- **scrypt** (N=16384, r=8, p=1, 64-byte key) — memory-hard, via Node's
  built-in `crypto`. Envelope: `scrypt$N$r$p$salt$hash`.
- Strength gate: ≥10 chars, 3 of 4 character classes, no whitespace.
- Constant-time comparison on verify. Never logged (tests assert this).

## 3. Sessions

**Access token** — signed JWT (HS256, `AUTH_SECRET`), 15-minute TTL.
Claims: `sub` (userId), `sid` (sessionId), `iat`, `exp`. Stateless;
validated on every authenticated request.

**Refresh token** — opaque 32-byte random, `HttpOnly; SameSite=Lax`
cookie (`Secure` in production). Only its SHA-256 is stored. 30-day TTL.

**Rotation with reuse detection**: each `/auth/refresh` revokes the old
row and issues a new one in the same `family_id`. Presenting a superseded
token → the whole family is revoked (token-theft signal) → `SESSION_REVOKED`.

**Revocation**: per-session (logout), per-user (logout-all, password
change). Logout is idempotent.

## 4. HTTP API

All JSON, typed `{ error: code }` failures:

```
POST /auth/register              { email, username, password, displayName?, avatarId? }
POST /auth/login                 { login, password } → { user, accessToken, expiresIn, sessionId } + cookie
POST /auth/logout                (revokes refresh session, clears cookie)
POST /auth/refresh               (cookie) → rotated pair
GET  /auth/me                    (Bearer) → { user }
PATCH /auth/me                   { displayName?, avatarId? }
GET  /auth/sessions              (Bearer) → active sessions, current flagged
POST /auth/logout-all            (Bearer) → { revoked }
POST /auth/request-password-reset { email } → always { ok: true } (no enumeration)
POST /auth/reset-password        { token, newPassword } (single-use, revokes sessions)
POST /auth/verify-email          { token }
POST /auth/resend-verification   (Bearer)
```

Error codes: `INVALID_EMAIL`, `INVALID_USERNAME`, `USERNAME_RESERVED`,
`WEAK_PASSWORD`, `EMAIL_ALREADY_EXISTS`, `USERNAME_ALREADY_EXISTS`,
`INVALID_CREDENTIALS` (covers unknown user, wrong password, locked,
deleted — **no enumeration**), `ACCOUNT_LOCKED`, `SESSION_EXPIRED`,
`SESSION_REVOKED`, `INVALID_REFRESH_TOKEN`, `INVALID_ACCESS_TOKEN`,
`RATE_LIMITED`, `NOT_AUTHENTICATED`, `FORBIDDEN`.

## 5. Rate limiting & brute force

Dedicated `auth_*` categories in the server rate limiter (register,
login, refresh, profile, logout-all, password-reset, verification,
ws-auth). Login additionally has **per-account exponential backoff**:
after 5 failures the account locks for 2^(n-5) minutes (capped at 1h).
Never permanent.

## 6. Usernames & profiles

- Username: unique, case-insensitive, 3–20 chars `[A-Za-z0-9_]`, no control
  chars. Reserved: `admin`, `system`, `moderator`, `support`, `isleforge`,
  `official`, … (see `RESERVED_USERNAMES`).
- Display name: separate, user-facing, changeable; 1–32 chars.
- Avatars: 8 built-in original SVGs (`compass`, `anchor`, `kraken`,
  `lighthouse`, `helm`, `map`, `flag`, `wave`); stored as `avatar_id`.

## 7. WebSocket authentication

```
Browser ──(login)──▶ HTTP session (cookie + access token in memory)
   │ WS connect
   ▼
AUTHENTICATE { accessToken } ──▶ server verifies JWT itself
   ▼
AUTHENTICATED { userId } ──▶ conn.userId bound (never client-asserted)
   ▼
CREATE/JOIN_ROOM ──▶ seat's PlayerSession records userId
   ▼
RECONNECT { sessionId } ──▶ allowed only if conn.userId == session.userId
```

Guests skip `AUTHENTICATE`; their seats have `userId: null` and work as in
M4. Cross-user reclaim is rejected with `RECONNECT_FAILED`.

## 8. Cookies

`if_refresh`: `HttpOnly`, `SameSite=Lax`, `Path=/`, 30-day `Max-Age`,
`Secure` when `COOKIE_SECURE=true` (production HTTPS). Access tokens are
never in cookies or localStorage — memory only.

## 9. Security assumptions

- All SQL is parameterized (`$1…`); identifiers validated where dynamic.
- The server never trusts client-provided user ids — identity always
  derives from verified credentials.
- Audit log refuses secret-bearing keys/values (throws; tested).
- Login/password-reset responses are enumeration-free.
- CSRF: state-changing auth endpoints use SameSite=Lax cookies; refresh
  requires the cookie (not readable by JS).

## 10. Guest model & future migration (§20)

Guests remain first-class: no account, no persistence, clearly labeled
"Guest" in UI. When a guest later registers, a future milestone can link
history via a `guest_claims(guest_key, user_id, claimed_at)` table —
**documented here, not implemented** (no guest keys are issued in M5).

## 11. What M5 does NOT include

Friends, matchmaking, MMR/ranked, leaderboards, achievements, cosmetics
economy, payments, seasons, public discovery — later milestones.
