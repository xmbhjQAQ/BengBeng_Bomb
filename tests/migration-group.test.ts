import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('group challenge migration', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations', '0003_group_challenges.sql'), 'utf8');

  it('adds parent and independent attempt tables with expiry and result indexes', () => {
    expect(sql).toMatch(/group_challenges[\s\S]*group_id[\s\S]*video_key[\s\S]*result_expires_at/i);
    expect(sql).toMatch(/group_attempts[\s\S]*nickname[\s\S]*attempt_token_hash[\s\S]*outcome/i);
    expect(sql).toMatch(/idx_group_attempts_results/i);
    expect(sql).toMatch(/idx_group_attempts_expires/i);
    expect(sql).toMatch(/ON DELETE CASCADE/i);
  });

  it('does not add camera or temporary media columns', () => {
    expect(sql.replace(/--[^\r\n]*/g, '')).not.toMatch(/landmark|blendshape|camera|media_url|direct_url|cookie/i);
  });
});
