import { describe, expect, it } from 'vitest';
import { GroupRepository, type GroupAttemptRow, type GroupRow } from '../src/worker/repositories/groups';

interface StatsRow {
  total: number;
  held: number;
  failed: number;
  cumulative_elapsed_seconds: number;
}

class FakeStatement {
  args: unknown[] = [];

  constructor(readonly db: FakeD1, readonly query: string) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>() {
    return this.db.first(this) as T | null;
  }

  async all<T>() {
    return { results: this.db.all(this) as T[] };
  }

  async run() {
    return { meta: { changes: this.db.run(this) } };
  }
}

class FakeD1 {
  groups = new Map<string, GroupRow>();
  blocks = new Map<string, { blocked_at: number; expires_at: number }>();
  attempts = new Map<string, GroupAttemptRow>();
  stats = new Map<string, StatsRow>();
  buckets = new Map<string, Map<number, number>>();
  catalog = new Map<string, { bvid: string; cid: number; page: number; title: string; cover: string; duration_seconds: number }>();

  prepare(query: string) {
    return new FakeStatement(this, query);
  }

  first(statement: FakeStatement): unknown {
    const query = statement.query;
    if (query.includes('FROM group_challenge_blocks')) {
      const row = this.blocks.get(String(statement.args[0]));
      return row ? { expires_at: row.expires_at } : null;
    }
    if (query.includes('FROM group_challenges')) return this.groups.get(String(statement.args[0])) ?? null;
    if (query.includes('FROM group_attempts WHERE attempt_id')) return this.attempts.get(String(statement.args[0])) ?? null;
    if (query.includes('FROM video_stats')) return this.stats.get(String(statement.args[0])) ?? null;
    if (query.includes('FROM video_catalog')) return this.catalog.get(String(statement.args[0])) ?? null;
    if (query.includes('COUNT(*)') && query.includes('FROM group_attempts')) {
      const [groupId, now] = statement.args;
      const rows = [...this.attempts.values()].filter((row) => row.group_id === String(groupId) && row.state === 'completed' && (row.result_expires_at ?? 0) > Number(now));
      return {
        total: rows.length,
        held: rows.filter((row) => row.outcome === 'held').length,
        failed: rows.filter((row) => row.outcome === 'failed').length,
        ...(query.includes('cumulative_elapsed_seconds') ? { cumulative_elapsed_seconds: rows.reduce((sum, row) => sum + Number(row.elapsed_seconds ?? 0), 0) } : {}),
      };
    }
    return null;
  }

  all(statement: FakeStatement): unknown[] {
    if (statement.query.includes('GROUP BY CAST(failed_at_seconds / ? AS INTEGER)')) {
      const bucketSize = Number(statement.args[0]);
      const groupId = String(statement.args[2]);
      const now = Number(statement.args[3]);
      const buckets = new Map<number, number>();
      for (const row of this.attempts.values()) {
        if (row.group_id !== groupId || row.state !== 'completed' || row.outcome !== 'failed' || row.failed_at_seconds === null || Number(row.result_expires_at ?? 0) <= now) continue;
        const bucket = Math.floor(Number(row.failed_at_seconds) / bucketSize) * bucketSize;
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      }
      return [...buckets.entries()].sort(([left], [right]) => left - right).map(([startSeconds, count]) => ({ startSeconds, count }));
    }
    if (statement.query.includes('FROM video_fail_buckets')) {
      const rows = [...(this.buckets.get(String(statement.args[0]))?.entries() ?? [])]
        .sort(([left], [right]) => left - right)
        .map(([startSeconds, count]) => ({ startSeconds, count }));
      return rows;
    }
    if (statement.query.includes('FROM group_attempts WHERE group_id')) {
      const groupId = String(statement.args[0]);
      const now = Number(statement.args[1]);
      let rows = [...this.attempts.values()]
        .filter((row) => row.group_id === groupId && row.state === 'completed' && (row.result_expires_at ?? 0) > now)
        .sort((left, right) => Number(right.completed_at) - Number(left.completed_at) || left.attempt_id.localeCompare(right.attempt_id));

      // resultQuery adds (completed_at<? OR (completed_at=? AND attempt_id>?))
      // only when a cursor is supplied.
      if (statement.args.length >= 5) {
        const completedAt = Number(statement.args[2]);
        const attemptId = String(statement.args[4]);
        rows = rows.filter((row) => Number(row.completed_at) < completedAt || (Number(row.completed_at) === completedAt && row.attempt_id > attemptId));
      }
      const limit = Number(statement.args.at(-1));
      return rows.slice(0, limit).map((row) => ({
        attempt_id: row.attempt_id,
        nickname: row.nickname,
        outcome: row.outcome,
        elapsed_seconds: row.elapsed_seconds,
        failed_at_seconds: row.failed_at_seconds,
        completed_at: row.completed_at,
      }));
    }
    return [];
  }

  run(statement: FakeStatement): number {
    const query = statement.query;
    if (query.startsWith('INSERT INTO group_challenges')) {
      const [groupId, videoKey, createdAt, expiresAt, resultExpiresAt] = statement.args.map(String);
      if (this.groups.has(groupId!)) return 0;
      this.groups.set(groupId!, {
        group_id: groupId!,
        video_key: videoKey!,
        created_at: Number(createdAt),
        expires_at: Number(expiresAt),
        result_expires_at: Number(resultExpiresAt),
        state: 'active',
        ended_at: null,
      });
      return 1;
    }
    if (query.startsWith('INSERT INTO group_attempts')) {
      const [attemptId, groupId, nickname, hash, startedAt] = statement.args;
      const group = this.groups.get(String(groupId));
      if (!group || group.state !== 'active' || group.expires_at <= Number(statement.args[6])) return 0;
      if (this.attempts.has(String(attemptId))) return 0;
      this.attempts.set(String(attemptId), {
        attempt_id: String(attemptId),
        group_id: String(groupId),
        nickname: String(nickname),
        state: 'started',
        attempt_token_hash: String(hash),
        started_at: Number(startedAt),
        completed_at: null,
        outcome: null,
        elapsed_seconds: null,
        failed_at_seconds: null,
        result_expires_at: null,
      });
      return 1;
    }
    if (query.startsWith('UPDATE group_attempts SET state')) {
      const [completedAt, outcome, elapsed, failedAt, groupId, attemptId] = statement.args;
      const row = this.attempts.get(String(attemptId));
      if (!row || row.group_id !== String(groupId) || row.state !== 'started') return 0;
      const group = this.groups.get(String(groupId));
      this.attempts.set(row.attempt_id, {
        ...row,
        state: 'completed',
        completed_at: Number(completedAt),
        outcome: outcome as GroupAttemptRow['outcome'],
        elapsed_seconds: Number(elapsed),
        failed_at_seconds: failedAt === null ? null : Number(failedAt),
        result_expires_at: group?.result_expires_at ?? null,
      });
      return 1;
    }
    if (query.startsWith('UPDATE group_challenges SET state')) {
      const [endedAt, groupId] = statement.args;
      const row = this.groups.get(String(groupId));
      if (!row || row.state !== 'active') return 0;
      this.groups.set(row.group_id, { ...row, state: 'ended', ended_at: Number(endedAt) });
      return 1;
    }
    if (query.startsWith('INSERT INTO group_challenge_blocks')) {
      const [groupId, blockedAt, expiresAt] = statement.args;
      this.blocks.set(String(groupId), { blocked_at: Number(blockedAt), expires_at: Number(expiresAt) });
      return 1;
    }
    if (query.startsWith('DELETE FROM group_challenge_blocks')) {
      return this.blocks.delete(String(statement.args[0])) ? 1 : 0;
    }
    if (query.startsWith('DELETE FROM group_challenges')) {
      if (query.includes('result_expires_at<=?')) {
        const now = Number(statement.args[0]);
        const expired = [...this.groups.values()].filter((group) => group.result_expires_at <= now);
        for (const group of expired) {
          this.groups.delete(group.group_id);
          for (const [attemptId, attempt] of this.attempts) if (attempt.group_id === group.group_id) this.attempts.delete(attemptId);
        }
        return expired.length;
      }
      const groupId = String(statement.args[0]);
      const row = this.groups.get(groupId);
      if (!row) return 0;
      this.groups.delete(groupId);
      for (const [attemptId, attempt] of this.attempts) if (attempt.group_id === groupId) this.attempts.delete(attemptId);
      return 1;
    }
    return 0;
  }

  async batch(statements: FakeStatement[]) {
    return statements.map((statement) => {
      let changes = 0;
      if (statement.query.includes('INSERT INTO video_stats')) {
        const [held, failed, elapsed, , groupId, attemptId] = statement.args;
        const attempt = this.attempts.get(String(attemptId));
        const group = this.groups.get(String(groupId));
        if (attempt?.state === 'started' && group) {
          const current = this.stats.get(group.video_key) ?? { total: 0, held: 0, failed: 0, cumulative_elapsed_seconds: 0 };
          this.stats.set(group.video_key, {
            total: current.total + 1,
            held: current.held + Number(held),
            failed: current.failed + Number(failed),
            cumulative_elapsed_seconds: current.cumulative_elapsed_seconds + Number(elapsed),
          });
          changes = 1;
        }
      } else if (statement.query.includes('INSERT INTO video_fail_buckets')) {
        const [bucket, groupId, attemptId] = statement.args;
        const attempt = this.attempts.get(String(attemptId));
        const group = this.groups.get(String(groupId));
        if (attempt?.state === 'started' && group) {
          const values = this.buckets.get(group.video_key) ?? new Map<number, number>();
          values.set(Number(bucket), (values.get(Number(bucket)) ?? 0) + 1);
          this.buckets.set(group.video_key, values);
          changes = 1;
        }
      } else if (statement.query.startsWith('UPDATE group_attempts SET state')) {
        changes = this.run(statement);
      } else if (statement.query.startsWith('DELETE FROM group_challenges') || statement.query.startsWith('DELETE FROM group_challenge_blocks')) {
        changes = this.run(statement);
      }
      return { meta: { changes } };
    });
  }
}

const groupInput = {
  groupId: 'group-1',
  videoKey: 'BV-test:1',
  createdAt: 100,
  expiresAt: 200,
  resultExpiresAt: 300,
};

async function readyRepository() {
  const db = new FakeD1();
  const repository = new GroupRepository(db as unknown as D1Database);
  await repository.ensure(groupInput);
  return { db, repository };
}

function startedAttempt(id: string, nickname: string, now = 120): GroupAttemptRow {
  return {
    attempt_id: id,
    group_id: groupInput.groupId,
    nickname,
    state: 'started',
    attempt_token_hash: `hash-${id}`,
    started_at: now,
    completed_at: null,
    outcome: null,
    elapsed_seconds: null,
    failed_at_seconds: null,
    result_expires_at: null,
  };
}

describe('GroupRepository', () => {
  it('allows independent concurrent starts and duplicate display names', async () => {
    const { db, repository } = await readyRepository();
    const [first, second] = await Promise.all([
      repository.start({ groupId: groupInput.groupId, attemptId: 'attempt-a', nickname: '小明', attemptHash: 'hash-a', now: 120 }),
      repository.start({ groupId: groupInput.groupId, attemptId: 'attempt-b', nickname: '小明', attemptHash: 'hash-b', now: 120 }),
    ]);

    expect(first.status).toBe('started');
    expect(second.status).toBe('started');
    expect(db.attempts.size).toBe(2);
    expect([...db.attempts.values()].map((row) => row.nickname)).toEqual(['小明', '小明']);
  });

  it('increments aggregates once when a completion is retried', async () => {
    const { db, repository } = await readyRepository();
    db.attempts.set('attempt-a', startedAttempt('attempt-a', '小明'));

    const first = await repository.complete({ attemptId: 'attempt-a', groupId: groupInput.groupId, outcome: 'failed', elapsed: 12, now: 150, bucketSize: 10 });
    const repeated = await repository.complete({ attemptId: 'attempt-a', groupId: groupInput.groupId, outcome: 'failed', elapsed: 12, now: 151, bucketSize: 10 });

    expect(first.status).toBe('completed');
    expect(repeated.status).toBe('existing');
    expect(db.stats.get(groupInput.videoKey)).toEqual({ total: 1, held: 0, failed: 1, cumulative_elapsed_seconds: 12 });
    expect(db.buckets.get(groupInput.videoKey)?.get(10)).toBe(1);
    expect(db.attempts.get('attempt-a')?.completed_at).toBe(150);
  });

  it('returns failure-time buckets for the current group while excluding expired attempts', async () => {
    const { db, repository } = await readyRepository();
    db.attempts.set('attempt-a', {
      ...startedAttempt('attempt-a', '甲'),
      state: 'completed', completed_at: 150, outcome: 'failed', elapsed_seconds: 2.855623,
      failed_at_seconds: 2.855623, result_expires_at: 300,
    });
    db.attempts.set('attempt-b', {
      ...startedAttempt('attempt-b', '乙'),
      state: 'completed', completed_at: 151, outcome: 'failed', elapsed_seconds: 9.424377,
      failed_at_seconds: 9.424377, result_expires_at: 300,
    });
    db.attempts.set('attempt-expired', {
      ...startedAttempt('attempt-expired', '过期'),
      state: 'completed', completed_at: 100, outcome: 'failed', elapsed_seconds: 5,
      failed_at_seconds: 5, result_expires_at: 200,
    });

    await expect(repository.groupStats(groupInput.groupId, 200)).resolves.toEqual({
      total: 2,
      held: 0,
      failed: 2,
      failureRate: 1,
      averageElapsedSeconds: 6.14,
      buckets: [{ startSeconds: 0, count: 2 }],
    });
  });

  it('returns deterministic pages and rejects malformed cursors', async () => {
    const { db, repository } = await readyRepository();
    for (const [id, nickname, completedAt] of [['a', '甲', 150], ['b', '乙', 150], ['c', '丙', 149]] as const) {
      db.attempts.set(id, {
        ...startedAttempt(id, nickname),
        state: 'completed',
        completed_at: completedAt,
        outcome: 'failed',
        elapsed_seconds: 10,
        failed_at_seconds: 10,
        result_expires_at: 300,
      });
    }
    const first = await repository.resultQuery(groupInput.groupId, 200, 2);
    expect(first.rows.map((row) => row.nickname)).toEqual(['甲', '乙']);
    expect(first.nextCursor).toBeTruthy();
    const second = await repository.resultQuery(groupInput.groupId, 200, 2, first.nextCursor);
    expect(second.rows.map((row) => row.nickname)).toEqual(['丙']);
    expect(second.nextCursor).toBeUndefined();
    await expect(repository.resultQuery(groupInput.groupId, 200, 2, 'not-a-cursor')).rejects.toMatchObject({ code: 'INVALID_GROUP_CURSOR' });
  });

  it('marks a retained result page expired after the participation window', async () => {
    const { repository } = await readyRepository();
    const group = await repository.get(groupInput.groupId);
    expect(group).not.toBeNull();
    const result = await repository.resultsPage({
      group: group!,
      video: {
        source: 'bilibili',
        bvid: 'BV1B7411m7LV',
        cid: 1,
        page: 1,
        title: '群组视频',
        description: '',
        cover: '',
        duration: 60,
      },
      now: groupInput.expiresAt,
      limit: 20,
    });
    expect(result.state).toBe('expired');
  });

  it('blocks starts after expiry or explicit end and cascades cleanup', async () => {
    const { db, repository } = await readyRepository();
    const expired = await repository.start({ groupId: groupInput.groupId, attemptId: 'expired', nickname: '过期', attemptHash: 'hash', now: 200 });
    expect(expired.status).toBe('expired');
    expect(await repository.end(groupInput.groupId, 160)).toBe(true);
    const ended = await repository.start({ groupId: groupInput.groupId, attemptId: 'ended', nickname: '结束', attemptHash: 'hash', now: 160 });
    expect(ended.status).toBe('ended');

    db.attempts.set('old', { ...startedAttempt('old', '旧'), result_expires_at: 300 });
    expect(await repository.cleanup(300)).toEqual({ changes: 1 });
    expect(db.groups.has(groupInput.groupId)).toBe(false);
    expect(db.attempts.has('old')).toBe(false);
    expect(db.stats.has(groupInput.videoKey)).toBe(false);
  });

  it('blocks a manually destroyed group from being recreated by a valid capability', async () => {
    const { db, repository } = await readyRepository();
    expect(await repository.destroy(groupInput.groupId, 160, groupInput.resultExpiresAt)).toBe(true);
    expect(await repository.get(groupInput.groupId)).toBeNull();
    expect(await repository.isBlocked(groupInput.groupId, 200)).toBe(true);
    expect(await repository.ensure({ ...groupInput, now: 200 })).toBeNull();
    expect(await repository.isBlocked(groupInput.groupId, groupInput.resultExpiresAt)).toBe(false);
    expect(await repository.ensure(groupInput)).not.toBeNull();
    void db;
  });
});
