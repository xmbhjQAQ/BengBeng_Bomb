import { CLIENT_CONFIG } from '../shared/config/client';
import { ContractError, decodeNickname, decodeOutcome, decodeScoreTrace, GROUP_RESULTS_DEFAULT_LIMIT, GROUP_RESULTS_MAX_LIMIT, isRecord, type ChallengePayload, type GroupEntryPayload, type GroupInvitationPayload, type GroupManagePayload, type GroupParticipantResult, type GroupResultPayload, type ManageResult, type ReportPayload } from '../shared/contracts';
import { fetchDanmaku, parseDirectBvid, resolveBilibili, UpstreamError } from './bilibili/adapter';
import { CapabilityError, challengeId, issueChallenge, issueGroupEntry, issueGroupInvitation, issueGroupManage, issueGroupResult, issueManage, issueReport, issueVideoTicket, readChallenge, readGroupEntry, readGroupInvitation, readGroupManage, readGroupResult, readManage, readReport, readVideoTicket } from './capabilities/tokens';
import { randomToken, sha256 } from './capabilities/crypto';
import { readConfig, type Env } from './config';
import { GroupRepository, GroupRepositoryError, type GroupAttemptRow } from './repositories/groups';
import { SessionRepository } from './repositories/sessions';
import { bearer, failure, json, publicJson, rateLimited, readJson, secureAsset } from './security/http';
import { checkRateLimit, type RateLimitKind } from './security/rateLimit';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const videoKey = (bvid: string, cid: number) => `${bvid}:${cid}`;
const publicOrigin = (request: Request, config: ReturnType<typeof readConfig>) => config.publicOrigin ?? new URL(request.url).origin;
const groupTokenFrom = (body: Record<string, unknown>, names: string[]) => {
  for (const name of names) if (typeof body[name] === 'string' && body[name]) return body[name] as string;
  return '';
};
const groupResultPayload = (payload: GroupInvitationPayload, resultExpiresAt: number, nonce = randomToken(12)): GroupResultPayload => ({
  v: 1, kind: 'group-result', groupId: payload.groupId, video: payload.video,
  createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt, nonce,
});
const groupEntryPayload = (payload: GroupInvitationPayload): GroupEntryPayload => ({
  v: 1, kind: 'group-entry', groupId: payload.groupId, video: payload.video,
  createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt: payload.resultExpiresAt,
  nonce: randomToken(18), mode: 'group',
  ...(payload.initiator ? { initiator: payload.initiator } : {}),
  ...(payload.message ? { message: payload.message } : {}),
});
const groupInvitationPayload = (payload: GroupEntryPayload): GroupInvitationPayload => ({
  v: 1, kind: 'group-invitation', groupId: payload.groupId, video: payload.video,
  createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt: payload.resultExpiresAt,
  nonce: randomToken(18), mode: 'group',
  ...(payload.initiator ? { initiator: payload.initiator } : {}),
  ...(payload.message ? { message: payload.message } : {}),
});
const groupManagePayload = (payload: GroupInvitationPayload, resultExpiresAt: number): GroupManagePayload => ({
  v: 1, kind: 'group-manage', groupId: payload.groupId, video: payload.video,
  createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt, nonce: randomToken(12),
});
const groupResultExpiry = (payload: Pick<GroupInvitationPayload, 'expiresAt' | 'resultExpiresAt'> | Pick<GroupManagePayload, 'expiresAt' | 'resultExpiresAt'>) => payload.resultExpiresAt;
const groupResultView = (row: GroupAttemptRow): GroupParticipantResult => ({
  nickname: row.nickname, outcome: row.outcome!, elapsedSeconds: Number(row.elapsed_seconds ?? 0),
  ...(row.outcome === 'failed' && row.failed_at_seconds !== null ? { failedAtSeconds: Number(row.failed_at_seconds) } : {}),
  completedAt: Number(row.completed_at ?? 0),
});

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
  const url = new URL(request.url); const config = readConfig(env); const repo = new SessionRepository(env.DB); const groupRepo = new GroupRepository(env.DB); const now = nowSeconds();
  const rateLimitKind: RateLimitKind | null = url.pathname === '/api/bilibili/parse' || url.pathname === '/api/danmaku' || url.pathname.endsWith('/open') ? 'expensive' : url.pathname === '/api/leaderboard' || url.pathname.includes('/results') || url.pathname === '/api/groups/entry' || url.pathname === '/api/reports/resolve' ? 'public-read' : request.method === 'POST' || request.method === 'DELETE' ? 'mutation' : null;
  if (rateLimitKind) {
    const binding = rateLimitKind === 'expensive' ? env.RATE_LIMITER_EXPENSIVE : rateLimitKind === 'public-read' ? env.RATE_LIMITER_PUBLIC : env.RATE_LIMITER_MUTATION;
    if (!await checkRateLimit(binding, request, rateLimitKind)) return rateLimited();
  }
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
    const mode = body.mode === undefined || body.mode === 'classic' ? 'classic' : body.mode === 'self' ? 'self' : body.mode === 'group' ? 'group' : null;
    if (!mode) return failure('INVALID_INPUT','挑战模式不正确');
    const initiator = typeof body.initiator === 'string' ? body.initiator.trim() : '', recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '', message = typeof body.message === 'string' ? body.message.trim() : '';
    if (mode === 'classic' && (!initiator || initiator.length > CLIENT_CONFIG.limits.nickname || recipient.length > CLIENT_CONFIG.limits.recipient || message.length > CLIENT_CONFIG.limits.message)) return failure('INVALID_INPUT','昵称或留言长度不正确');
    if (mode === 'group') {
      const expiresAt = now + config.challengeTtlSeconds;
      const resultExpiresAt = expiresAt + config.resultTtlSeconds;
      const groupPayload: GroupInvitationPayload = { v: 1, kind: 'group-invitation', groupId: randomToken(18), video: ticket.video, ...(initiator ? { initiator } : {}), ...(message ? { message } : {}), createdAt: now, expiresAt, resultExpiresAt, nonce: randomToken(18), mode: 'group' };
      const challengeToken = await issueGroupInvitation(groupPayload, env.APP_SIGNING_SECRET);
      const entryToken = await issueGroupEntry(groupEntryPayload(groupPayload), env.APP_SIGNING_SECRET);
      const resultToken = await issueGroupResult(groupResultPayload(groupPayload, resultExpiresAt, randomToken(18)), env.APP_SIGNING_SECRET);
      const manageToken = await issueGroupManage(groupManagePayload(groupPayload, resultExpiresAt), env.APP_SIGNING_SECRET);
      const origin = publicOrigin(request, config);
      const invitationUrl = `${origin}/g/${encodeURIComponent(challengeToken)}`;
      const entryUrl = `${origin}/g/entry/${encodeURIComponent(entryToken)}`;
      const resultUrl = `${origin}/g/results/${encodeURIComponent(resultToken)}`;
      const manageUrl = `${origin}/manage#m=${encodeURIComponent(manageToken)}`;
      // Keep the legacy group `challengeUrl` pointed at the direct invitation;
      // new callers should use the explicit `entryUrl` for the one-QR share.
      return json({ mode, challengeToken, challengeUrl: invitationUrl, groupInvitationToken: challengeToken, groupInvitationUrl: invitationUrl, invitationUrl, entryToken, groupEntryToken: entryToken, entryUrl, groupEntryUrl: entryUrl, resultToken, groupResultToken: resultToken, groupResultUrl: resultUrl, resultUrl, manageToken, manageUrl, expiresAt, resultExpiresAt });
    }
    const payload: ChallengePayload = { v:1, kind:'challenge', video:ticket.video, ...(mode === 'classic' ? {initiator,...(recipient?{recipient}:{}),...(message?{message}:{})} : {}), createdAt:now,expiresAt:now+config.challengeTtlSeconds,nonce:randomToken(18),mode };
    const challengeToken = await issueChallenge(payload, env.APP_SIGNING_SECRET); const id = await challengeId(challengeToken); const manageToken = await issueManage(id, env.APP_SIGNING_SECRET); const origin = publicOrigin(request, config);
    return json({ challengeToken, challengeUrl:`${origin}/c/${encodeURIComponent(challengeToken)}`, manageUrl:`${origin}/manage#m=${encodeURIComponent(manageToken)}&c=${encodeURIComponent(challengeToken)}`, expiresAt:payload.expiresAt });
  }
  if (url.pathname === '/api/groups/entry' && request.method === 'POST') {
    const body = await readJson(request);
    if (!isRecord(body)) return failure('INVALID_INPUT', '缺少群组入口凭证');
    const token = groupTokenFrom(body, ['groupEntryToken', 'entryToken', 'groupToken']);
    if (!token) return failure('INVALID_INPUT', '缺少群组入口凭证');
    const payload = await readGroupEntry(token, env.APP_SIGNING_SECRET, now);
    const key = videoKey(payload.video.bvid, payload.video.cid);
    const invitationPayload = groupInvitationPayload(payload);
    const resultToken = await issueGroupResult(groupResultPayload(invitationPayload, payload.resultExpiresAt), env.APP_SIGNING_SECRET);
    const resultUrl = `${publicOrigin(request, config)}/g/results/${encodeURIComponent(resultToken)}`;
    let group = await groupRepo.get(payload.groupId);
    // The first universal-entry visit is the lazy group open.  It creates one
    // parent row (never a participant row) so the visitor can choose to join;
    // a manual destroy block is checked before this path can recreate it.
    if (!group && payload.expiresAt > now && !(await groupRepo.isBlocked(payload.groupId, now))) {
      group = await groupRepo.ensure({ groupId: payload.groupId, videoKey: key, createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt: payload.resultExpiresAt, now });
    }
    const emptyStats = { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0, buckets: [] as Array<{ startSeconds: number; count: number }> };
    if (!group) {
      const empty = { state: payload.expiresAt <= now ? 'expired' as const : 'unopened' as const, video: payload.video, createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt: payload.resultExpiresAt, summary: { total: 0, held: 0, failed: 0 }, results: [] as GroupParticipantResult[] };
      return json({
        entry: { state: empty.state, video: payload.video, createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt: payload.resultExpiresAt, canParticipate: false, ...(payload.initiator ? { initiator: payload.initiator } : {}), ...(payload.message ? { message: payload.message } : {}) },
        resultToken, groupResultToken: resultToken, resultUrl, groupResultUrl: resultUrl,
        resultPage: empty, ...empty, stats: emptyStats, videoStats: await groupRepo.stats(key), total: 0,
      });
    }
    if (group.video_key !== key || group.created_at !== payload.createdAt || group.expires_at !== payload.expiresAt || group.result_expires_at !== payload.resultExpiresAt) return failure('INVALID_GROUP_ENTRY_TOKEN', '群组入口凭证无效');
    const video = (await groupRepo.videoMetadata(key)) ?? payload.video;
    const state = group.state === 'ended' ? 'ended' as const : group.expires_at <= now ? 'expired' as const : 'active' as const;
    const canParticipate = state === 'active';
    const resultPage = await groupRepo.resultsPage({ group, video, now, limit: GROUP_RESULTS_DEFAULT_LIMIT });
    const invitationToken = canParticipate ? await issueGroupInvitation(invitationPayload, env.APP_SIGNING_SECRET) : undefined;
    const invitationUrl = invitationToken ? `${publicOrigin(request, config)}/g/${encodeURIComponent(invitationToken)}` : undefined;
    return json({
      entry: { state, video, createdAt: group.created_at, expiresAt: group.expires_at, resultExpiresAt: group.result_expires_at, canParticipate, ...(payload.initiator ? { initiator: payload.initiator } : {}), ...(payload.message ? { message: payload.message } : {}) },
      ...(invitationToken ? { invitationToken, groupInvitationToken: invitationToken, invitationUrl, groupInvitationUrl: invitationUrl } : {}),
      resultToken, groupResultToken: resultToken, resultUrl, groupResultUrl: resultUrl,
      resultPage, results: resultPage.results, resultSummary: resultPage.summary, total: resultPage.summary.total,
      stats: await groupRepo.groupStats(payload.groupId, now), videoStats: await groupRepo.stats(key),
    });
  }
  if (url.pathname === '/api/groups/open' && request.method === 'POST') {
    const body = await readJson(request);
    if (!isRecord(body)) return failure('INVALID_INPUT', '缺少群组邀请凭证');
    const token = groupTokenFrom(body, ['groupInvitationToken', 'groupToken', 'challengeToken']);
    if (!token) return failure('INVALID_INPUT', '缺少群组邀请凭证');
    const payload = await readGroupInvitation(token, env.APP_SIGNING_SECRET, now);
    const resultExpiresAt = groupResultExpiry(payload);
    const key = videoKey(payload.video.bvid, payload.video.cid);
    const group = await groupRepo.ensure({ groupId: payload.groupId, videoKey: key, createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt, now });
    if (!group) return failure('GROUP_NOT_FOUND', '群组挑战不存在', 404);
    if (group.video_key !== key || group.created_at !== payload.createdAt || group.expires_at !== payload.expiresAt || group.result_expires_at !== resultExpiresAt) return failure('INVALID_GROUP_TOKEN', '群组邀请凭证无效');
    if (group.state === 'ended') return failure('GROUP_ENDED', '这个群组挑战已经结束', 410);
    await groupRepo.upsertVideo(key, payload.video, now);
    const resultToken = await issueGroupResult(groupResultPayload(payload, resultExpiresAt), env.APP_SIGNING_SECRET);
    const resultPage = await groupRepo.resultsPage({ group, video: payload.video, now, limit: GROUP_RESULTS_DEFAULT_LIMIT });
    return json({ challenge: payload, group: { ...payload, state: group.state }, playback: { ...(await resolveBilibili(payload.video.bvid, payload.video.page, config, env.BILIDIRECT_API_KEY)), danmakuUrl: `/api/danmaku?group=${encodeURIComponent(token)}` }, stats: await groupRepo.groupStats(payload.groupId, now), videoStats: await groupRepo.stats(key), resultPage, results: resultPage.results, resultSummary: resultPage.summary, total: resultPage.summary.total, resultToken, groupResultToken: resultToken, resultUrl: `${publicOrigin(request, config)}/g/results/${encodeURIComponent(resultToken)}`, groupResultUrl: `${publicOrigin(request, config)}/g/results/${encodeURIComponent(resultToken)}` });
  }
  if (url.pathname === '/api/groups/start' && request.method === 'POST') {
    const body = await readJson(request);
    if (!isRecord(body)) return failure('INVALID_INPUT', '群组参与信息不完整');
    const token = groupTokenFrom(body, ['groupInvitationToken', 'groupToken', 'challengeToken']);
    if (!token) return failure('INVALID_INPUT', '缺少群组邀请凭证');
    const payload = await readGroupInvitation(token, env.APP_SIGNING_SECRET, now);
    const resultExpiresAt = groupResultExpiry(payload);
    let nickname: string;
    try {
      nickname = decodeNickname(body.nickname);
    } catch (error) {
      if (error instanceof ContractError) return failure('INVALID_INPUT', error.message);
      throw error;
    }
    const key = videoKey(payload.video.bvid, payload.video.cid);
    const group = await groupRepo.ensure({ groupId: payload.groupId, videoKey: key, createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt, now });
    if (!group) return failure('GROUP_NOT_FOUND', '群组挑战不存在', 404);
    if (group.state === 'ended') return failure('GROUP_ENDED', '这个群组挑战已经结束', 410);
    await groupRepo.upsertVideo(key, payload.video, now);
    const attemptToken = randomToken(24);
    const attemptId = randomToken(18);
    const started = await groupRepo.start({ groupId: payload.groupId, attemptId, nickname, attemptHash: await sha256(attemptToken), now });
    if (started.status !== 'started') {
      if (started.status === 'ended') return failure('GROUP_ENDED', '这个群组挑战已经结束', 410);
      if (started.status === 'expired') return failure('GROUP_EXPIRED', '这个群组挑战已结束', 410);
      if (started.status === 'missing') return failure('GROUP_NOT_FOUND', '群组挑战不存在', 404);
      return failure('GROUP_START_CONFLICT', '暂时无法开始，请重试', 409);
    }
    return json({ attemptId, attemptToken, nickname });
  }
  if (url.pathname === '/api/groups/complete' && request.method === 'POST') {
    const body = await readJson(request, 48_000);
    if (!isRecord(body) || typeof body.attemptToken !== 'string') return failure('INVALID_INPUT', '结果信息不完整');
    const token = groupTokenFrom(body, ['groupInvitationToken', 'groupToken', 'challengeToken']);
    if (!token) return failure('INVALID_INPUT', '缺少群组邀请凭证');
    const payload = await readGroupInvitation(token, env.APP_SIGNING_SECRET, now);
    const resultExpiresAt = groupResultExpiry(payload);
    const outcome = decodeOutcome(body.outcome);
    const rawElapsed = Number(body.elapsedSeconds);
    if (!Number.isFinite(rawElapsed) || rawElapsed < 0 || rawElapsed > payload.video.duration + 3) return failure('INVALID_RESULT', '坚持时间不正确');
    // Validate the bounded client projection even though group results do not
    // expose or persist individual curves in this MVP.
    decodeScoreTrace(body.scoreTrace ?? [], payload.video.duration);
    const elapsed = outcome === 'held' ? payload.video.duration : Math.min(rawElapsed, payload.video.duration);
    const attemptTokenHash = await sha256(body.attemptToken);
    const suppliedAttemptId = typeof body.attemptId === 'string' ? body.attemptId : '';
    const attempt = suppliedAttemptId ? await groupRepo.getAttempt(suppliedAttemptId) : await groupRepo.findAttemptByHash(payload.groupId, attemptTokenHash);
    const attemptId = attempt?.attempt_id ?? suppliedAttemptId;
    if (!attemptId) return failure('INVALID_INPUT', '参与凭证不完整');
    if (!attempt || attempt.group_id !== payload.groupId) return failure('INVALID_GROUP_ATTEMPT', '本轮挑战凭证无效', 403);
    if (attempt.attempt_token_hash !== attemptTokenHash) return failure('INVALID_GROUP_ATTEMPT', '本轮挑战凭证无效', 403);
    const key = videoKey(payload.video.bvid, payload.video.cid);
    const group = await groupRepo.get(payload.groupId);
    if (!group || group.video_key !== key) return failure('GROUP_NOT_FOUND', '群组挑战不存在', 404);
    const completed = await groupRepo.complete({ attemptId, groupId: payload.groupId, outcome, elapsed, now, bucketSize: CLIENT_CONFIG.heatmapBucketSeconds });
    const row = completed.row ?? await groupRepo.getAttempt(attemptId);
    if (!row || row.state !== 'completed' || !row.outcome) return failure('GROUP_COMPLETE_CONFLICT', '结果提交冲突，请刷新后重试', 409);
    const resultToken = await issueGroupResult(groupResultPayload(payload, resultExpiresAt), env.APP_SIGNING_SECRET);
    const resultPage = await groupRepo.resultsPage({ group, video: payload.video, now, limit: GROUP_RESULTS_DEFAULT_LIMIT });
    return json({ outcome: row.outcome, elapsedSeconds: row.outcome === 'held' ? payload.video.duration : Number(row.failed_at_seconds ?? 0), result: groupResultView(row), resultToken, groupResultToken: resultToken, resultUrl: `${publicOrigin(request, config)}/g/results/${encodeURIComponent(resultToken)}`, groupResultUrl: `${publicOrigin(request, config)}/g/results/${encodeURIComponent(resultToken)}`, resultExpiresAt: group.result_expires_at, stats: await groupRepo.groupStats(payload.groupId, now), videoStats: await groupRepo.stats(key), resultPage, results: resultPage.results, resultSummary: resultPage.summary, total: resultPage.summary.total });
  }
  if (url.pathname === '/api/groups/results' && request.method === 'POST') {
    const body = await readJson(request);
    if (!isRecord(body)) return failure('INVALID_INPUT', '缺少群组结果凭证');
    const token = groupTokenFrom(body, ['groupResultToken', 'resultToken']);
    if (!token) return failure('INVALID_INPUT', '缺少群组结果凭证');
    const payload = await readGroupResult(token, env.APP_SIGNING_SECRET, now);
    const rawLimit = body.limit === undefined ? GROUP_RESULTS_DEFAULT_LIMIT : Number(body.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(GROUP_RESULTS_MAX_LIMIT, Math.floor(rawLimit))) : GROUP_RESULTS_DEFAULT_LIMIT;
    const cursor = typeof body.cursor === 'string' && body.cursor ? body.cursor : undefined;
    const key = videoKey(payload.video.bvid, payload.video.cid);
    const group = await groupRepo.get(payload.groupId);
    if (!group) {
      const empty = { state: 'unopened' as const, video: payload.video, createdAt: payload.createdAt, expiresAt: payload.expiresAt, resultExpiresAt: payload.resultExpiresAt, summary: { total: 0, held: 0, failed: 0 }, results: [] as GroupParticipantResult[] };
      return json({ resultPage: empty, ...empty, stats: { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0, buckets: [] }, total: 0 });
    }
    if (group.video_key !== key || group.result_expires_at !== payload.resultExpiresAt) return failure('INVALID_GROUP_RESULT_TOKEN', '群组结果凭证无效');
    const resultPage = await groupRepo.resultsPage({ group, video: (await groupRepo.videoMetadata(key)) ?? payload.video, now, limit, cursor });
    return json({ resultPage, ...resultPage, stats: await groupRepo.groupStats(payload.groupId, now), videoStats: await groupRepo.stats(key), total: resultPage.summary.total });
  }
  if (url.pathname === '/api/groups/manage' && (request.method === 'POST' || request.method === 'DELETE')) {
    const manageToken = bearer(request);
    const payload = await readGroupManage(manageToken, env.APP_SIGNING_SECRET);
    const resultExpiresAt = groupResultExpiry(payload);
    const key = videoKey(payload.video.bvid, payload.video.cid);
    if (request.method === 'DELETE') return json({ deleted: await groupRepo.destroy(payload.groupId, now, resultExpiresAt) });
    let action = url.searchParams.get('action');
    const length = Number(request.headers.get('Content-Length') || 0);
    if (!action && length > 0) {
      const body = await readJson(request);
      if (isRecord(body) && typeof body.action === 'string') action = body.action;
    }
    if (action === 'end') {
      await groupRepo.end(payload.groupId, now);
    }
    let current = await groupRepo.get(payload.groupId);
    if (current && current.result_expires_at <= now) {
      await groupRepo.destroy(payload.groupId);
      current = null;
    }
    if (!current) return json({ status: now >= resultExpiresAt ? 'expired' : now >= payload.expiresAt ? 'expired' : 'unopened', video: payload.video, expiresAt: payload.expiresAt, resultExpiresAt, summary: { total: 0, held: 0, failed: 0 } });
    const state = current.state === 'ended' ? 'ended' : current.expires_at <= now ? 'expired' : 'active';
    return json({ status: state, video: (await groupRepo.videoMetadata(key)) ?? payload.video, expiresAt: current.expires_at, resultExpiresAt: current.result_expires_at, endedAt: current.ended_at ?? undefined, summary: await groupRepo.resultSummary(payload.groupId, now) });
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
    const body=await readJson(request,48_000); if(!isRecord(body)||typeof body.challengeToken!=='string'||typeof body.attemptToken!=='string') return failure('INVALID_INPUT','结果信息不完整'); const payload=await readChallenge(body.challengeToken,env.APP_SIGNING_SECRET,now); const id=await challengeId(body.challengeToken); if(!await repo.attemptMatches(id,await sha256(body.attemptToken))) return failure('INVALID_ATTEMPT','本轮挑战凭证无效',403); const scoreTrace=decodeScoreTrace(body.scoreTrace??[],payload.video.duration);
    const outcome=decodeOutcome(body.outcome); const rawElapsed=Number(body.elapsedSeconds); if(!Number.isFinite(rawElapsed)||rawElapsed<0||rawElapsed>payload.video.duration+3) return failure('INVALID_RESULT','坚持时间不正确'); const elapsed=outcome==='held'?payload.video.duration:Math.min(rawElapsed,payload.video.duration); const expiresAt=now+config.resultTtlSeconds;
    const result=await repo.complete({id,outcome,elapsed,now,resultExpiresAt:expiresAt,bucketSize:CLIENT_CONFIG.heatmapBucketSeconds,scoreTrace}); const row=result.row??await repo.get(id); if(!row||row.state!=='completed'||!row.outcome) return failure('COMPLETE_CONFLICT','结果提交冲突，请刷新后重试',409);
    const reportPayload:ReportPayload={v:1,kind:'report',video:payload.video,outcome:row.outcome,elapsedSeconds:row.outcome==='held'?payload.video.duration:Number(row.failed_at_seconds??0),issuedAt:now,expiresAt:Number(row.result_expires_at??expiresAt),nonce:randomToken(12),resultRef:id,mode:payload.mode}; const reportToken=await issueReport(reportPayload,env.APP_SIGNING_SECRET); return json({outcome:reportPayload.outcome,elapsedSeconds:reportPayload.elapsedSeconds,reportUrl:`${publicOrigin(request, config)}/report/${encodeURIComponent(reportToken)}`,reportToken,stats:await repo.stats(videoKey(payload.video.bvid,payload.video.cid))});
  }
  if (url.pathname === '/api/manage/result' && request.method === 'POST') {
    const id=await readManage(bearer(request),env.APP_SIGNING_SECRET); const row=await repo.get(id); const expired=Boolean(row&&(row.state==='completed'?(row.result_expires_at??0)<=now:row.expires_at<=now)); if(expired)await repo.destroy(id);
    let result: ManageResult;
    if (expired) result={status:'expired'};
    else if (!row) result={status:'unopened'};
    else if (row.state !== 'completed') result={status:row.state};
    else {
      const [video,scoreTrace,stats]=await Promise.all([
        repo.videoMetadata(row.video_key),
        repo.scoreTrace(id,now,row.duration_seconds),
        repo.stats(row.video_key),
      ]);
      result={status:'completed',outcome:row.outcome??undefined,elapsedSeconds:row.outcome==='held'?row.duration_seconds:Number(row.failed_at_seconds??0),expiresAt:row.result_expires_at??undefined,video:video??undefined,scoreTrace,stats};
    }
    return json(result);
  }
  if (url.pathname === '/api/manage/result' && request.method === 'DELETE') { const id=await readManage(bearer(request),env.APP_SIGNING_SECRET); return json({deleted:await repo.destroy(id)}); }
  if (url.pathname === '/api/reports/resolve' && request.method === 'POST') { const body=await readJson(request); if(!isRecord(body)||typeof body.reportToken!=='string') return failure('INVALID_INPUT','缺少报告凭证'); const report=await readReport(body.reportToken,env.APP_SIGNING_SECRET,now); return json({report,scoreTrace:report.resultRef?await repo.scoreTrace(report.resultRef,now):[],stats:await repo.stats(videoKey(report.video.bvid,report.video.cid))}); }
  if (url.pathname === '/api/danmaku' && request.method === 'GET') {
    const groupToken = url.searchParams.get('group');
    if (groupToken) {
      const payload = await readGroupInvitation(groupToken, env.APP_SIGNING_SECRET, now);
      const xml = await fetchDanmaku(payload.video.cid, payload.video.bvid, config, env.BILIDIRECT_API_KEY);
      return new Response(xml, { headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' } });
    }
    const token = url.searchParams.get('challenge') || '';
    const payload = await readChallenge(token, env.APP_SIGNING_SECRET, now);
    const xml = await fetchDanmaku(payload.video.cid, payload.video.bvid, config, env.BILIDIRECT_API_KEY);
    return new Response(xml, { headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' } });
  }
  return failure('NOT_FOUND','接口不存在',404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) { try { const url=new URL(request.url); if(url.pathname.startsWith('/api/')) return await api(request,env,ctx); return secureAsset(await env.ASSETS.fetch(request)); } catch(error) { if(error instanceof CapabilityError||error instanceof ContractError) return failure(error.code,error.message,error.code.includes('EXPIRED')?410:400); if(error instanceof GroupRepositoryError) return failure(error.code,error.message,400); if(error instanceof UpstreamError) return failure('UPSTREAM_ERROR',error.message,error.status>=500?502:400); if(error instanceof SyntaxError) return failure('INVALID_JSON','请求内容不是有效 JSON'); if(error instanceof Error&&(error.message==='MISSING_AUTHORIZATION'||error.message==='REQUEST_TOO_LARGE')) return failure(error.message,error.message==='MISSING_AUTHORIZATION'?'缺少管理凭证':'请求内容过大',error.message==='MISSING_AUTHORIZATION'?401:413); console.error('worker_request_failed',{name:error instanceof Error?error.name:'unknown'}); return failure('INTERNAL_ERROR','服务暂时不可用',500); } },
  async scheduled(_controller: ScheduledController, env: Env) {
    const startedAt = Date.now();
    try {
      const now = nowSeconds();
      const [sessions, groups] = await Promise.all([
        new SessionRepository(env.DB).cleanup(now),
        new GroupRepository(env.DB).cleanup(now),
      ]);
      console.log('expired_records_cleaned', {
        durationMs: Math.max(0, Date.now() - startedAt),
        single: { traces: sessions.traceChanges, sessions: sessions.sessionChanges },
        group: { parents: groups.parentChanges, attempts: groups.attemptChanges, blocks: groups.blockChanges },
      });
    } catch (error) {
      console.error('expired_records_cleanup_failed', {
        durationMs: Math.max(0, Date.now() - startedAt),
        name: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
