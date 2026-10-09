-- 003_matchmaking: player ratings + rating history.
-- The live matchmaking queue stays in memory (single-process); only ratings persist.

CREATE TABLE player_ratings (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL DEFAULT 1000 CHECK (rating >= 100),
  games_rated INTEGER NOT NULL DEFAULT 0 CHECK (games_rated >= 0),
  wins        INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses      INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only: never updated or deleted by the rating service.
CREATE TABLE rating_history (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id                TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  rating_before          INTEGER NOT NULL,
  rating_after           INTEGER NOT NULL,
  rating_delta           INTEGER NOT NULL,
  placement              INTEGER NOT NULL CHECK (placement >= 1),
  opponent_average_rating INTEGER NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);
CREATE INDEX rating_history_user_id_idx ON rating_history(user_id, created_at DESC);
CREATE INDEX rating_history_game_id_idx ON rating_history(game_id);

-- M7: distinguish matchmade games from private rooms in history.
ALTER TABLE games ADD COLUMN match_type TEXT NOT NULL DEFAULT 'PRIVATE'
  CHECK (match_type IN ('PRIVATE','MATCHMADE'));
