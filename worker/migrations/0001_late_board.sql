-- Archive replays: entries for past days go on a separate "late" board and never change the day's
-- original results. One entry per player, day, mode and board.
ALTER TABLE results ADD COLUMN is_late INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS results_player_day_mode;
CREATE UNIQUE INDEX IF NOT EXISTS results_player_day_mode_late ON results (player_id, day_key, mode, is_late);
DROP INDEX IF EXISTS results_day_board;
CREATE INDEX IF NOT EXISTS results_day_board ON results (day_key, mode, is_late, total DESC, submitted_at ASC);
