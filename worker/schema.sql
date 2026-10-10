-- D1 schema for Pointle's leaderboards.
--
-- Pointing and scoring happen entirely in the player's browser; the player's location never reaches this
-- database. Rows hold: nickname, optional player-typed town NAME, mode, device type, the day's (public)
-- target ids, per-target errors and timings, and the total. Honour-based beyond the worker's checks.

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,   -- server-generated UUID
  token_hash TEXT NOT NULL,      -- SHA-256 of a server-issued token
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players (id),
  day_key      TEXT NOT NULL,     -- puzzle's UTC day, YYYY-MM-DD
  week_key     TEXT NOT NULL,     -- Monday of that ISO week (weekly boards)
  mode         TEXT NOT NULL CHECK (mode IN ('sensor', 'map', 'fixed-sensor', 'fixed-map')),
  device       TEXT NOT NULL CHECK (device IN ('phone', 'desktop')),
  name         TEXT NOT NULL,
  town         TEXT,              -- nearest town / picked town / "Fixed spot: X"; shown only, never used for grouping or filtering
  targets      TEXT NOT NULL,     -- JSON array of target ids (3 a day)
  errors       TEXT NOT NULL,     -- JSON array of errors (degrees)
  durations    TEXT NOT NULL,     -- JSON array of durations (ms)
  total        INTEGER NOT NULL CHECK (total >= 0 AND total <= 500),
  submitted_at TEXT NOT NULL,
  is_late      INTEGER NOT NULL DEFAULT 0   -- 1 = archive replay of a past day (separate "late" board)
);
-- one entry per player per day per mode per board: the first submission counts
CREATE UNIQUE INDEX IF NOT EXISTS results_player_day_mode_late ON results (player_id, day_key, mode, is_late);
CREATE INDEX IF NOT EXISTS results_day_board ON results (day_key, mode, is_late, total DESC, submitted_at ASC);
CREATE INDEX IF NOT EXISTS results_week_board ON results (week_key, mode);

CREATE TABLE IF NOT EXISTS groups (
  code       TEXT PRIMARY KEY,   -- short join code
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES players (id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  code      TEXT NOT NULL REFERENCES groups (code),
  player_id TEXT NOT NULL REFERENCES players (id),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (code, player_id)
);
CREATE INDEX IF NOT EXISTS group_members_player ON group_members (player_id);
