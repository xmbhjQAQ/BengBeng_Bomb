PRAGMA foreign_keys = ON;

-- A group is created from a signed invitation.  The parent row is initialized
-- lazily when the invitation is opened or the first participant starts.
CREATE TABLE IF NOT EXISTS group_challenges (
  group_id TEXT PRIMARY KEY,
  video_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  result_expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','ended')) DEFAULT 'active',
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_group_challenges_expires ON group_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_group_challenges_result_expires ON group_challenges(result_expires_at);

-- Nicknames are deliberately display-only public input.  No camera data,
-- raw scores, client identity or capability is persisted here.
CREATE TABLE IF NOT EXISTS group_attempts (
  attempt_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started','completed')) DEFAULT 'started',
  attempt_token_hash TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  outcome TEXT CHECK (outcome IN ('held','failed')),
  elapsed_seconds REAL,
  failed_at_seconds REAL,
  result_expires_at INTEGER,
  FOREIGN KEY (group_id) REFERENCES group_challenges(group_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_attempts_results
  ON group_attempts(group_id, state, completed_at DESC, attempt_id ASC);
CREATE INDEX IF NOT EXISTS idx_group_attempts_expires ON group_attempts(result_expires_at);
CREATE INDEX IF NOT EXISTS idx_group_attempts_token_hash ON group_attempts(attempt_token_hash);
