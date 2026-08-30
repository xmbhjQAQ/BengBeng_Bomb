import { CLIENT_CONFIG } from '../shared/config/client';
import { ContractError, decodeOutcome, decodeScoreTrace, isRecord, type ChallengePayload, type ManageResult, type ReportPayload } from '../shared/contracts';
import { fetchDanmaku, parseDirectBvid, resolveBilibili, UpstreamError } from './bilibili/adapter';
import { CapabilityError, challengeId, issueChallenge, issueManage, issueReport, issueVideoTicket, readChallenge, readManage, readReport, readVideoTicket } from './capabilities/tokens';
import { randomToken, sha256 } from './capabilities/crypto';
import { readConfig, type Env } from './config';
import { SessionRepository } from './repositories/sessions';
import { bearer, failure, json, publicJson, readJson, secureAsset } from './security/http';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const videoKey = (bvid: string, cid: number) => `${bvid}:${cid}`;
const publicOrigin = (request: Request) => new URL(request.url).origin;

async function leaderboard(request: Request, repo: SessionRepository, config: ReturnType<typeof readConfig>, ctx?: ExecutionContext): Promise<Response> {
  const cacheUrl = new URL('/api/leaderboard',request.url);
  cacheUrl.searchParams.set('_min',String(config.leaderboardMinAttempts));
  cacheUrl.searchParams.set('_limit',String(config.leaderboardLimit));
  cacheUrl.searchParams.set('_ttl',String(config.leaderboardCacheSeconds));
  const cacheKey = new Request(cacheUrl.toString(),{method:'GET'});
  let cache: Cache | undefined;
  try { cache = typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default: Cache }).default; } catch { cache = undefined; }
  if (cache) {
    try { const hit = await cache.match(cacheKey); if (hit) return hit; } catch { cache = undefined; }
  }
  const response = publicJson({ entries:await repo.leaderboard(config.leaderboardMinAttempts,config.leaderboardLimit) },config.leaderboardCacheSeconds);
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey,response.clone()).catch(() => undefined));
  return response;
}

async function api(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url); const config = readConfig(env); const repo = new SessionRepository(env.DB); const now = nowSeconds();
  if (url.pathname === '/api/health' && request.method === 'GET') return json({ service: 'bengbeng-bomb', ok: true });
  if (url.pathname === '/api/leaderboard' && request.method === 'GET') return leaderboard(request,repo,config,ctx);
  if (url.pathname === '/api/bilibili/parse' && request.method === 'POST') {
    const body = await readJson(request); if (!isRecord(body) || typeof body.input !== 'string') return failure('INVALID_INPUT','请粘贴 B站 BV 视频链接');
    const bvid=parseDirectBvid(body.input);
    const playback = await resolveBilibili(bvid, 1, config, env.BILIDIRECT_API_KEY);
    const videoTicket = await issueVideoTicket(playback, now + config.ticketTtlSeconds, env.APP_SIGNING_SECRET);
    return json({ video: playback, videoTicket });
  }
  if (url.pathname === '/api/challenges' && request.method === 'POST') {
    const body = await readJson(request); if (!isRecord(body) || typeof body.videoTicket !== 'string') return failure('INVALID_INPUT','挑战信息不完整');
    const ticket = await readVideoTicket(body.videoTicket, env.APP_SIGNING_SECRET, now);
    const mode = body.mode === undefined || body.mode === 'classic' ? 'classic' : body.mode === 'self' ? 'self' : null;
    if (!mode) return failure('INVALID_INPUT','挑战模式不正确');
    const initiator = typeof body.initiator === 'string' ? body.initiator.trim() : '', recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '', message = typeof body.message === 'string' ? body.message.trim() : '';
    if (mode === 'classic' && (!initiator || initiator.length > CLIENT_CONFIG.limits.nickname || recipient.length > CLIENT_CONFIG.limits.recipient || message.length > CLIENT_CONFIG.limits.message)) return failure('INVALID_INPUT','昵称或留言长度不正确');
    const payload: ChallengePayload = { v:1, kind:'challenge', video:ticket.video, ...(mode === 'classic' ? {initiator,...(recipient?{recipient}:{}),...(message?{message}:{})} : {}), createdAt:now,expiresAt:now+config.challengeTtlSeconds,nonce:randomToken(18),mode };
    const challengeToken = await issueChallenge(payload, env.APP_SIGNING_SECRET); const id = await challengeId(challengeToken); const manageToken = await issueManage(id, env.APP_SIGNING_SECRET); const origin = publicOrigin(request);
    return json({ challengeToken, challengeUrl:`${origin}/c/${encodeURIComponent(challengeToken)}`, manageUrl:`${origin}/manage#m=${encodeURIComponent(manageToken)}&c=${encodeURIComponent(challengeToken)}`, expiresAt:payload.expiresAt });
  }
  if (url.pathname === '/api/challenges/open' && request.method === 'POST') {
    const body = await readJson(request); if (!isRecord(body) || typeof body.challengeToken !== 'string') return failure('INVALID_INPUT','缺少挑战凭证');
    const payload = await readChallenge(body.challengeToken, env.APP_SIGNING_SECRET, now); const id=await challengeId(body.challengeToken); const playback=await resolveBilibili(payload.video.bvid,payload.video.page,config,env.BILIDIRECT_API_KEY);
    const key=videoKey(payload.video.bvid,payload.video.cid); const session=await repo.open({id,videoKey:key,createdAt:payload.createdAt,expiresAt:payload.expiresAt,now,duration:payload.video.duration}); await repo.upsertVideo(key,payload.video,now);
    return json({ challenge:payload, playback:{...playback,danmakuUrl:`/api/danmaku?challenge=${encodeURIComponent(body.challengeToken)}`}, session, stats:await repo.stats(videoKey(payload.video.bvid,payload.video.cid)) });
  }
  if (url.pathname === '/api/challenges/start' && request.method === 'POST') {
    const body=await readJson(request); if(!isRecord(body)||typeof body.challengeToken!=='string') return failure('INVALID_INPUT','缺少挑战凭证'); await readChallenge(body.challengeToken,env.APP_SIGNING_SECRET,now); const id=await challengeId(body.challengeToken); const attemptToken=randomToken(24); const claimed=await repo.start(id,await sha256(attemptToken),now); if(!claimed){const current=await repo.get(id);return failure(current?.state==='completed'?'ALREADY_COMPLETED':'ALREADY_STARTED',current?.state==='completed'?'挑战已完成':'挑战已经开始',409);} return json({attemptToken});
  }
  if (url.pathname === '/api/challenges/complete' && request.method === 'POST') {
    const body=await readJson(request,48_000); if(!isRecord(body)||typeof body.challengeToken!=='string'||typeof body.attemptToken!=='string') return failure('INVALID_INPUT','结果信息不完整'); const payload=await readChallenge(body.challengeToken,env.APP_SIGNING_SECRET,now); const id=await challengeId(body.challengeToken); const scoreTrace=decodeScoreTrace(body.scoreTrace??[],payload.video.duration); if(!await repo.attemptMatches(id,await sha256(body.attemptToken))){const existing=await repo.get(id); if(existing?.state!=='completed') return failure('INVALID_ATTEMPT','本轮挑战凭证无效',403);}
    const outcome=decodeOutcome(body.outcome); const rawElapsed=Number(body.elapsedSeconds); if(!Number.isFinite(rawElapsed)||rawElapsed<0||rawElapsed>payload.video.duration+3) return failure('INVALID_RESULT','坚持时间不正确'); const elapsed=outcome==='held'?payload.video.duration:Math.min(rawElapsed,payload.video.duration); const expiresAt=now+config.resultTtlSeconds;
    const result=await repo.complete({id,outcome,elapsed,now,resultExpiresAt:expiresAt,bucketSize:CLIENT_CONFIG.heatmapBucketSeconds,scoreTrace}); const row=result.row??await repo.get(id); if(!row||row.state!=='completed'||!row.outcome) return failure('COMPLETE_CONFLICT','结果提交冲突，请刷新后重试',409);
    const reportPayload:ReportPayload={v:1,kind:'report',video:payload.video,outcome:row.outcome,elapsedSeconds:row.outcome==='held'?payload.video.duration:Number(row.failed_at_seconds??0),issuedAt:now,expiresAt:Number(row.result_expires_at??expiresAt),nonce:randomToken(12),resultRef:id,mode:payload.mode}; const reportToken=await issueReport(reportPayload,env.APP_SIGNING_SECRET); return json({outcome:reportPayload.outcome,elapsedSeconds:reportPayload.elapsedSeconds,reportUrl:`${publicOrigin(request)}/report/${encodeURIComponent(reportToken)}`,reportToken,stats:await repo.stats(videoKey(payload.video.bvid,payload.video.cid))});
  }
  if (url.pathname === '/api/manage/result' && request.method === 'POST') {
    const id=await readManage(bearer(request),env.APP_SIGNING_SECRET); const row=await repo.get(id); const expired=Boolean(row&&(row.state==='completed'?(row.result_expires_at??0)<=now:row.expires_at<=now)); if(expired)await repo.destroy(id); const result:ManageResult=expired?{status:'expired'}:!row?{status:'unopened'}:row.state==='completed'?{status:'completed',outcome:row.outcome??undefined,elapsedSeconds:row.outcome==='held'?row.duration_seconds:Number(row.failed_at_seconds??0),expiresAt:row.result_expires_at??undefined}:{status:row.state}; return json(result);
  }
  if (url.pathname === '/api/manage/result' && request.method === 'DELETE') { const id=await readManage(bearer(request),env.APP_SIGNING_SECRET); return json({deleted:await repo.destroy(id)}); }
  if (url.pathname === '/api/reports/resolve' && request.method === 'POST') { const body=await readJson(request); if(!isRecord(body)||typeof body.reportToken!=='string') return failure('INVALID_INPUT','缺少报告凭证'); const report=await readReport(body.reportToken,env.APP_SIGNING_SECRET,now); return json({report,scoreTrace:report.resultRef?await repo.scoreTrace(report.resultRef,now):[],stats:await repo.stats(videoKey(report.video.bvid,report.video.cid))}); }
  if (url.pathname === '/api/danmaku' && request.method === 'GET') { const token=url.searchParams.get('challenge')||''; const payload=await readChallenge(token,env.APP_SIGNING_SECRET,now); const xml=await fetchDanmaku(payload.video.cid,payload.video.bvid,config,env.BILIDIRECT_API_KEY); return new Response(xml,{headers:{'Content-Type':'text/xml; charset=utf-8','Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'}}); }
  return failure('NOT_FOUND','接口不存在',404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) { try { const url=new URL(request.url); if(url.pathname.startsWith('/api/')) return await api(request,env,ctx); return secureAsset(await env.ASSETS.fetch(request)); } catch(error) { if(error instanceof CapabilityError||error instanceof ContractError) return failure(error.code,error.message,error.code.includes('EXPIRED')?410:400); if(error instanceof UpstreamError) return failure('UPSTREAM_ERROR',error.message,error.status>=500?502:400); if(error instanceof SyntaxError) return failure('INVALID_JSON','请求内容不是有效 JSON'); if(error instanceof Error&&(error.message==='MISSING_AUTHORIZATION'||error.message==='REQUEST_TOO_LARGE')) return failure(error.message,error.message==='MISSING_AUTHORIZATION'?'缺少管理凭证':'请求内容过大',error.message==='MISSING_AUTHORIZATION'?401:413); console.error('worker_request_failed',{name:error instanceof Error?error.name:'unknown'}); return failure('INTERNAL_ERROR','服务暂时不可用',500); } },
  async scheduled(_controller: ScheduledController, env: Env) { const result=await new SessionRepository(env.DB).cleanup(nowSeconds()); console.log('expired_sessions_cleaned',{changes:result.changes}); },
} satisfies ExportedHandler<Env>;
