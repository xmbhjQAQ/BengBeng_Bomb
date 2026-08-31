PRAGMA foreign_keys = ON;

-- A manual destroy must not let a still-valid stateless capability recreate
-- the parent. Blocks are tiny, expire with the public result window, and are
-- removed by the scheduled cleanup.
CREATE TABLE IF NOT EXISTS group_challenge_blocks (
  group_id TEXT PRIMARY KEY,
  blocked_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_challenge_blocks_expires ON group_challenge_blocks(expires_at);
