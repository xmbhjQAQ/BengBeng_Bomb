// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import QRCode from 'qrcode';
import worker from '../src/worker/index';
import { SessionRepository } from '../src/worker/repositories/sessions';
import { GroupRepository } from '../src/worker/repositories/groups';
import { issueGroupEntry, issueReport } from '../src/worker/capabilities/tokens';
import { resolveBilibili } from '../src/worker/bilibili/adapter';
import { readConfig, type Env } from '../src/worker/config';

function database() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').sort()) sql.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const db = {
    prepare(query: string) {
      let args: any[] = [];
      const statement = {
        bind(...values: any[]) { args = values; return statement; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; },
      };
      return statement;
    },
    async batch(statements: any[]) {
      sql.exec('BEGIN');
      try { const out = []; for (const s of statements) out.push(await s.run()); sql.exec('COMMIT'); return out; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  } as unknown as D1Database;
  return { sql, db };
}
const secret = 'review-only-not-a-production-secret-123456';
const video = { source: 'bilibili' as const, bvid: 'BV1234567890', cid: 1, page: 1, title: 'Review', description: '', cover: '', duration: 60 };
const envFor = (db: D1Database) => ({ DB: db, APP_SIGNING_SECRET: secret, BILIDIRECT_API_KEY: 'review-only', BILIDIRECT_BASE_URL: 'https://upstream.invalid' }) as Env;
afterEach(() => vi.useRealTimers());

describe('Review reproductions: repaired behavior', () => {
  it('all migrations execute; duplicate completion only aggregates once', async () => {
    const { db, sql } = database(); const repo = new SessionRepository(db);
    await repo.open({ id: 'one', videoKey: 'v', createdAt: 1, expiresAt: 1000, now: 1, duration: 60 });
    await repo.start('one', 'hash', 2);
    const input = { id: 'one', outcome: 'failed' as const, elapsed: 5, now: 10, resultExpiresAt: 100, bucketSize: 10, scoreTrace: [] };
    await repo.complete(input); await repo.complete(input);
    expect((await repo.stats('v')).total).toBe(1);
    await repo.cleanup(101); expect(await repo.get('one')).toBeNull();
    expect(sql.prepare('PRAGMA foreign_key_check').all()).toEqual([]); sql.close();
  });
  it('deleted single challenge cannot reopen or count a second result', async () => {
    const { db, sql } = database(); const repo = new SessionRepository(db);
    const opening = { id: 'one', videoKey: 'v', createdAt: 1, expiresAt: 1000, now: 1, duration: 60 };
    await repo.open(opening); await repo.start('one', 'hash', 2);
    await repo.complete({ id: 'one', outcome: 'held', elapsed: 60, now: 65, resultExpiresAt: 100, bucketSize: 10, scoreTrace: [] });
    await repo.destroy('one', 70);
    expect((await repo.open({ ...opening, now: 71 }))?.revoked_at).toBe(70);
    expect(await repo.start('one', 'new-hash', 72)).toBe(false);
    expect((await repo.stats('v')).total).toBe(1); sql.close();
  });
  it('BEHAVIOR: a stateless public report resolves without a retained private row', async () => {
    const { db, sql } = database(); const now = Math.floor(Date.now()/1000);
    const token = await issueReport({ v: 1, kind: 'report', video, outcome: 'held', elapsedSeconds: 60, issuedAt: now, expiresAt: now+3600, nonce: 'review-nonce', resultRef: 'deleted-id', mode: 'self' }, secret);
    const response = await worker.fetch(new Request('https://review.invalid/api/reports/resolve', { method: 'POST', body: JSON.stringify({ reportToken: token }) }), envFor(db), {} as ExecutionContext);
    const body = await response.json() as any;
    expect(response.status).toBe(200); expect(body.data.report.outcome).toBe('held'); sql.close();
  });
  it('times out when the upstream body stalls after headers arrive', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } });
    const fakeFetch = vi.fn(async () => response) as unknown as typeof fetch;
    const config = readConfig(envFor({} as D1Database)); config.upstreamTimeoutMs = 1000;
    let settled = false;
    const pending = resolveBilibili(video.bvid, 1, config, 'review-only', fakeFetch).finally(() => { settled = true; });
    const timedOut = expect(pending).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(1100); await timedOut; expect(settled).toBe(true);
  });
  it('forwards a ?p=2 Bilibili link as page 2', async () => {
    let sent: any;
    const fakeFetch = vi.fn(async (_url, init) => { sent = JSON.parse(init.body); return Response.json({ok:true,data:{...video,directUrl:'https://media.invalid/test.mp4'}}); }) as unknown as typeof fetch;
    await resolveBilibili(`https://www.bilibili.com/video/${video.bvid}/?p=2`, 1, readConfig(envFor({} as D1Database)), 'review-only', fakeFetch);
    expect(sent.page).toBe(2); expect(sent.url).toBeUndefined();
  });
  it('raw oversized capability data is rejected by the QR encoder', async () => {
    const now = Math.floor(Date.now()/1000);
    const token = await issueGroupEntry({v:1,kind:'group-entry',groupId:'review-group',video:{...video,title:'测'.repeat(120),description:'试'.repeat(180),cover:'https://cdn.invalid/'+ 'a'.repeat(900)},createdAt:now,expiresAt:now+3600,resultExpiresAt:now+7200,nonce:'review-nonce',mode:'group',initiator:'测'.repeat(20),message:'试'.repeat(80)}, secret);
    const url = `https://bomb.nagisa.icu/g/entry/${token}`;
    console.log('valid group URL bytes', Buffer.byteLength(url));
    expect(() => QRCode.create(url)).toThrow();
  });
  it('group deletion prevents reopening and cascades participants', async () => {
    const { db, sql } = database(); const repo = new GroupRepository(db);
    const input = { groupId:'g',videoKey:'v',createdAt:1,expiresAt:100,resultExpiresAt:200,now:2 };
    await repo.ensure(input); await repo.start({ groupId:'g',attemptId:'a',nickname:'review',attemptHash:'hash',now:3 });
    await repo.destroy('g',4,200);
    expect(await repo.ensure({...input,now:5})).toBeNull(); expect(await repo.getAttempt('a')).toBeNull(); sql.close();
  });
});

describe('Additional review evidence', () => {
  it('keeps the group recovery key stable across repeated entry resolution', async () => {
    const {db,sql}=database(); const now=Math.floor(Date.now()/1000);
    const entryToken=await issueGroupEntry({v:1,kind:'group-entry',groupId:'stable-group',video,createdAt:now,expiresAt:now+3600,resultExpiresAt:now+7200,nonce:'stable-entry',mode:'group'},secret);
    const call=async()=> {
      const r=await worker.fetch(new Request('https://review.invalid/api/groups/entry',{method:'POST',body:JSON.stringify({entryToken})}),envFor(db),{} as ExecutionContext);
      expect(r.status).toBe(200); return (await r.json() as any).data;
    };
    const first=await call(),second=await call();
    expect(first.invitationToken).toBe(second.invitationToken);
    expect(first.resultToken).toBe(second.resultToken);
    expect(JSON.parse(Buffer.from(first.invitationToken.split('.')[1],'base64url').toString()).groupId).toBe('stable-group'); sql.close();
  });
  it('measures uncached group aggregation SQL using synthetic local data', async () => {
    const {db,sql}=database(); const repo=new GroupRepository(db);
    await repo.ensure({groupId:'bench',videoKey:'v',createdAt:1,expiresAt:1000,resultExpiresAt:2000,now:2});
    const insert=sql.prepare("INSERT INTO group_attempts(attempt_id,group_id,nickname,state,attempt_token_hash,started_at,completed_at,outcome,elapsed_seconds,failed_at_seconds,result_expires_at) VALUES(?,'bench','test','completed',?,2,3,'failed',10,10,2000)");
    for(const target of [1000,10000,50000]) {
      const count=Number((sql.prepare('SELECT COUNT(*) c FROM group_attempts').get() as any).c);
      sql.exec('BEGIN'); for(let i=count;i<target;i++)insert.run(`a${i}`,`h${i}`); sql.exec('COMMIT');
      const samples=[];
      for(let i=0;i<5;i++){const t=performance.now();await repo.resultSummary('bench',10);await repo.groupStats('bench',10);samples.push(performance.now()-t);}
      console.log('LOCAL SQLite only: completed rows, median ms for summary + groupStats',target,samples.sort((a,b)=>a-b)[2]);
    }
    console.log('aggregation plan',sql.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*),SUM(elapsed_seconds) FROM group_attempts WHERE group_id='bench' AND state='completed' AND result_expires_at>10").all());
    sql.close();
  });
});



describe('User screenshot QAQ', () => {
  it('records a successful 12 second attempt and correctly has no failure buckets', async () => {
    const {db,sql}=database(); const repo=new GroupRepository(db);
    await repo.ensure({groupId:'screenshot',videoKey:'v',createdAt:1,expiresAt:100,resultExpiresAt:200,now:2});
    await repo.start({groupId:'screenshot',attemptId:'qaq',nickname:'QAQ',attemptHash:'review-hash',now:3});
    await repo.complete({groupId:'screenshot',attemptId:'qaq',outcome:'held',elapsed:12,now:15,bucketSize:10});
    expect(await repo.groupStats('screenshot',16)).toEqual({total:1,held:1,failed:0,failureRate:0,averageElapsedSeconds:12,buckets:[]});
    expect((await repo.resultQuery('screenshot',16,20)).rows[0]).toMatchObject({nickname:'QAQ',outcome:'held',elapsedSeconds:12});
    sql.close();
  });
});
