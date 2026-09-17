import { decodeScoreTrace, decodeVideoMetadata, type AggregateStats, type LeaderboardEntry, type Outcome, type ScorePoint, type VideoMetadata } from '../../shared/contracts';

export interface SessionRow { challenge_id: string; video_key: string; state: 'opened'|'started'|'completed'; expires_at:number; opened_at: number; started_at: number|null; completed_at: number|null; result_expires_at: number|null; outcome: Outcome|null; failed_at_seconds: number|null; duration_seconds: number; revoked_at?: number|null }
interface VideoCatalogRow { bvid: string; cid: number; page: number; title: string; cover: string; duration_seconds: number }
export class SessionRepository {
  constructor(private readonly db: D1Database) {}
  async open(input: { id: string; videoKey: string; createdAt: number; expiresAt: number; now: number; duration: number }) {
    await this.db.prepare(`INSERT INTO challenge_sessions (challenge_id,video_key,created_at,expires_at,opened_at,state,duration_seconds) VALUES (?,?,?,?,?,'opened',?) ON CONFLICT(challenge_id) DO NOTHING`).bind(input.id,input.videoKey,input.createdAt,input.expiresAt,input.now,input.duration).run();
    return this.get(input.id);
  }
  async upsertVideo(videoKey: string, video: VideoMetadata, now: number) {
    await this.db.prepare(`INSERT INTO video_catalog(video_key,bvid,cid,page,title,cover,duration_seconds,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(video_key) DO UPDATE SET bvid=excluded.bvid,cid=excluded.cid,page=excluded.page,title=excluded.title,cover=excluded.cover,duration_seconds=excluded.duration_seconds,updated_at=excluded.updated_at
      WHERE video_catalog.bvid IS NOT excluded.bvid OR video_catalog.cid IS NOT excluded.cid OR video_catalog.page IS NOT excluded.page
        OR video_catalog.title IS NOT excluded.title OR video_catalog.cover IS NOT excluded.cover OR video_catalog.duration_seconds IS NOT excluded.duration_seconds`).bind(videoKey,video.bvid,video.cid,video.page,video.title,video.cover,video.duration,now).run();
  }
  async get(id: string) { return (await this.db.prepare('SELECT challenge_id,video_key,state,expires_at,opened_at,started_at,completed_at,result_expires_at,outcome,failed_at_seconds,duration_seconds,revoked_at FROM challenge_sessions WHERE challenge_id=?').bind(id).first<SessionRow>()) ?? null; }
  async videoMetadata(videoKey: string): Promise<VideoMetadata | null> {
    const row = await this.db.prepare('SELECT bvid,cid,page,title,cover,duration_seconds FROM video_catalog WHERE video_key=?').bind(videoKey).first<VideoCatalogRow>();
    if (!row) return null;
    try {
      return decodeVideoMetadata({
        source: 'bilibili',
        bvid: row.bvid,
        cid: row.cid,
        page: row.page,
        title: row.title,
        description: '',
        cover: row.cover,
        duration: row.duration_seconds,
      });
    } catch {
      return null;
    }
  }
  async start(id: string, attemptHash: string, now: number) {
    const result = await this.db.prepare(`UPDATE challenge_sessions SET state='started',started_at=?,attempt_token_hash=? WHERE challenge_id=? AND state='opened' AND revoked_at IS NULL`).bind(now,attemptHash,id).run();
    return result.meta.changes === 1;
  }
  // The bearer remains the authorization boundary for both the first
  // completion and an idempotent retry.  Do not scope this lookup to
  // `started`: a completed row must still reject a different bearer.
  async attemptMatches(id: string, hash: string) { return Boolean(await this.db.prepare('SELECT 1 ok FROM challenge_sessions WHERE challenge_id=? AND attempt_token_hash=? AND revoked_at IS NULL').bind(id,hash).first()); }
  async complete(input: { id: string; outcome: Outcome; elapsed: number; now: number; resultExpiresAt: number; bucketSize: number; scoreTrace: ScorePoint[] }) {
    const row = await this.get(input.id); if (!row || row.revoked_at != null) return { status: 'missing' as const }; if (row.state === 'completed') return { status: 'existing' as const, row };
    const aggregate = this.db.prepare(`INSERT INTO video_stats(video_key,total,held,failed,cumulative_elapsed_seconds,last_completed_at) SELECT ?,1,?,?,?,? WHERE EXISTS(SELECT 1 FROM challenge_sessions WHERE challenge_id=? AND state='started' AND revoked_at IS NULL) ON CONFLICT(video_key) DO UPDATE SET total=total+1,held=held+excluded.held,failed=failed+excluded.failed,cumulative_elapsed_seconds=cumulative_elapsed_seconds+excluded.cumulative_elapsed_seconds,last_completed_at=excluded.last_completed_at`).bind(row.video_key,input.outcome === 'held' ? 1 : 0,input.outcome === 'failed' ? 1 : 0,input.elapsed,input.now,input.id);
    const trace = this.db.prepare(`INSERT INTO challenge_score_traces(challenge_id,points_json,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM challenge_sessions WHERE challenge_id=? AND state='started' AND revoked_at IS NULL) ON CONFLICT(challenge_id) DO NOTHING`).bind(input.id,JSON.stringify(input.scoreTrace),input.resultExpiresAt,input.id);
    const statements: D1PreparedStatement[] = [aggregate,trace];
    if (input.outcome === 'failed') { const bucket = Math.floor(input.elapsed / input.bucketSize) * input.bucketSize; statements.push(this.db.prepare(`INSERT INTO video_fail_buckets(video_key,bucket_start_seconds,count) SELECT ?,?,1 WHERE EXISTS(SELECT 1 FROM challenge_sessions WHERE challenge_id=? AND state='started' AND revoked_at IS NULL) ON CONFLICT(video_key,bucket_start_seconds) DO UPDATE SET count=count+1`).bind(row.video_key,bucket,input.id)); }
    statements.push(this.db.prepare(`UPDATE challenge_sessions SET state='completed',completed_at=?,result_expires_at=?,outcome=?,failed_at_seconds=? WHERE challenge_id=? AND state='started' AND revoked_at IS NULL`).bind(input.now,input.resultExpiresAt,input.outcome,input.outcome === 'failed' ? input.elapsed : null,input.id));
    const results=await this.db.batch(statements); const changed=results.at(-1)?.meta.changes??0;
    if(changed!==1){const current=await this.get(input.id);return current?.state==='completed'?{status:'existing' as const,row:current}:{status:'conflict' as const};}
    return { status: 'completed' as const, row: await this.get(input.id) };
  }
  async stats(videoKey: string): Promise<AggregateStats> { const row = await this.db.prepare('SELECT total,held,failed,cumulative_elapsed_seconds FROM video_stats WHERE video_key=?').bind(videoKey).first<{total:number;held:number;failed:number;cumulative_elapsed_seconds:number}>(); const buckets = await this.db.prepare('SELECT bucket_start_seconds AS "startSeconds", count FROM video_fail_buckets WHERE video_key=? ORDER BY bucket_start_seconds').bind(videoKey).all<{startSeconds:number;count:number}>(); const total=row?.total??0, failed=row?.failed??0; return { total, held: row?.held??0, failed, failureRate: total ? failed/total : 0, averageElapsedSeconds: total ? (row?.cumulative_elapsed_seconds??0)/total : 0, buckets: buckets.results }; }
  async scoreTrace(id: string, now: number, durationSeconds = Number.POSITIVE_INFINITY): Promise<ScorePoint[]> {
    const row = await this.db.prepare('SELECT points_json,expires_at FROM challenge_score_traces WHERE challenge_id=?').bind(id).first<{points_json:string;expires_at:number}>();
    if (!row) return [];
    if (row.expires_at <= now) {
      await this.db.prepare('DELETE FROM challenge_score_traces WHERE challenge_id=?').bind(id).run();
      return [];
    }
    try { return decodeScoreTrace(JSON.parse(row.points_json), durationSeconds); } catch { return []; }
  }
  async leaderboard(minimumAttempts: number, limit: number): Promise<LeaderboardEntry[]> {
    const query = `SELECT s.video_key,c.bvid,c.cid,c.page,c.title,c.cover,c.duration_seconds,s.total,s.held,s.failed,s.cumulative_elapsed_seconds,s.last_completed_at,
      ROUND(100.0*(0.7*(1.0*s.failed/s.total)+0.3*(1.0-MIN(1.0,MAX(0.0,s.cumulative_elapsed_seconds/(s.total*c.duration_seconds))))),1) AS difficulty_score
      FROM video_stats s JOIN video_catalog c ON c.video_key=s.video_key
      WHERE s.total>=? AND c.duration_seconds>0
      ORDER BY difficulty_score DESC,s.total DESC,s.last_completed_at DESC,s.video_key ASC LIMIT ?`;
    const result = await this.db.prepare(query).bind(minimumAttempts,limit).all<{video_key:string;bvid:string;cid:number;page:number;title:string;cover:string;duration_seconds:number;total:number;held:number;failed:number;cumulative_elapsed_seconds:number;last_completed_at:number;difficulty_score:number}>();
    return result.results.map((row,index) => {
      const failureRate = Math.min(1,Math.max(0,row.failed/row.total));
      const averageElapsedRatio = Math.min(1,Math.max(0,row.cumulative_elapsed_seconds/(row.total*row.duration_seconds)));
      return { rank:index+1, video:{source:'bilibili',bvid:row.bvid,cid:row.cid,page:row.page,title:row.title,description:'',cover:row.cover,duration:row.duration_seconds}, total:row.total,held:row.held,failed:row.failed,failureRate,averageElapsedRatio,difficultyScore:Math.round(Number(row.difficulty_score)*10)/10 };
    });
  }
  async destroy(id: string, now: number) {
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM challenge_score_traces WHERE challenge_id=?').bind(id),
      this.db.prepare(`UPDATE challenge_sessions SET state='completed',started_at=NULL,completed_at=NULL,result_expires_at=NULL,
        attempt_token_hash=NULL,outcome=NULL,failed_at_seconds=NULL,revoked_at=? WHERE challenge_id=? AND revoked_at IS NULL`).bind(now,id),
    ]);
    return (results[1]?.meta.changes ?? 0) === 1;
  }
  async purge(id: string) {
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM challenge_score_traces WHERE challenge_id=?').bind(id),
      this.db.prepare('DELETE FROM challenge_sessions WHERE challenge_id=?').bind(id),
    ]);
    return (results[1]?.meta.changes ?? 0) === 1;
  }
  async cleanup(now: number) {
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM challenge_score_traces WHERE expires_at<=?').bind(now),
      this.db.prepare(`DELETE FROM challenge_sessions WHERE (revoked_at IS NOT NULL AND expires_at<=?) OR (revoked_at IS NULL AND state!='completed' AND expires_at<=?) OR (revoked_at IS NULL AND state='completed' AND result_expires_at<=?)`).bind(now,now,now),
    ]);
    const traceChanges = results[0]?.meta.changes ?? 0;
    const sessionChanges = results[1]?.meta.changes ?? 0;
    return { traceChanges, sessionChanges, changes: traceChanges + sessionChanges };
  }
}
