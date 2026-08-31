import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';
import type { Env } from '../src/worker/config';
import type { GroupEntryPayload, GroupInvitationPayload, GroupResultPayload } from '../src/shared/contracts';
import { issueGroupEntry, issueGroupInvitation, issueGroupResult, issueVideoTicket, readGroupEntry, readGroupInvitation, readGroupResult } from '../src/worker/capabilities/tokens';

const secret = 'test-secret-that-is-longer-than-thirty-two-characters';
const video = {
  source: 'bilibili' as const,
  bvid: 'BV1B7411m7LV',
  cid: 12,
  page: 1,
  title: '测试视频',
  description: '',
  cover: '',
  duration: 60,
};

const env = (db: unknown = {}): Env => ({
  DB: db as D1Database,
  ASSETS: {} as Fetcher,
  APP_SIGNING_SECRET: secret,
  BILIDIRECT_API_KEY: '',
  BILIDIRECT_BASE_URL: 'https://api.example.com',
});
const context = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

class OpenStatement {
  args: unknown[] = [];
  constructor(readonly db: OpenD1, readonly query: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() { return this.db.first<T>(this); }
  async all<T>() { return { results: this.db.all<T>(this) }; }
  async run() { return { meta: { changes: this.db.run(this) } }; }
}

/** Minimal D1 surface for exercising the public open endpoint. */
class OpenD1 {
  groups = new Map<string, Record<string, unknown>>();
  attempts = new Map<string, unknown>();
  catalog = new Map<string, Record<string, unknown>>();

  prepare(query: string) { return new OpenStatement(this, query); }

  first<T>(statement: OpenStatement): T | null {
    if (statement.query.includes('FROM group_challenges')) return (this.groups.get(String(statement.args[0])) ?? null) as T | null;
    if (statement.query.includes('FROM video_catalog')) return (this.catalog.get(String(statement.args[0])) ?? null) as T | null;
    if (statement.query.includes('COUNT(*)') && statement.query.includes('FROM group_attempts')) return { total: 0, held: 0, failed: 0 } as T;
    if (statement.query.includes('FROM video_stats')) return null;
    return null;
  }

  all<T>(statement: OpenStatement): T[] { void statement; return []; }

  run(statement: OpenStatement): number {
    if (statement.query.startsWith('INSERT INTO group_challenges')) {
      const [groupId, videoKey, createdAt, expiresAt, resultExpiresAt] = statement.args;
      if (this.groups.has(String(groupId))) return 0;
      this.groups.set(String(groupId), { group_id: groupId, video_key: videoKey, created_at: createdAt, expires_at: expiresAt, result_expires_at: resultExpiresAt, state: 'active', ended_at: null });
      return 1;
    }
    if (statement.query.startsWith('INSERT INTO video_catalog')) {
      const [videoKey, bvid, cid, page, title, cover, duration] = statement.args;
      this.catalog.set(String(videoKey), { bvid, cid, page, title, cover, duration_seconds: duration });
      return 1;
    }
    return 0;
  }
}

async function post(path: string, body: unknown, database: unknown = {}) {
  return worker.fetch(new Request(`https://bomb.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env(database), context);
}

describe('group challenge API contracts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates distinct invitation, result and private management capabilities', async () => {
    const now = Math.floor(Date.now() / 1000);
    const videoTicket = await issueVideoTicket(video, now + 60, secret);
    const response = await post('/api/challenges', { videoTicket, mode: 'group', initiator: '发起者', message: '发到群里' });
    const envelope = await response.json() as { ok: true; data: Record<string, string | number> };

    expect(response.status).toBe(200);
    expect(envelope.data.mode).toBe('group');
    expect(envelope.data.challengeUrl).toMatch(/^https:\/\/bomb\.example\/g\/bg1\./);
    expect(envelope.data.invitationUrl).toBe(envelope.data.challengeUrl);
    expect(envelope.data.resultUrl).toMatch(/^https:\/\/bomb\.example\/g\/results\/bgr1\./);
    expect(envelope.data.manageUrl).toMatch(/^https:\/\/bomb\.example\/manage#.*bgm1\./);
    expect(envelope.data.challengeUrl).not.toContain('bm1.');
    expect(envelope.data.resultUrl).not.toContain('bm1.');
    expect(envelope.data.entryUrl).toMatch(/^https:\/\/bomb\.example\/g\/entry\/bge1\./);
    expect(envelope.data.groupEntryUrl).toBe(envelope.data.entryUrl);

    const invitation = await readGroupInvitation(String(envelope.data.groupInvitationToken), secret, now);
    const entry = await readGroupEntry(String(envelope.data.groupEntryToken), secret, now);
    const result = await readGroupResult(String(envelope.data.groupResultToken), secret, now);
    expect(invitation.groupId).toBe(result.groupId);
    expect(entry.groupId).toBe(invitation.groupId);
    expect(entry.initiator).toBe('发起者');
    expect(invitation.initiator).toBe('发起者');
    expect(invitation.message).toBe('发到群里');
    expect(invitation.expiresAt).toBeLessThan(invitation.resultExpiresAt);
  });

  it('rejects result capabilities at participation endpoints and rejects expired invitations', async () => {
    const now = Math.floor(Date.now() / 1000);
    const invitation: GroupInvitationPayload = {
      v: 1,
      kind: 'group-invitation',
      groupId: 'group-api-test',
      video,
      createdAt: now - 10,
      expiresAt: now + 60,
      resultExpiresAt: now + 120,
      nonce: 'invitation',
      mode: 'group',
    };
    const invitationToken = await issueGroupInvitation(invitation, secret);
    const resultPayload: GroupResultPayload = {
      v: 1,
      kind: 'group-result',
      groupId: invitation.groupId,
      video,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      resultExpiresAt: invitation.resultExpiresAt,
      nonce: 'result',
    };
    const resultToken = await issueGroupResult(resultPayload, secret);

    const wrongStart = await post('/api/groups/start', { groupToken: resultToken, nickname: '小明' });
    expect(wrongStart.status).toBe(400);
    expect(await wrongStart.json()).toMatchObject({ ok: false, error: { code: 'INVALID_TOKEN' } });

    const expiredToken = await issueGroupInvitation({ ...invitation, expiresAt: now - 1, resultExpiresAt: now + 60 }, secret);
    const expiredStart = await post('/api/groups/start', { groupToken: expiredToken, nickname: '小明' });
    expect(expiredStart.status).toBe(410);
    expect(await expiredStart.json()).toMatchObject({ ok: false, error: { code: 'TOKEN_EXPIRED' } });

    const expiredResultToken = await issueGroupResult({ ...resultPayload, expiresAt: now - 2, resultExpiresAt: now - 1 }, secret);
    const expiredResults = await post('/api/groups/results', { resultToken: expiredResultToken });
    expect(expiredResults.status).toBe(410);
    expect(await expiredResults.json()).toMatchObject({ ok: false, error: { code: 'TOKEN_EXPIRED' } });
    expect(invitationToken).not.toBe(resultToken);
  });

  it('opens the same invitation repeatedly without creating abandoned participant rows', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: GroupInvitationPayload = {
      v: 1,
      kind: 'group-invitation',
      groupId: 'group-open-test',
      video,
      createdAt: now - 10,
      expiresAt: now + 3600,
      resultExpiresAt: now + 7200,
      nonce: 'open',
      mode: 'group',
    };
    const token = await issueGroupInvitation(payload, secret);
    const db = new OpenD1();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {
      ...video,
      directUrl: 'https://cdn.example/video.mp4',
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const first = await post('/api/groups/open', { groupToken: token }, db);
    const second = await post('/api/groups/open', { groupToken: token }, db);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.groups.size).toBe(1);
    expect(db.attempts.size).toBe(0);
    const data = (await first.json() as { ok: true; data: Record<string, unknown> }).data;
    expect(data.resultPage).toMatchObject({ results: [], summary: { total: 0, held: 0, failed: 0 } });
    expect(data.resultUrl).toMatch(/^https:\/\/bomb\.example\/g\/results\/bgr1\./);
  });

  it('resolves one universal entry into participation and result actions while creating only one parent row', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: GroupEntryPayload = {
      v: 1, kind: 'group-entry', groupId: 'group-entry-test', video, createdAt: now - 10,
      expiresAt: now + 3600, resultExpiresAt: now + 7200, nonce: 'entry', mode: 'group', initiator: '发起者', message: '来玩',
    };
    const token = await issueGroupEntry(payload, secret);
    const db = new OpenD1();
    const unopened = await post('/api/groups/entry', { entryToken: token }, db);
    expect(unopened.status).toBe(200);
    const unopenedData = (await unopened.json() as { ok: true; data: Record<string, unknown> }).data;
    expect(unopenedData.entry).toMatchObject({ state: 'active', canParticipate: true });
    expect(unopenedData.invitationUrl).toMatch(/^https:\/\/bomb\.example\/g\/bg1\./);
    expect(unopenedData.resultUrl).toMatch(/^https:\/\/bomb\.example\/g\/results\/bgr1\./);
    expect(db.groups.size).toBe(1);

    const active = await post('/api/groups/entry', { entryToken: token }, db);
    expect(active.status).toBe(200);
    const activeData = (await active.json() as { ok: true; data: Record<string, unknown> }).data;
    expect(activeData.entry).toMatchObject({ state: 'active', canParticipate: true, initiator: '发起者', message: '来玩' });
    expect(activeData.invitationUrl).toMatch(/^https:\/\/bomb\.example\/g\/bg1\./);
    expect(activeData.resultUrl).toMatch(/^https:\/\/bomb\.example\/g\/results\/bgr1\./);
  });
});
