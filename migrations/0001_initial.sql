PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS challenge_sessions (
  challenge_id TEXT PRIMARY KEY,
  video_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  opened_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  result_expires_at INTEGER,
  state TEXT NOT NULL CHECK (state IN ('opened','started','completed')),
  attempt_token_hash TEXT,
  outcome TEXT CHECK (outcome IN ('held','failed')),
  failed_at_seconds REAL,
  duration_seconds REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON challenge_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_result_expires ON challenge_sessions(result_expires_at);

CREATE TABLE IF NOT EXISTS video_stats (
  video_key TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0,
  held INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  cumulative_elapsed_seconds REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS video_fail_buckets (
  video_key TEXT NOT NULL,
  bucket_start_seconds INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (video_key, bucket_start_seconds)
);
