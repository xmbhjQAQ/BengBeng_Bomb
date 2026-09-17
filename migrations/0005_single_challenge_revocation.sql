PRAGMA foreign_keys = ON;

-- Keep a minimal tombstone until the signed invitation expires. This prevents
-- a deleted one-use challenge from being recreated without retaining its
-- private result, attempt bearer, failure time, or score trace.
ALTER TABLE challenge_sessions ADD COLUMN revoked_at INTEGER;
