-- Tomatonater database (Cloudflare D1 / SQLite)
-- One row per duel. Small on purpose: the whole game state lives here.

CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,          -- short share code, e.g. "k7f2qa"
  created_at    INTEGER NOT NULL,          -- epoch ms
  updated_at    INTEGER NOT NULL,          -- epoch ms (touched on every write)
  pace          TEXT NOT NULL DEFAULT 'blitz',   -- 'real' | 'blitz'
  target        INTEGER NOT NULL DEFAULT 10,     -- points needed to win
  thrower       INTEGER NOT NULL DEFAULT 1,      -- whose turn to THROW next (1 | 2)
  round         INTEGER NOT NULL DEFAULT 1,
  evseq         INTEGER NOT NULL DEFAULT 0,      -- bumps on every resolved event (clients diff this)
  last_event    TEXT,                            -- JSON of the most recent resolution, for toasts
  winner        INTEGER,                         -- NULL | 1 | 2

  -- Player 1
  p1_token      TEXT,                            -- secret; proves you are seat 1
  p1_name       TEXT,
  p1_city       TEXT,
  p1_lat        REAL,
  p1_lng        REAL,
  p1_points     INTEGER NOT NULL DEFAULT 0,      -- score = successful splats landed
  p1_coins      INTEGER NOT NULL DEFAULT 0,      -- future shop currency
  p1_upgrades   TEXT NOT NULL DEFAULT '{}',      -- future: {speedTier, cosmetics:{cat,tomato,bg}, items:{...}}

  -- Player 2
  p2_token      TEXT,
  p2_name       TEXT,
  p2_city       TEXT,
  p2_lat        REAL,
  p2_lng        REAL,
  p2_points     INTEGER NOT NULL DEFAULT 0,
  p2_coins      INTEGER NOT NULL DEFAULT 0,
  p2_upgrades   TEXT NOT NULL DEFAULT '{}',

  -- The tomato currently in flight (all NULL when nothing is flying)
  flight_from   INTEGER,   -- seat that threw (1 | 2)
  flight_launch INTEGER,   -- epoch ms it was thrown
  flight_arrive INTEGER,   -- epoch ms it lands (dodge before this)
  flight_speed  REAL,      -- km/h
  flight_dist   REAL,      -- km
  flight_power  INTEGER,   -- 0..100 the thrower charged
  flight_status TEXT       -- 'flying' | NULL
);

CREATE INDEX IF NOT EXISTS idx_games_updated ON games(updated_at);
