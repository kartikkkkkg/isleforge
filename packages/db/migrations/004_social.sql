-- 004_social: friendships, blocks, social notifications, game invitations.

-- Friendships: direction-independent unique pair, statuses PENDING/ACCEPTED.
CREATE TABLE friendships (
  id            UUID PRIMARY KEY,
  requester_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_id <> addressee_id)
);

-- Canonical ordering: requester_id < addressee_id (as text compare), so
-- A->B and B->A can't both exist. Enforced in application code; this index
-- guards the common case where the canonical order is used.
CREATE UNIQUE INDEX friendships_pair_unique
  ON friendships (LEAST(requester_id, addressee_id),
                  GREATEST(requester_id, addressee_id));
CREATE INDEX friendships_requester_idx ON friendships (requester_id);
CREATE INDEX friendships_addressee_idx ON friendships (addressee_id);
CREATE INDEX friendships_status_idx ON friendships (status);
CREATE INDEX friendships_user_status_idx ON friendships (requester_id, status);
CREATE INDEX friendships_addressee_status_idx ON friendships (addressee_id, status);

-- Blocks: composite unique key. No self-blocking.
CREATE TABLE blocks (
  blocker_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

-- Social notifications: minimal, non-sensitive.
CREATE TABLE social_notifications (
  id          UUID PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
    'FRIEND_REQUEST_RECEIVED', 'FRIEND_REQUEST_ACCEPTED', 'GAME_INVITE_RECEIVED'
  )),
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  reference_id TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON social_notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON social_notifications (user_id) WHERE read_at IS NULL;

-- Game invitations: ephemeral, 5-minute lifetime.
CREATE TABLE game_invites (
  id          UUID PRIMARY KEY,
  room_code   TEXT NOT NULL,
  inviter_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'
  )),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '5 minutes',
  CHECK (inviter_id <> invitee_id)
);
CREATE INDEX invites_invitee_idx ON game_invites (invitee_id, status, created_at DESC);
CREATE INDEX invites_room_inviter_invitee_idx
  ON game_invites (room_code, inviter_id, invitee_id)
  WHERE status = 'PENDING';

-- Username search for player discovery (case-insensitive).
CREATE INDEX users_username_search_idx ON users (username_normalized text_pattern_ops);
