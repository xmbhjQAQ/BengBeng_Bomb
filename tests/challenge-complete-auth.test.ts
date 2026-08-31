import { describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { challengeId, issueChallenge } from '../src/worker/capabilities/tokens';
import { sha256 } from '../src/worker/capabilities/crypto';
import type { Env } from '../src/worker/config';
import type { SessionRow } from '../src/worker/repositories/sessions';

const secret = 'test-secret-that-is-longer-than-thirty-two-characters';
const challenge = {
  v: 1 as const,
  kind: 'challenge' as const,
  mode: 'self' as const,
  video: { source: 'bilibili' as const, bvid: 'BV1B7411m7LV', cid: 1, page: 1, title: '测试视频', description: '', cover: '', duration: 60 },
  createdAt: 100,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  nonce: 'nonce',
};

type StoredSession = SessionRow & { attempt_token_hash?: string };

class Statement {
  args: unknown[] = [];
  constructor(readonly db: FakeD1, readonly query: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() { return this.db.first<T>(this); }
  async all<T>() { return { results: this.db.all<T>(this) }; }
  async run() { return { meta: { changes: this.db.run(this) } }; }
}

class FakeD1 {
  sessions = new Map<string, StoredSession>();
  traces = new Map<string, { points_json: string; expires_at: number }>();
  stats = new Map<string, { total: number; held: number; failed: number; cumulative_elapsed_seconds: number }>();
  buckets = new Map<string, Array<{ startSeconds: number; count: number }>>();

  prepare(query: string) { return new Statement(this, query); }

  first<T>(statement: Statement): T | null {
    const id = String(statement.args[0]);
    if (statement.query.includes('attempt_token_hash=?')) {
      const row = this.sessions.get(id);
      return row?.attempt_token_hash === String(statement.args[1]) ? ({ ok: 1 } as T) : null;
    }
    if (statement.query.includes('FROM challenge_sessions')) return (this.sessions.get(id) ?? null) as T | null;
    if (statement.query.includes('FROM challenge_score_traces')) return (this.traces.get(id) ?? null) as T | null;
    if (statement.query.includes('FROM video_stats')) return (this.stats.get(id) ?? null) as T | null;
    return null;
  }

  all<T>(statement: Statement): T[] {
    if (!statement.query.includes('FROM video_fail_buckets')) return [];
    return (this.buckets.get(String(statement.args[0])) ?? []) as T[];
  }

  run(statement: Statement) {
    if (statement.query.startsWith('UPDATE challenge_sessions SET state')) {
      const id = String(statement.args[4]);
      const row = this.sessions.get(id);
      if (!row || row.state !== 'started') return 0;
      this.sessions.set(id, { ...row, state: 'completed', completed_at: Number(statement.args[0]), result_expires_at: Number(statement.args[1]), outcome: statement.args[2] as SessionRow['outcome'], failed_at_seconds: statement.args[3] === null ? null : Number(statement.args[3]) });
      return 1;
    }
    return 0;
  }

  async batch(statements: Statement[]) {
    return statements.map((statement) => {
      if (statement.query.includes('INSERT INTO video_stats')) {
        const key = String(statement.args[0]);
        const current = this.stats.get(key) ?? { total: 0, held: 0, failed: 0, cumulative_elapsed_seconds: 0 };
        this.stats.set(key, { total: current.total + 1, held: current.held + Number(statement.args[1]), failed: current.failed + Number(statement.args[2]), cumulative_elapsed_seconds: current.cumulative_elapsed_seconds + Number(statement.args[3]) });
      }
      if (statement.query.includes('INSERT INTO challenge_score_traces')) {
        const id = String(statement.args[0]);
        if (!this.traces.has(id)) this.traces.set(id, { points_json: String(statement.args[1]), expires_at: Number(statement.args[2]) });
      }
      if (statement.query.includes('INSERT INTO video_fail_buckets')) {
        const key = String(statement.args[0]);
        const bucket = Number(statement.args[1]);
        const rows = this.buckets.get(key) ?? [];
        const existing = rows.find((row) => row.startSeconds === bucket);
        if (existing) existing.count += 1; else rows.push({ startSeconds: bucket, count: 1 });
        this.buckets.set(key, rows);
      }
      const changes = statement.query.startsWith('UPDATE challenge_sessions SET state') ? this.run(statement) : 1;
      return { meta: { changes } };
    });
  }
}

const context = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const env = (db: FakeD1): Env => ({ DB: db as unknown as D1Database, ASSETS: {} as Fetcher, APP_SIGNING_SECRET: secret, BILIDIRECT_API_KEY: 'test-api-key', BILIDIRECT_BASE_URL: 'https://api.example.com' });

async function complete(token: string, attemptToken: string, db: FakeD1) {
  return worker.fetch(new Request('https://bomb.example/api/challenges/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: token, attemptToken, outcome: 'failed', elapsedSeconds: 12, scoreTrace: [{ timeSeconds: 1, score: 30 }] }),
  }), env(db), context);
}

describe('single challenge completion authorization', () => {
  it('rejects a wrong bearer after completion without issuing a report', async () => {
    const db = new FakeD1();
    const token = await issueChallenge(challenge, secret);
    const id = await challengeId(token);
    const attemptToken = 'valid-attempt-token';
    db.sessions.set(id, { challenge_id: id, video_key: 'BV1B7411m7LV:1', state: 'started', expires_at: challenge.expiresAt, opened_at: 101, started_at: 102, completed_at: null, result_expires_at: null, outcome: null, failed_at_seconds: null, duration_seconds: 60, attempt_token_hash: 'hash-placeholder' });
    // The Worker hashes the bearer before checking it.  Seed the matching
    // digest through the same shared primitive used by the implementation.
    db.sessions.get(id)!.attempt_token_hash = await sha256(attemptToken);

    const first = await complete(token, attemptToken, db);
    expect(first.status).toBe(200);
    const firstEnvelope = await first.json() as { ok: true; data: { reportToken: string } };
    expect(firstEnvelope.data.reportToken).toBeTruthy();
    expect(db.sessions.get(id)?.state).toBe('completed');

    const forged = await complete(token, 'definitely-wrong-attempt-token', db);
    expect(forged.status).toBe(403);
    const forgedEnvelope = await forged.json() as { ok: false; error: { code: string } };
    expect(forgedEnvelope.error.code).toBe('INVALID_ATTEMPT');
    expect(JSON.stringify(forgedEnvelope)).not.toContain('reportToken');
    expect(db.traces.get(id)?.points_json).toContain('30');
  });
});
