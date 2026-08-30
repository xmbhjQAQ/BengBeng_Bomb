import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';

describe('score trace and leaderboard migration',()=>{
  const sql=readFileSync(join(process.cwd(),'migrations','0002_score_traces_leaderboard.sql'),'utf8');
  it('adds TTL-coupled traces without private face data columns',()=>{
    expect(sql).toMatch(/challenge_score_traces[\s\S]*points_json[\s\S]*expires_at/i);
    expect(sql).toMatch(/ON DELETE CASCADE/i);
    expect(sql).not.toMatch(/nickname|message|landmark|blendshape|media_url/i);
  });
  it('adds only stable video metadata and a permanent aggregate tie-break',()=>{
    expect(sql).toMatch(/video_catalog[\s\S]*bvid[\s\S]*title[\s\S]*cover[\s\S]*duration_seconds/i);
    expect(sql).toMatch(/ALTER TABLE video_stats ADD COLUMN last_completed_at/i);
  });
});
