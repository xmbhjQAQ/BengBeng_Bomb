import { describe, expect, it } from 'vitest';
import { SessionRepository, type SessionRow } from '../src/worker/repositories/sessions';

interface StatsRow { total: number; held: number; failed: number; cumulative_elapsed_seconds: number }

class FakeStatement {
  args: unknown[] = [];
  constructor(readonly db: FakeD1, readonly query: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() { return this.db.first(this) as T | null; }
  async all<T>() { return { results: this.db.all(this) as T[] }; }
  async run() { return { meta: { changes: this.db.run(this) } }; }
}

class FakeD1 {
  sessions = new Map<string, SessionRow>();
  statsRows = new Map<string, StatsRow>();
  buckets = new Map<string, Map<number, number>>();
  lastBucketQuery = '';
  batchCalls = 0;

  prepare(query: string) { return new FakeStatement(this, query); }
  first(statement: FakeStatement) {
    if (statement.query.includes('FROM challenge_sessions')) {
      return this.sessions.get(String(statement.args[0])) ?? null;
    }
    if (statement.query.includes('FROM video_stats')) {
      return this.statsRows.get(String(statement.args[0])) ?? null;
    }
    return null;
  }
  all(statement: FakeStatement) {
    if (!statement.query.includes('FROM video_fail_buckets')) return [];
    this.lastBucketQuery = statement.query;
    const values = this.buckets.get(String(statement.args[0])) ?? new Map();
    return [...values.entries()]
      .sort(([left], [right]) => left - right)
      .map(([startSeconds, count]) => ({ startSeconds, count }));
  }
  run(statement: FakeStatement) {
    if (!statement.query.startsWith('UPDATE challenge_sessions SET state')) return 0;
    const id = String(statement.args[4]);
    const row = this.sessions.get(id);
    if (!row || row.state !== 'started') return 0;
    this.sessions.set(id, {
      ...row,
      state: 'completed',
      completed_at: Number(statement.args[0]),
      result_expires_at: Number(statement.args[1]),
      outcome: statement.args[2] as SessionRow['outcome'],
      failed_at_seconds: statement.args[3] === null ? null : Number(statement.args[3]),
    });
    return 1;
  }
  async batch(statements: FakeStatement[]) {
    this.batchCalls += 1;
    for (const statement of statements) {
      if (statement.query.includes('INSERT INTO video_stats')) {
        const key = String(statement.args[0]);
        const current = this.statsRows.get(key) ?? { total: 0, held: 0, failed: 0, cumulative_elapsed_seconds: 0 };
        this.statsRows.set(key, {
          total: current.total + 1,
          held: current.held + Number(statement.args[1]),
          failed: current.failed + Number(statement.args[2]),
          cumulative_elapsed_seconds: current.cumulative_elapsed_seconds + Number(statement.args[3]),
        });
      }
      if (statement.query.includes('INSERT INTO video_fail_buckets')) {
        const key = String(statement.args[0]);
        const start = Number(statement.args[1]);
        const values = this.buckets.get(key) ?? new Map<number, number>();
        values.set(start, (values.get(start) ?? 0) + 1);
        this.buckets.set(key, values);
      }
    }
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}

function started(id: string): SessionRow {
  return {
    challenge_id: id,
    video_key: 'BV-test:1',
    state: 'started',
    expires_at: 10_000,
    opened_at: 1,
    started_at: 2,
    completed_at: null,
    result_expires_at: null,
    outcome: null,
    failed_at_seconds: null,
    duration_seconds: 60,
  };
}

describe('SessionRepository aggregate buckets', () => {
  it('increments equal buckets, sorts distinct buckets and aggregates a completion once', async () => {
    const db = new FakeD1();
    db.sessions.set('a', started('a'));
    db.sessions.set('b', started('b'));
    db.sessions.set('c', started('c'));
    const repository = new SessionRepository(db as unknown as D1Database);

    await repository.complete({ id: 'a', outcome: 'failed', elapsed: 12, now: 100, resultExpiresAt: 200, bucketSize: 10 });
    await repository.complete({ id: 'b', outcome: 'failed', elapsed: 18, now: 101, resultExpiresAt: 201, bucketSize: 10 });
    await repository.complete({ id: 'c', outcome: 'failed', elapsed: 26, now: 102, resultExpiresAt: 202, bucketSize: 10 });
    const repeated = await repository.complete({ id: 'a', outcome: 'failed', elapsed: 12, now: 103, resultExpiresAt: 203, bucketSize: 10 });
    const stats = await repository.stats('BV-test:1');

    expect(repeated.status).toBe('existing');
    expect(db.batchCalls).toBe(3);
    expect(stats).toEqual({
      total: 3,
      held: 0,
      failed: 3,
      failureRate: 1,
      averageElapsedSeconds: 56 / 3,
      buckets: [{ startSeconds: 10, count: 2 }, { startSeconds: 20, count: 1 }],
    });
    expect(db.lastBucketQuery).toContain('bucket_start_seconds AS "startSeconds"');
  });
});
