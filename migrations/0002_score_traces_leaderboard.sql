PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS challenge_score_traces (
  challenge_id TEXT PRIMARY KEY,
  points_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES challenge_sessions(challenge_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_score_traces_expires ON challenge_score_traces(expires_at);

CREATE TABLE IF NOT EXISTS video_catalog (
  video_key TEXT PRIMARY KEY,
  bvid TEXT NOT NULL,
  cid INTEGER NOT NULL,
  page INTEGER NOT NULL,
  title TEXT NOT NULL,
  cover TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE video_stats ADD COLUMN last_completed_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_video_stats_leaderboard ON video_stats(total DESC, last_completed_at DESC);
