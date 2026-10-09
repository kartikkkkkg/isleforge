-- 002_game_history: persistent game records, players, events, per-player stats.
-- The engine remains authoritative; this only records outcomes.

CREATE TABLE games (
  id               TEXT PRIMARY KEY,   -- server gameId (uuid)
  game_type        TEXT NOT NULL CHECK (game_type IN ('ONLINE','LOCAL')),
  game_mode        TEXT NOT NULL DEFAULT 'CASUAL'
                   CHECK (game_mode IN ('CASUAL','RANKED','RUSH','CUSTOM')),
  status           TEXT NOT NULL DEFAULT 'CREATED'
                   CHECK (status IN ('CREATED','STARTED','COMPLETED','ABANDONED','CANCELLED')),
  map_id           TEXT NOT NULL DEFAULT 'archipelago',
  player_count     INTEGER NOT NULL CHECK (player_count BETWEEN 2 AND 8),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  winner_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  winner_player_id TEXT,                -- engine seat id (p1..), kept even for guests/AI
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX games_winner_user_id_idx ON games(winner_user_id) WHERE winner_user_id IS NOT NULL;
CREATE INDEX games_finished_at_idx ON games(finished_at DESC) WHERE finished_at IS NOT NULL;
CREATE INDEX games_status_idx ON games(status);

-- One row per seat. user_id NULL = guest or AI seat (is_ai distinguishes).
-- display_name_snapshot freezes the name shown during the game.
CREATE TABLE game_players (
  game_id               TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat                  INTEGER NOT NULL CHECK (seat >= 0),
  player_id             TEXT NOT NULL,     -- engine seat id: p1, p2, …
  user_id               TEXT REFERENCES users(id) ON DELETE SET NULL,
  display_name_snapshot TEXT NOT NULL,
  player_color          TEXT NOT NULL,
  is_ai                 BOOLEAN NOT NULL DEFAULT FALSE,
  ai_difficulty         TEXT,
  ai_personality        TEXT,
  finish_position       INTEGER CHECK (finish_position IS NULL OR finish_position >= 1),
  victory_points        INTEGER CHECK (victory_points IS NULL OR victory_points >= 0),
  won                   BOOLEAN,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at               TIMESTAMPTZ,
  PRIMARY KEY (game_id, seat)
);
CREATE INDEX game_players_user_id_idx ON game_players(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX game_players_game_id_idx ON game_players(game_id);

-- Server-generated engine events only. UNIQUE(game_id, sequence) keeps the
-- stream ordered and makes duplicate persistence safe.
CREATE TABLE game_events (
  game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sequence   INTEGER NOT NULL CHECK (sequence >= 0),
  event_type TEXT NOT NULL,
  actor_seat INTEGER,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, sequence)
);
-- PK covers (game_id, sequence) lookups; no extra index needed.

-- Per-user per-game aggregates, derived from the engine at finalization.
-- Only metrics the engine actually produces; never fabricated.
CREATE TABLE player_game_stats (
  game_id            TEXT NOT NULL,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seat               INTEGER NOT NULL,
  vp                 INTEGER NOT NULL,
  finish_position    INTEGER NOT NULL,
  won                BOOLEAN NOT NULL,
  roads_built        INTEGER NOT NULL DEFAULT 0,
  settlements_built  INTEGER NOT NULL DEFAULT 0,
  cities_built       INTEGER NOT NULL DEFAULT 0,
  dev_cards_bought   INTEGER NOT NULL DEFAULT 0,
  dev_cards_played   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, user_id),
  FOREIGN KEY (game_id, seat) REFERENCES game_players(game_id, seat) ON DELETE CASCADE
);
CREATE INDEX player_game_stats_user_id_idx ON player_game_stats(user_id);
