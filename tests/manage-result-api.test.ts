import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';
import { issueManage } from '../src/worker/capabilities/tokens';
import type { Env } from '../src/worker/config';
import type { SessionRow } from '../src/worker/repositories/sessions';
import type { ManageResult } from '../src/shared/contracts';

const secret = 'test-secret-that-is-longer-than-thirty-two-characters';
const video = { bvid: 'BV1B7411m7LV', cid: 1, page: 1, title: '难绷视频', cover: 'https://i.example/cover.jpg', duration_seconds: 60 };
const stats = { total: 3, held: 1, failed: 2, cumulative_elapsed_seconds: 66 };

class ManageStatement {
  args: unknown[] = [];
  constructor(readonly db: ManageD1, readonly query: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() { return this.db.first<T>(this); }
  async all<T>() { return { results: this.db.all<T>(this) }; }
  async run() { return { meta: { changes: this.db.run(this) } }; }
}

class ManageD1 {
  sessions = new Map<string, SessionRow>();
  catalog = new Map<string, typeof video>();
  statsRows = new Map<string, typeof stats>();
  buckets = new Map<string, Array<{ startSeconds: number; count: number }>>();
  traces = new Map<string, { points_json: string; expires_at: number }>();

  prepare(query: string) { return new ManageStatement(this, query); }

  first<T>(statement: ManageStatement): T | null {
    const key = String(statement.args[0]);
    if (statement.query.includes('FROM challenge_sessions')) return (this.sessions.get(key) ?? null) as T | null;
    if (statement.query.includes('FROM video_catalog')) return (this.catalog.get(key) ?? null) as T | null;
    if (statement.query.includes('FROM challenge_score_traces')) return (this.traces.get(key) ?? null) as T | null;
    if (statement.query.includes('FROM video_stats')) return (this.statsRows.get(key) ?? null) as T | null;
    return null;
  }

  all<T>(statement: ManageStatement): T[] {
    if (!statement.query.includes('FROM video_fail_buckets')) return [];
    return (this.buckets.get(String(statement.args[0])) ?? []) as T[];
  }

  run(statement: ManageStatement) {
    if (statement.query.startsWith('DELETE FROM challenge_score_traces')) return this.traces.delete(String(statement.args[0])) ? 1 : 0;
    if (statement.query.startsWith('DELETE FROM challenge_sessions')) return this.sessions.delete(String(statement.args[0])) ? 1 : 0;
    return 0;
  }

  async batch(statements: ManageStatement[]) {
    return statements.map((statement) => ({ meta: { changes: this.run(statement) } }));
  }
}

const env = (db: ManageD1): Env => ({
  DB: db as unknown as D1Database,
  ASSETS: {} as Fetcher,
  APP_SIGNING_SECRET: secret,
  BILIDIRECT_API_KEY: '',
  BILIDIRECT_BASE_URL: 'https://api.example.com',
});
const context = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function completedRow(id: string, expiresAt: number): SessionRow {
  return {
    challenge_id: id,
    video_key: 'BV1B7411m7LV:1',
    state: 'completed',
    expires_at: expiresAt,
    opened_at: 1,
    started_at: 2,
    completed_at: 30,
    result_expires_at: expiresAt,
    outcome: 'failed',
    failed_at_seconds: 12,
    duration_seconds: 60,
  };
}

async function manage(db: ManageD1, id: string, method: 'POST' | 'DELETE' = 'POST') {
  const token = await issueManage(id, secret);
  return worker.fetch(new Request('https://bomb.example/api/manage/result', { method, headers: { Authorization: `Bearer ${token}` } }), env(db), context);
}

describe('private manage result details', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the completed trace, anonymous stats and stable video metadata only with manage authorization', async () => {
    const db = new ManageD1();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    db.sessions.set('completed', completedRow('completed', expiresAt));
    db.catalog.set('BV1B7411m7LV:1', video);
    db.statsRows.set('BV1B7411m7LV:1', stats);
    db.buckets.set('BV1B7411m7LV:1', [{ startSeconds: 0, count: 1 }, { startSeconds: 10, count: 1 }]);
    db.traces.set('completed', { points_json: JSON.stringify([{ timeSeconds: 5, score: 30 }, { timeSeconds: 12, score: 76 }]), expires_at: expiresAt });

    const response = await manage(db, 'completed');
    const envelope = await response.json() as { ok: true; data: ManageResult };

    expect(response.status).toBe(200);
    expect(envelope.data).toMatchObject({
      status: 'completed',
      outcome: 'failed',
      elapsedSeconds: 12,
      expiresAt,
      video: { bvid: video.bvid, cid: video.cid, title: video.title, duration: video.duration_seconds },
      scoreTrace: [{ timeSeconds: 5, score: 30 }, { timeSeconds: 12, score: 76 }],
      stats: { total: 3, held: 1, failed: 2, failureRate: 2 / 3, averageElapsedSeconds: 22 },
    });
    expect(envelope.data).not.toHaveProperty('initiator');
    expect(envelope.data).not.toHaveProperty('recipient');
    expect(envelope.data).not.toHaveProperty('message');
  });

  it('deletes expired private details before responding and keeps deletion from exposing them later', async () => {
    const db = new ManageD1();
    const expiredAt = Math.floor(Date.now() / 1000) - 1;
    db.sessions.set('expired', completedRow('expired', expiredAt));
    db.traces.set('expired', { points_json: JSON.stringify([{ timeSeconds: 5, score: 30 }]), expires_at: expiredAt });

    const expiredResponse = await manage(db, 'expired');
    const expiredEnvelope = await expiredResponse.json() as { ok: true; data: ManageResult };
    expect(expiredEnvelope.data).toEqual({ status: 'expired' });
    expect(db.sessions.has('expired')).toBe(false);
    expect(db.traces.has('expired')).toBe(false);

    const dbForDelete = new ManageD1();
    const liveAt = Math.floor(Date.now() / 1000) + 3600;
    dbForDelete.sessions.set('deleted', completedRow('deleted', liveAt));
    dbForDelete.traces.set('deleted', { points_json: JSON.stringify([{ timeSeconds: 5, score: 30 }]), expires_at: liveAt });
    const deleteResponse = await manage(dbForDelete, 'deleted', 'DELETE');
    expect((await deleteResponse.json() as { ok: true; data: { deleted: boolean } }).data.deleted).toBe(true);
    expect(dbForDelete.sessions.has('deleted')).toBe(false);
    expect(dbForDelete.traces.has('deleted')).toBe(false);
    const afterDelete = await manage(dbForDelete, 'deleted');
    expect((await afterDelete.json() as { ok: true; data: ManageResult }).data).toEqual({ status: 'unopened' });
  });

  it('degrades old or malformed rows without catalog/trace details instead of fabricating a curve', async () => {
    const db = new ManageD1();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    db.sessions.set('old', completedRow('old', expiresAt));
    db.traces.set('old', { points_json: '{not-json', expires_at: expiresAt });

    const response = await manage(db, 'old');
    const data = (await response.json() as { ok: true; data: ManageResult }).data;

    expect(data).toMatchObject({ status: 'completed', outcome: 'failed', elapsedSeconds: 12, scoreTrace: [] });
    expect(data).not.toHaveProperty('video');
  });
});
