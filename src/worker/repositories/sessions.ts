import type { AggregateStats, Outcome } from '../../shared/contracts';

export interface SessionRow { challenge_id: string; video_key: string; state: 'opened'|'started'|'completed'; expires_at:number; opened_at: number; started_at: number|null; completed_at: number|null; result_expires_at: number|null; outcome: Outcome|null; failed_at_seconds: number|null; duration_seconds: number }
export class SessionRepository {
  constructor(private readonly db: D1Database) {}
  async open(input: { id: string; videoKey: string; createdAt: number; expiresAt: number; now: number; duration: number }) {
    await this.db.prepare(`INSERT INTO challenge_sessions (challenge_id,video_key,created_at,expires_at,opened_at,state,duration_seconds) VALUES (?,?,?,?,?,'opened',?) ON CONFLICT(challenge_id) DO NOTHING`).bind(input.id,input.videoKey,input.createdAt,input.expiresAt,input.now,input.duration).run();
    return this.get(input.id);
  }
  async get(id: string) { return (await this.db.prepare('SELECT challenge_id,video_key,state,expires_at,opened_at,started_at,completed_at,result_expires_at,outcome,failed_at_seconds,duration_seconds FROM challenge_sessions WHERE challenge_id=?').bind(id).first<SessionRow>()) ?? null; }
  async start(id: string, attemptHash: string, now: number) {
    const result = await this.db.prepare(`UPDATE challenge_sessions SET state='started',started_at=?,attempt_token_hash=? WHERE challenge_id=? AND state='opened'`).bind(now,attemptHash,id).run();
    return result.meta.changes === 1;
  }
  async attemptMatches(id: string, hash: string) { return Boolean(await this.db.prepare(`SELECT 1 ok FROM challenge_sessions WHERE challenge_id=? AND state='started' AND attempt_token_hash=?`).bind(id,hash).first()); }
  async complete(input: { id: string; outcome: Outcome; elapsed: number; now: number; resultExpiresAt: number; bucketSize: number }) {
    const row = await this.get(input.id); if (!row) return { status: 'missing' as const }; if (row.state === 'completed') return { status: 'existing' as const, row };
    const changed = await this.db.prepare(`UPDATE challenge_sessions SET state='completed',completed_at=?,result_expires_at=?,outcome=?,failed_at_seconds=? WHERE challenge_id=? AND state='started'`).bind(input.now,input.resultExpiresAt,input.outcome,input.outcome === 'failed' ? input.elapsed : null,input.id).run();
    if (changed.meta.changes !== 1) return { status: 'conflict' as const };
    const aggregate = this.db.prepare(`INSERT INTO video_stats(video_key,total,held,failed,cumulative_elapsed_seconds) VALUES(?,1,?,?,?) ON CONFLICT(video_key) DO UPDATE SET total=total+1,held=held+excluded.held,failed=failed+excluded.failed,cumulative_elapsed_seconds=cumulative_elapsed_seconds+excluded.cumulative_elapsed_seconds`).bind(row.video_key,input.outcome === 'held' ? 1 : 0,input.outcome === 'failed' ? 1 : 0,input.elapsed);
    const statements: D1PreparedStatement[] = [aggregate];
    if (input.outcome === 'failed') { const bucket = Math.floor(input.elapsed / input.bucketSize) * input.bucketSize; statements.push(this.db.prepare(`INSERT INTO video_fail_buckets(video_key,bucket_start_seconds,count) VALUES(?,?,1) ON CONFLICT(video_key,bucket_start_seconds) DO UPDATE SET count=count+1`).bind(row.video_key,bucket)); }
    await this.db.batch(statements); return { status: 'completed' as const, row: await this.get(input.id) };
  }
  async stats(videoKey: string): Promise<AggregateStats> { const row = await this.db.prepare('SELECT total,held,failed,cumulative_elapsed_seconds FROM video_stats WHERE video_key=?').bind(videoKey).first<{total:number;held:number;failed:number;cumulative_elapsed_seconds:number}>(); const buckets = await this.db.prepare('SELECT bucket_start_seconds startSeconds,count FROM video_fail_buckets WHERE video_key=? ORDER BY bucket_start_seconds').bind(videoKey).all<{startSeconds:number;count:number}>(); const total=row?.total??0, failed=row?.failed??0; return { total, held: row?.held??0, failed, failureRate: total ? failed/total : 0, averageElapsedSeconds: total ? (row?.cumulative_elapsed_seconds??0)/total : 0, buckets: buckets.results }; }
  async destroy(id: string) { const result = await this.db.prepare('DELETE FROM challenge_sessions WHERE challenge_id=?').bind(id).run(); return result.meta.changes === 1; }
  async cleanup(now: number) { return this.db.prepare(`DELETE FROM challenge_sessions WHERE (state!='completed' AND expires_at<=?) OR (state='completed' AND result_expires_at<=?)`).bind(now,now).run(); }
}
