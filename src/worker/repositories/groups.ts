import { CLIENT_CONFIG } from '../../shared/config/client';
import { GROUP_RESULTS_MAX_LIMIT, type AggregateStats, type GroupParticipantResult, type GroupResultSummary, type GroupResultsPage, type Outcome, type ScorePoint, type VideoMetadata } from '../../shared/contracts';
import { base64UrlEncode, canonicalJson, decodeText } from '../capabilities/crypto';
import { SessionRepository } from './sessions';

export interface GroupRow {
  group_id: string;
  video_key: string;
  created_at: number;
  expires_at: number;
  result_expires_at: number;
  state: 'active' | 'ended';
  ended_at: number | null;
}

export interface GroupAttemptRow {
  attempt_id: string;
  group_id: string;
  nickname: string;
  state: 'started' | 'completed';
  attempt_token_hash: string;
  started_at: number;
  completed_at: number | null;
  outcome: Outcome | null;
  elapsed_seconds: number | null;
  failed_at_seconds: number | null;
  result_expires_at: number | null;
}

interface GroupResultRow {
  attempt_id: string;
  nickname: string;
  outcome: Outcome;
  elapsed_seconds: number;
  failed_at_seconds: number | null;
  completed_at: number;
}

export interface GroupResultQuery {
  rows: GroupParticipantResult[];
  nextCursor?: string;
  summary: GroupResultSummary;
}

export type GroupStartStatus = 'started' | 'missing' | 'ended' | 'expired' | 'conflict';

/**
 * D1 access for group challenges.  The repository keeps the group-specific
 * lifecycle separate from SessionRepository while reusing its stable video
 * catalog and anonymous aggregate projections.
 */
export class GroupRepository {
  private readonly sessions: SessionRepository;

  constructor(private readonly db: D1Database) {
    this.sessions = new SessionRepository(db);
  }

  async get(groupId: string): Promise<GroupRow | null> {
    return (await this.db.prepare(`SELECT group_id,video_key,created_at,expires_at,result_expires_at,state,ended_at
      FROM group_challenges WHERE group_id=?`).bind(groupId).first<GroupRow>()) ?? null;
  }

  getGroup(groupId: string) {
    return this.get(groupId);
  }

  /** A destroy marker prevents a valid stateless link from recreating a group. */
  async isBlocked(groupId: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
    const row = await this.db.prepare('SELECT expires_at FROM group_challenge_blocks WHERE group_id=?').bind(groupId).first<{ expires_at: number }>();
    if (!row) return false;
    if (Number(row.expires_at) <= now) {
      await this.db.prepare('DELETE FROM group_challenge_blocks WHERE group_id=?').bind(groupId).run();
      return false;
    }
    return true;
  }

  /** Create the parent only once.  Public opens do not create participant rows. */
  async ensure(input: { groupId: string; videoKey: string; createdAt: number; expiresAt: number; resultExpiresAt: number; now?: number }): Promise<GroupRow | null> {
    const checkNow = input.now ?? Math.floor(Date.now() / 1000);
    if (await this.isBlocked(input.groupId, checkNow)) return null;
    const existing = await this.get(input.groupId);
    if (existing) return existing;
    // Never recreate a cleaned-up stateless group after its participation
    // window. Existing parents remain readable for their result-retention
    // window and are returned above.
    if (input.now !== undefined && input.expiresAt <= checkNow) return null;
    await this.db.prepare(`INSERT INTO group_challenges(group_id,video_key,created_at,expires_at,result_expires_at,state)
      SELECT ?,?,?,?,?,'active'
      WHERE NOT EXISTS (SELECT 1 FROM group_challenge_blocks WHERE group_id=? AND expires_at>?)
      ON CONFLICT(group_id) DO NOTHING`)
      .bind(input.groupId, input.videoKey, input.createdAt, input.expiresAt, input.resultExpiresAt, input.groupId, checkNow).run();
    return this.get(input.groupId);
  }

  open(input: { groupId: string; videoKey: string; createdAt: number; expiresAt: number; resultExpiresAt: number; now?: number }) {
    return this.ensure(input);
  }

  async getAttempt(attemptId: string): Promise<GroupAttemptRow | null> {
    return (await this.db.prepare(`SELECT attempt_id,group_id,nickname,state,attempt_token_hash,started_at,completed_at,
      outcome,elapsed_seconds,failed_at_seconds,result_expires_at FROM group_attempts WHERE attempt_id=?`)
      .bind(attemptId).first<GroupAttemptRow>()) ?? null;
  }

  async attemptMatches(attemptId: string, groupId: string, hash: string): Promise<boolean> {
    const row = await this.getAttempt(attemptId);
    return Boolean(row && row.group_id === groupId && row.attempt_token_hash === hash);
  }

  async findAttemptByHash(groupId: string, hash: string): Promise<GroupAttemptRow | null> {
    return (await this.db.prepare(`SELECT attempt_id,group_id,nickname,state,attempt_token_hash,started_at,completed_at,
      outcome,elapsed_seconds,failed_at_seconds,result_expires_at FROM group_attempts WHERE group_id=? AND attempt_token_hash=?`)
      .bind(groupId, hash).first<GroupAttemptRow>()) ?? null;
  }

  async start(input: { groupId: string; attemptId: string; nickname: string; attemptHash: string; now: number }): Promise<{ status: GroupStartStatus; row?: GroupAttemptRow }> {
    const result = await this.db.prepare(`INSERT INTO group_attempts
      (attempt_id,group_id,nickname,state,attempt_token_hash,started_at)
      SELECT ?,?,?, 'started',?,? FROM group_challenges
      WHERE group_id=? AND state='active' AND expires_at>?`)
      .bind(input.attemptId, input.groupId, input.nickname, input.attemptHash, input.now, input.groupId, input.now).run();
    if (result.meta.changes === 1) {
      const row = await this.getAttempt(input.attemptId);
      return row ? { status: 'started', row } : { status: 'conflict' };
    }
    const group = await this.get(input.groupId);
    if (!group) return { status: 'missing' };
    if (group.state === 'ended') return { status: 'ended', row: undefined };
    if (group.expires_at <= input.now) return { status: 'expired', row: undefined };
    return { status: 'conflict' };
  }

  /**
   * Complete an attempt and increment the shared video aggregates in one D1
   * batch.  The aggregate statements are guarded by the started-state check,
   * so a retried/concurrent completion cannot count the same attempt twice.
   */
  async complete(input: {
    attemptId: string;
    groupId: string;
    outcome: Outcome;
    elapsed: number;
    now: number;
    bucketSize: number;
    scoreTrace?: ScorePoint[];
  }): Promise<{ status: 'missing' | 'existing' | 'completed' | 'conflict'; row?: GroupAttemptRow }> {
    const row = await this.getAttempt(input.attemptId);
    if (!row || row.group_id !== input.groupId) return { status: 'missing' };
    if (row.state === 'completed') return { status: 'existing', row };
    const aggregate = this.db.prepare(`INSERT INTO video_stats(video_key,total,held,failed,cumulative_elapsed_seconds,last_completed_at)
      SELECT g.video_key,1,?,?,?,? FROM group_challenges g
      WHERE g.group_id=? AND EXISTS(SELECT 1 FROM group_attempts a WHERE a.attempt_id=? AND a.group_id=? AND a.state='started')
      ON CONFLICT(video_key) DO UPDATE SET total=total+1,held=held+excluded.held,failed=failed+excluded.failed,
        cumulative_elapsed_seconds=cumulative_elapsed_seconds+excluded.cumulative_elapsed_seconds,last_completed_at=excluded.last_completed_at`)
      .bind(input.outcome === 'held' ? 1 : 0, input.outcome === 'failed' ? 1 : 0, input.elapsed, input.now, input.groupId, input.attemptId, input.groupId);
    const statements: D1PreparedStatement[] = [aggregate];
    if (input.outcome === 'failed') {
      const bucket = Math.floor(input.elapsed / input.bucketSize) * input.bucketSize;
      statements.push(this.db.prepare(`INSERT INTO video_fail_buckets(video_key,bucket_start_seconds,count)
        SELECT g.video_key,?,1 FROM group_challenges g
        WHERE g.group_id=? AND EXISTS(SELECT 1 FROM group_attempts a WHERE a.attempt_id=? AND a.group_id=? AND a.state='started')
        ON CONFLICT(video_key,bucket_start_seconds) DO UPDATE SET count=count+1`)
        .bind(bucket, input.groupId, input.attemptId, input.groupId));
    }
    statements.push(this.db.prepare(`UPDATE group_attempts SET state='completed',completed_at=?,outcome=?,elapsed_seconds=?,failed_at_seconds=?,
      result_expires_at=(SELECT result_expires_at FROM group_challenges WHERE group_id=?)
      WHERE attempt_id=? AND group_id=? AND state='started'`)
      .bind(input.now, input.outcome, input.elapsed, input.outcome === 'failed' ? input.elapsed : null, input.groupId, input.attemptId, input.groupId));
    const results = await this.db.batch(statements);
    const changed = results.at(-1)?.meta.changes ?? 0;
    if (changed !== 1) {
      const current = await this.getAttempt(input.attemptId);
      return current?.state === 'completed' ? { status: 'existing', row: current } : { status: 'conflict' };
    }
    return { status: 'completed', row: await this.getAttempt(input.attemptId) ?? undefined };
  }

  async stats(videoKey: string): Promise<AggregateStats> {
    return this.sessions.stats(videoKey);
  }

  async videoMetadata(videoKey: string): Promise<VideoMetadata | null> {
    return this.sessions.videoMetadata(videoKey);
  }

  async upsertVideo(videoKey: string, video: VideoMetadata, now: number) {
    return this.sessions.upsertVideo(videoKey, video, now);
  }

  async resultQuery(groupId: string, now: number, limit: number, cursor?: string, summary?: GroupResultSummary): Promise<GroupResultQuery> {
    const safeLimit = Math.max(1, Math.min(GROUP_RESULTS_MAX_LIMIT, Math.floor(limit)));
    const decoded = cursor ? decodeCursor(cursor) : undefined;
    const cursorClause = decoded ? ` AND (completed_at<? OR (completed_at=? AND attempt_id>?))` : '';
    const args: unknown[] = [groupId, now];
    if (decoded) args.push(decoded.completedAt, decoded.completedAt, decoded.attemptId);
    args.push(safeLimit + 1);
    const result = await this.db.prepare(`SELECT attempt_id,nickname,outcome,elapsed_seconds,failed_at_seconds,completed_at
      FROM group_attempts WHERE group_id=? AND state='completed' AND result_expires_at>?${cursorClause}
      ORDER BY completed_at DESC,attempt_id ASC LIMIT ?`).bind(...args).all<GroupResultRow>();
    const hasMore = result.results.length > safeLimit;
    const pageRows = hasMore ? result.results.slice(0, safeLimit) : result.results;
    const last = pageRows.at(-1);
    return {
      rows: pageRows.map(toParticipantResult),
      ...(hasMore && last ? { nextCursor: encodeCursor({ completedAt: last.completed_at, attemptId: last.attempt_id }) } : {}),
      summary: summary ?? await this.resultSummary(groupId, now),
    };
  }

  listResults(groupId: string, now: number, limit: number, cursor?: string) {
    return this.resultQuery(groupId, now, limit, cursor);
  }

  async resultSummary(groupId: string, now: number): Promise<GroupResultSummary> {
    const row = await this.db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN outcome='held' THEN 1 ELSE 0 END),0) AS held,
      COALESCE(SUM(CASE WHEN outcome='failed' THEN 1 ELSE 0 END),0) AS failed
      FROM group_attempts WHERE group_id=? AND state='completed' AND result_expires_at>?`)
      .bind(groupId, now).first<{ total: number; held: number; failed: number }>();
    return { total: Number(row?.total ?? 0), held: Number(row?.held ?? 0), failed: Number(row?.failed ?? 0) };
  }

  async groupStats(groupId: string, now: number): Promise<AggregateStats> {
    const row = await this.db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN outcome='held' THEN 1 ELSE 0 END),0) AS held,
      COALESCE(SUM(CASE WHEN outcome='failed' THEN 1 ELSE 0 END),0) AS failed,
      COALESCE(SUM(elapsed_seconds),0) AS cumulative_elapsed_seconds
      FROM group_attempts WHERE group_id=? AND state='completed' AND result_expires_at>?`)
      .bind(groupId, now).first<{ total: number; held: number; failed: number; cumulative_elapsed_seconds: number }>();
    const bucketSize = CLIENT_CONFIG.heatmapBucketSeconds;
    // Keep the heatmap scoped to this group.  video_fail_buckets is a
    // permanent, video-wide aggregate and would leak unrelated challenges
    // into a group's result page, so derive the short-lived group projection
    // from the retained failed attempts instead.
    const buckets = await this.db.prepare(`SELECT CAST(failed_at_seconds / ? AS INTEGER) * ? AS "startSeconds", COUNT(*) AS count
      FROM group_attempts
      WHERE group_id=? AND state='completed' AND outcome='failed'
        AND failed_at_seconds IS NOT NULL AND result_expires_at>?
      GROUP BY CAST(failed_at_seconds / ? AS INTEGER)
      ORDER BY "startSeconds"`)
      .bind(bucketSize, bucketSize, groupId, now, bucketSize)
      .all<{ startSeconds: number; count: number }>();
    const total = Number(row?.total ?? 0);
    const failed = Number(row?.failed ?? 0);
    return {
      total,
      held: Number(row?.held ?? 0),
      failed,
      failureRate: total ? failed / total : 0,
      averageElapsedSeconds: total ? Number(row?.cumulative_elapsed_seconds ?? 0) / total : 0,
      buckets: buckets.results.map((bucket) => ({ startSeconds: Number(bucket.startSeconds), count: Number(bucket.count) })),
    };
  }

  async end(groupId: string, now: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE group_challenges SET state='ended',ended_at=? WHERE group_id=? AND state='active'`)
      .bind(now, groupId).run();
    return result.meta.changes === 1;
  }

  async destroy(groupId: string, blockedAt?: number, blockExpiresAt?: number): Promise<boolean> {
    if (blockedAt !== undefined) {
      await this.db.prepare(`INSERT INTO group_challenge_blocks(group_id,blocked_at,expires_at)
        VALUES(?,?,?) ON CONFLICT(group_id) DO UPDATE SET blocked_at=excluded.blocked_at,expires_at=excluded.expires_at`)
        .bind(groupId, blockedAt, blockExpiresAt ?? blockedAt).run();
    }
    const result = await this.db.prepare('DELETE FROM group_challenges WHERE group_id=?').bind(groupId).run();
    return result.meta.changes === 1;
  }

  async cleanup(now: number): Promise<{ parentChanges: number; attemptChanges: number; blockChanges: number; changes: number }> {
    // Parent deletion cascades attempts, and preserves video-level aggregates.
    // Count the dependent rows before deleting the parent so the scheduled
    // log can expose cleanup backlog without logging any participant fields.
    const attemptCount = await this.db.prepare(`SELECT COUNT(*) AS count
      FROM group_attempts
      WHERE group_id IN (SELECT group_id FROM group_challenges WHERE result_expires_at<=?)`)
      .bind(now).first<{ count: number }>();
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM group_challenges WHERE result_expires_at<=?').bind(now),
      this.db.prepare('DELETE FROM group_challenge_blocks WHERE expires_at<=?').bind(now),
    ]);
    const parentChanges = results[0]?.meta.changes ?? 0;
    const blockChanges = results[1]?.meta.changes ?? 0;
    const attemptChanges = Number(attemptCount?.count ?? 0);
    return { parentChanges, attemptChanges, blockChanges, changes: parentChanges + attemptChanges + blockChanges };
  }

  /** Build the public response projection without leaking internal attempt IDs. */
  async resultsPage(input: {
    group: GroupRow;
    video: VideoMetadata;
    now: number;
    limit: number;
    cursor?: string;
    summary?: GroupResultSummary;
  }): Promise<GroupResultsPage> {
    const page = await this.resultQuery(input.group.group_id, input.now, input.limit, input.cursor, input.summary);
    // Keep the result window readable after the participation window closes.
    // The parent row remains active until retention cleanup, but its public
    // state must tell readers that no new attempts can start.
    const state = input.group.state === 'active' && input.group.expires_at <= input.now
      ? 'expired' as const
      : input.group.state;
    return {
      state,
      video: input.video,
      createdAt: input.group.created_at,
      expiresAt: input.group.expires_at,
      resultExpiresAt: input.group.result_expires_at,
      summary: page.summary,
      results: page.rows,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }
}

function toParticipantResult(row: GroupResultRow): GroupParticipantResult {
  return {
    nickname: row.nickname,
    outcome: row.outcome,
    elapsedSeconds: Number(row.elapsed_seconds),
    ...(row.outcome === 'failed' && row.failed_at_seconds !== null ? { failedAtSeconds: Number(row.failed_at_seconds) } : {}),
    completedAt: Number(row.completed_at),
  };
}

interface CursorValue { completedAt: number; attemptId: string }
function encodeCursor(value: CursorValue): string {
  return base64UrlEncode(canonicalJson(value));
}
function decodeCursor(value: string): CursorValue {
  if (value.length > 240) throw new GroupRepositoryError('INVALID_GROUP_CURSOR', '结果分页标识不正确');
  try {
    const parsed = JSON.parse(decodeText(value)) as Record<string, unknown>;
    if (!Number.isFinite(Number(parsed.completedAt)) || typeof parsed.attemptId !== 'string' || !parsed.attemptId) throw new Error('invalid');
    return { completedAt: Number(parsed.completedAt), attemptId: parsed.attemptId };
  } catch {
    // Keep cursor failures in the ordinary API envelope instead of returning
    // an unbounded or silently reset page.
    throw new GroupRepositoryError('INVALID_GROUP_CURSOR', '结果分页标识不正确');
  }
}

export class GroupRepositoryError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
