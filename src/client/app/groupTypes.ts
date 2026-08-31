import { decodeVideoMetadata, isRecord } from '../../shared/contracts';
import type { AggregateStats, ChallengeMode, GroupManageResult, GroupResultSummary, Outcome, PlaybackData, ScorePoint, VideoMetadata } from '../../shared/contracts';

/**
 * Public group-result rows are deliberately a small client projection.  The
 * worker owns the authoritative decoder; this normalizer is the single
 * frontend boundary for the JSON response so views do not cast fields ad hoc.
 */
export interface GroupParticipant {
  attemptId?: string;
  nickname: string;
  outcome: Outcome;
  elapsedSeconds: number;
  failedAtSeconds?: number | null;
  completedAt?: number;
}

export interface GroupResultPage {
  participants: GroupParticipant[];
  nextCursor: string | null;
  total?: number;
  stats?: AggregateStats;
  video?: VideoMetadata;
  state?: 'unopened' | 'active' | 'ended' | 'expired';
  expiresAt?: number;
  resultExpiresAt?: number;
}

/** The common challenge projection rendered by ChallengeView for both modes. */
export interface ChallengeDisplayPayload {
  v: 1;
  kind: 'challenge' | 'group-invitation';
  video: VideoMetadata;
  initiator?: string;
  recipient?: string;
  message?: string;
  createdAt: number;
  expiresAt: number;
  nonce: string;
  mode: ChallengeMode;
}

export interface GroupOpened {
  challenge: ChallengeDisplayPayload;
  playback: PlaybackData;
  stats: AggregateStats;
  session: { state: 'opened' | 'started' | 'completed'; result_expires_at?: number | null } | null;
  group?: {
    groupId?: string;
    state?: 'unopened' | 'active' | 'ended' | 'expired';
    createdAt?: number;
    expiresAt?: number;
    resultExpiresAt?: number;
  };
  results?: GroupResultPage;
}

export interface GroupCreated {
  invitationUrl: string;
  resultUrl: string;
  entryUrl?: string;
  manageUrl?: string;
  expiresAt?: number;
  resultExpiresAt?: number;
}

export interface GroupEntryPage {
  state: 'unopened' | 'active' | 'ended' | 'expired';
  video: VideoMetadata;
  createdAt: number;
  expiresAt: number;
  resultExpiresAt: number;
  canParticipate: boolean;
  invitationUrl?: string;
  resultUrl: string;
  resultPage: GroupResultPage;
  initiator?: string;
  message?: string;
}

export interface GroupCompleted {
  outcome: Outcome;
  elapsedSeconds: number;
  resultUrl: string;
  stats: AggregateStats;
  participants: GroupParticipant[];
  nextCursor: string | null;
  total?: number;
  scoreTrace?: ReadonlyArray<Readonly<ScorePoint>>;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function outcome(value: unknown): Outcome | undefined {
  return value === 'held' || value === 'failed' ? value : undefined;
}

function decodeParticipant(value: unknown): GroupParticipant | null {
  if (!isRecord(value)) return null;
  const nickname = text(value.nickname ?? value.name);
  const result = outcome(value.outcome);
  const elapsedSeconds = Number(value.elapsedSeconds ?? value.elapsed ?? value.seconds);
  if (!nickname || !result || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return null;
  const failedAt = value.failedAtSeconds ?? value.failedAt ?? value.failed_at_seconds;
  return {
    ...(text(value.attemptId ?? value.id) ? { attemptId: text(value.attemptId ?? value.id) } : {}),
    nickname,
    outcome: result,
    elapsedSeconds,
    ...(failedAt === null || finite(failedAt) ? { failedAtSeconds: failedAt === null ? null : failedAt } : {}),
    ...(finite(value.completedAt ?? value.completed_at) ? { completedAt: Number(value.completedAt ?? value.completed_at) } : {}),
  };
}

function decodeStats(value: unknown): AggregateStats | undefined {
  if (!isRecord(value)) return undefined;
  const total = Number(value.total);
  const held = Number(value.held);
  const failed = Number(value.failed);
  const failureRate = Number(value.failureRate ?? value.failure_rate);
  const averageElapsedSeconds = Number(value.averageElapsedSeconds ?? value.average_elapsed_seconds);
  if (![total, held, failed, failureRate, averageElapsedSeconds].every(Number.isFinite)) return undefined;
  if (![total, held, failed].every((item) => Number.isInteger(item) && item >= 0)) return undefined;
  if (held + failed > total || failureRate < 0 || failureRate > 1 || averageElapsedSeconds < 0) return undefined;
  if (!Array.isArray(value.buckets)) return undefined;
  const buckets = value.buckets.flatMap((item) => {
    if (!isRecord(item)) return [];
    const startSeconds = Number(item.startSeconds ?? item.start_seconds);
    const count = Number(item.count);
    return Number.isFinite(startSeconds) && startSeconds >= 0 && Number.isInteger(count) && count >= 0
      ? [{ startSeconds, count }]
      : [];
  });
  return { total, held, failed, failureRate, averageElapsedSeconds, buckets };
}

function state(value: unknown): GroupResultPage['state'] {
  return value === 'unopened' || value === 'active' || value === 'ended' || value === 'expired' ? value : undefined;
}

function summary(value: unknown): GroupResultSummary | undefined {
  if (!isRecord(value)) return undefined;
  const total = Number(value.total);
  const held = Number(value.held);
  const failed = Number(value.failed);
  if (![total, held, failed].every((item) => Number.isInteger(item) && item >= 0) || held + failed > total) return undefined;
  return { total, held, failed };
}

function video(value: unknown): VideoMetadata | undefined {
  try {
    return decodeVideoMetadata(value);
  } catch {
    return undefined;
  }
}

function playback(value: unknown): PlaybackData | undefined {
  if (!isRecord(value) || !Array.isArray(value.media)) return undefined;
  const metadata = video(value);
  const media = value.media.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (!metadata || !media.length) return undefined;
  const danmakuUrl = text(value.danmakuUrl);
  return { ...metadata, media, ...(danmakuUrl ? { danmakuUrl } : {}) };
}

/** Keep wrapper metadata while normalizing legacy `result` array responses. */
function resultPageInput(value: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(value.result) && !Array.isArray(value.results)) return { ...value, results: value.result };
  return value;
}

function challengeDisplay(value: unknown): ChallengeDisplayPayload | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = video(value.video);
  const mode = value.mode === 'classic' || value.mode === 'self' || value.mode === 'group' ? value.mode : undefined;
  const kind = value.kind === 'challenge' || value.kind === 'group-invitation' ? value.kind : undefined;
  const createdAt = Number(value.createdAt ?? value.created_at);
  const expiresAt = Number(value.expiresAt ?? value.expires_at);
  const nonce = text(value.nonce);
  if (!metadata || !mode || !kind || !finite(createdAt) || !finite(expiresAt) || !nonce) return undefined;
  return {
    v: 1,
    kind,
    video: metadata,
    ...(text(value.initiator) ? { initiator: text(value.initiator) } : {}),
    ...(text(value.recipient) ? { recipient: text(value.recipient) } : {}),
    ...(text(value.message) ? { message: text(value.message) } : {}),
    createdAt,
    expiresAt,
    nonce,
    mode,
  };
}

function session(value: unknown): GroupOpened['session'] {
  if (!isRecord(value) || (value.state !== 'opened' && value.state !== 'started' && value.state !== 'completed')) return null;
  const expiresAt = value.result_expires_at;
  return {
    state: value.state,
    ...(expiresAt === null || finite(expiresAt) ? { result_expires_at: expiresAt as number | null } : {}),
  };
}

/** Decode a public results response (including the first page embedded in open/complete). */
export function normalizeGroupResults(value: unknown): GroupResultPage {
  const record = isRecord(value) ? value : {};
  const nestedPage = isRecord(record.resultPage) ? record.resultPage : isRecord(record.resultsPage) ? record.resultsPage : undefined;
  const pageRecord = nestedPage ?? record;
  const source = Array.isArray(pageRecord.participants)
    ? pageRecord.participants
    : Array.isArray(pageRecord.results)
      ? pageRecord.results
      : Array.isArray(pageRecord.entries)
        ? pageRecord.entries
        : [];
  const participants = source.flatMap((item) => {
    const decoded = decodeParticipant(item);
    return decoded ? [decoded] : [];
  });
  const cursor = pageRecord.nextCursor ?? pageRecord.next_cursor ?? pageRecord.cursor ?? record.nextCursor ?? record.next_cursor ?? record.cursor;
  const rawStats = decodeStats(record.stats ?? pageRecord.stats ?? record.summary ?? pageRecord.summary);
  const summary = isRecord(pageRecord.summary) ? pageRecord.summary : isRecord(record.summary) ? record.summary : undefined;
  const total = finite(record.total) ? Number(record.total) : summary && finite(summary.total) ? Number(summary.total) : undefined;
  const rawGroup = isRecord(pageRecord.group) ? pageRecord.group : pageRecord;
  const rawVideo = video(pageRecord.video ?? record.video ?? (isRecord(record.challenge) ? record.challenge.video : undefined));
  return {
    participants,
    nextCursor: typeof cursor === 'string' && cursor ? cursor : null,
    ...(total !== undefined ? { total } : {}),
    ...(rawStats ? { stats: rawStats } : {}),
    ...(rawVideo ? { video: rawVideo } : {}),
    ...(state(rawGroup.state) ? { state: state(rawGroup.state) } : {}),
    ...(finite(rawGroup.expiresAt ?? rawGroup.expires_at) ? { expiresAt: Number(rawGroup.expiresAt ?? rawGroup.expires_at) } : {}),
    ...(finite(rawGroup.resultExpiresAt ?? rawGroup.result_expires_at) ? { resultExpiresAt: Number(rawGroup.resultExpiresAt ?? rawGroup.result_expires_at) } : {}),
  };
}

/** Normalize the group open response and keep playback as the player contract. */
export function normalizeGroupOpen(value: unknown): GroupOpened {
  const record = isRecord(value) ? value : {};
  const sourceGroup = isRecord(record.group)
    ? record.group
    : isRecord(record.challenge)
      ? record.challenge
      : isRecord(record.payload)
        ? record.payload
        : undefined;
  const challenge = challengeDisplay(sourceGroup) ?? challengeDisplay(record.challenge);
  if (!challenge) throw new Error('群组挑战内容无效');
  const resolvedPlayback = playback(record.playback ?? record.video);
  if (!resolvedPlayback) throw new Error('群组播放信息无效');
  const stats = decodeStats(record.stats) ?? emptyStats();
  const resultPage = normalizeGroupResults(resultPageInput(record));
  const group = isRecord(record.group) ? record.group : {};
  return {
    challenge,
    playback: resolvedPlayback,
    stats,
    session: session(record.session),
    ...(Object.keys(group).length ? {
      group: {
        ...(text(group.groupId ?? group.group_id) ? { groupId: text(group.groupId ?? group.group_id) } : {}),
        ...(state(group.state) ? { state: state(group.state) } : {}),
        ...(finite(group.createdAt ?? group.created_at) ? { createdAt: Number(group.createdAt ?? group.created_at) } : {}),
        ...(finite(group.expiresAt ?? group.expires_at) ? { expiresAt: Number(group.expiresAt ?? group.expires_at) } : {}),
        ...(finite(group.resultExpiresAt ?? group.result_expires_at) ? { resultExpiresAt: Number(group.resultExpiresAt ?? group.result_expires_at) } : {}),
      },
    } : {}),
    ...(resultPage.participants.length || resultPage.stats || resultPage.video || resultPage.nextCursor ? { results: resultPage } : {}),
  };
}

export function normalizeGroupCreated(value: unknown): GroupCreated {
  const record = isRecord(value) ? value : {};
  const invitationUrl = text(record.invitationUrl ?? record.groupInvitationUrl ?? record.groupUrl ?? record.challengeUrl) ?? '';
  const resultUrl = text(record.resultUrl ?? record.groupResultUrl ?? record.resultsUrl) ?? '';
  return {
    invitationUrl,
    resultUrl,
    ...(text(record.entryUrl ?? record.groupEntryUrl) ? { entryUrl: text(record.entryUrl ?? record.groupEntryUrl) } : {}),
    ...(text(record.manageUrl) ? { manageUrl: text(record.manageUrl) } : {}),
    ...(finite(record.expiresAt ?? record.expires_at) ? { expiresAt: Number(record.expiresAt ?? record.expires_at) } : {}),
    ...(finite(record.resultExpiresAt ?? record.result_expires_at) ? { resultExpiresAt: Number(record.resultExpiresAt ?? record.result_expires_at) } : {}),
  };
}

/** Normalize the stateless group landing response before rendering actions. */
export function normalizeGroupEntry(value: unknown): GroupEntryPage {
  const record = isRecord(value) ? value : {};
  const rawEntry = isRecord(record.entry) ? record.entry : record;
  const metadata = video(rawEntry.video ?? record.video);
  const currentState = state(rawEntry.state ?? record.state);
  const createdAt = Number(rawEntry.createdAt ?? rawEntry.created_at);
  const expiresAt = Number(rawEntry.expiresAt ?? rawEntry.expires_at);
  const resultExpiresAt = Number(rawEntry.resultExpiresAt ?? rawEntry.result_expires_at);
  const resultUrl = text(record.resultUrl ?? record.groupResultUrl ?? record.resultsUrl) ?? '';
  if (!metadata || !currentState || !finite(createdAt) || !finite(expiresAt) || !finite(resultExpiresAt) || !resultUrl) throw new Error('群组入口内容无效');
  const resultPage = normalizeGroupResults(resultPageInput(record));
  return {
    state: currentState,
    video: metadata,
    createdAt,
    expiresAt,
    resultExpiresAt,
    canParticipate: rawEntry.canParticipate === true && currentState === 'active',
    ...(text(record.invitationUrl ?? record.groupInvitationUrl) ? { invitationUrl: text(record.invitationUrl ?? record.groupInvitationUrl) } : {}),
    resultUrl,
    resultPage,
    ...(text(rawEntry.initiator) ? { initiator: text(rawEntry.initiator) } : {}),
    ...(text(rawEntry.message) ? { message: text(rawEntry.message) } : {}),
  };
}

/** Normalize the private group management projection before rendering it. */
export function normalizeGroupManage(value: unknown): GroupManageResult {
  const record = isRecord(value) ? value : {};
  const status = state(record.status);
  const resultSummary = summary(record.summary ?? record.resultSummary);
  if (!status || !resultSummary) throw new Error('群组管理状态无效');
  const metadata = video(record.video);
  return {
    status,
    ...(metadata ? { video: metadata } : {}),
    ...(finite(record.expiresAt ?? record.expires_at) ? { expiresAt: Number(record.expiresAt ?? record.expires_at) } : {}),
    ...(finite(record.resultExpiresAt ?? record.result_expires_at) ? { resultExpiresAt: Number(record.resultExpiresAt ?? record.result_expires_at) } : {}),
    ...(finite(record.endedAt ?? record.ended_at) ? { endedAt: Number(record.endedAt ?? record.ended_at) } : {}),
    summary: resultSummary,
  };
}

export function normalizeGroupComplete(value: unknown): GroupCompleted {
  const record = isRecord(value) ? value : {};
  const page = normalizeGroupResults(resultPageInput(record));
  const result = outcome(record.outcome);
  if (!result) throw new Error('群组结果内容无效');
  const elapsedSeconds = Number(record.elapsedSeconds ?? record.elapsed ?? 0);
  const resultUrl = text(record.resultUrl ?? record.groupResultUrl ?? record.resultsUrl) ?? '';
  return {
    outcome: result,
    elapsedSeconds: Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0 ? elapsedSeconds : 0,
    resultUrl,
    stats: decodeStats(record.stats ?? record.summary) ?? page.stats ?? emptyStats(),
    participants: page.participants,
    nextCursor: page.nextCursor,
    ...(page.total !== undefined ? { total: page.total } : {}),
  };
}

export function emptyStats(): AggregateStats {
  return { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0, buckets: [] };
}
