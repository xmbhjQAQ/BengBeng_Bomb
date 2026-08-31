import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('group challenge migration', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations', '0003_group_challenges.sql'), 'utf8');
  const blockSql = readFileSync(join(process.cwd(), 'migrations', '0004_group_challenge_blocks.sql'), 'utf8');

  it('adds an additive parent/attempt schema with expiry and result indexes', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS group_challenges/i);
    expect(sql).toMatch(/group_id TEXT PRIMARY KEY/i);
    expect(sql).toMatch(/created_at INTEGER NOT NULL/i);
    expect(sql).toMatch(/expires_at INTEGER NOT NULL/i);
    expect(sql).toMatch(/result_expires_at INTEGER NOT NULL/i);
    expect(sql).toMatch(/state TEXT NOT NULL CHECK \(state IN \('active','ended'\)\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_group_challenges_result_expires/i);
    expect(blockSql).toMatch(/CREATE TABLE IF NOT EXISTS group_challenge_blocks/i);
    expect(blockSql).toMatch(/idx_group_challenge_blocks_expires/i);
  });

  it('stores only the bounded participant projection and cascades group cleanup', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS group_attempts/i);
    expect(sql).toMatch(/nickname TEXT NOT NULL/i);
    expect(sql).toMatch(/attempt_token_hash TEXT NOT NULL/i);
    expect(sql).toMatch(/outcome TEXT CHECK \(outcome IN \('held','failed'\)\)/i);
    expect(sql).toMatch(/failed_at_seconds REAL/i);
    expect(sql).toMatch(/FOREIGN KEY \(group_id\) REFERENCES group_challenges\(group_id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/idx_group_attempts_results/i);
    expect(sql).toMatch(/idx_group_attempts_token_hash/i);
    const schema = sql.replace(/--[^\r\n]*/g, '');
    expect(schema).not.toMatch(/camera|landmark|blendshape|raw_score|ip_address|device_fingerprint/i);
  });
});
