import { SCORE_TRACE_MAX_POINTS, type ChallengeMode, type ChallengePayload, type Outcome, type ReportPayload, type ScorePoint, type VideoMetadata } from './types';
import { CLIENT_CONFIG } from '../config/client';

export class ContractError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown, name: string, max: number, required = true) => {
  if (typeof value !== 'string') throw new ContractError('INVALID_FIELD', `${name}格式不正确`);
  const normalized = value.trim();
  if (required && !normalized) throw new ContractError('INVALID_FIELD', `请填写${name}`);
  if (normalized.length > max) throw new ContractError('FIELD_TOO_LONG', `${name}不能超过${max}字`);
  return normalized;
};
const positive = (value: unknown, name: string) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new ContractError('INVALID_FIELD', `${name}格式不正确`);
  return number;
};
export function decodeVideoMetadata(value: unknown): VideoMetadata {
  if (!isRecord(value)) throw new ContractError('INVALID_VIDEO', '视频信息格式不正确');
  const bvid = text(value.bvid, 'BV号', 24);
  if (!/^BV[0-9A-Za-z]{10,}$/i.test(bvid)) throw new ContractError('INVALID_VIDEO', 'BV号格式不正确');
  return { source: 'bilibili', bvid, cid: Math.round(positive(value.cid, 'CID')), page: Math.round(positive(value.page ?? 1, '分P')), title: text(value.title, '标题', CLIENT_CONFIG.limits.title), description: text(value.description ?? '', '简介', CLIENT_CONFIG.limits.description, false), cover: text(value.cover ?? '', '封面', 1000, false), duration: positive(value.duration, '时长') };
}
export function decodeChallengePayload(value: unknown): ChallengePayload {
  if (!isRecord(value) || value.v !== 1 || value.kind !== 'challenge') throw new ContractError('INVALID_TOKEN', '挑战凭证格式不正确');
  const createdAt = positive(value.createdAt, '创建时间');
  const expiresAt = positive(value.expiresAt, '过期时间');
  if (expiresAt <= createdAt) throw new ContractError('INVALID_TOKEN', '挑战有效期不正确');
  const mode: ChallengeMode | null = value.mode === undefined || value.mode === 'classic' ? 'classic' : value.mode === 'self' ? 'self' : null;
  if (!mode) throw new ContractError('INVALID_FIELD', '挑战模式不正确');
  const common = { v: 1 as const, kind: 'challenge' as const, video: decodeVideoMetadata(value.video), createdAt, expiresAt, nonce: text(value.nonce, '随机标识', 80), mode };
  if (mode === 'self') return common;
  return { ...common, initiator: text(value.initiator, '昵称', CLIENT_CONFIG.limits.nickname), recipient: value.recipient ? text(value.recipient, '接收者', CLIENT_CONFIG.limits.recipient) : undefined, message: value.message ? text(value.message, '留言', CLIENT_CONFIG.limits.message) : undefined };
}
export function decodeOutcome(value: unknown): Outcome {
  if (value !== 'held' && value !== 'failed') throw new ContractError('INVALID_OUTCOME', '结果格式不正确');
  return value;
}

export function decodeScoreTrace(value: unknown, durationSeconds: number, maximumPoints = SCORE_TRACE_MAX_POINTS): ScorePoint[] {
  if (!Array.isArray(value)) throw new ContractError('INVALID_SCORE_TRACE', '表情曲线格式不正确');
  if (value.length > maximumPoints) throw new ContractError('SCORE_TRACE_TOO_LARGE', `表情曲线不能超过${maximumPoints}个采样点`);
  let previousTime = -1;
  return value.map((point) => {
    if (!isRecord(point)) throw new ContractError('INVALID_SCORE_TRACE', '表情曲线采样点格式不正确');
    if (typeof point.timeSeconds !== 'number' || typeof point.score !== 'number') throw new ContractError('INVALID_SCORE_TRACE', '表情曲线采样点不正确');
    const timeSeconds = point.timeSeconds;
    const score = point.score;
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > durationSeconds || timeSeconds <= previousTime || !Number.isInteger(score) || score < 0 || score > 100) {
      throw new ContractError('INVALID_SCORE_TRACE', '表情曲线采样点不正确');
    }
    previousTime = timeSeconds;
    return { timeSeconds, score };
  });
}

export function decodeReportPayload(value: unknown): ReportPayload {
  if (!isRecord(value) || value.v !== 1 || value.kind !== 'report') throw new ContractError('INVALID_REPORT_TOKEN', '报告凭证格式不正确');
  const issuedAt = positive(value.issuedAt, '签发时间');
  const expiresAt = positive(value.expiresAt, '过期时间');
  if (expiresAt <= issuedAt) throw new ContractError('INVALID_REPORT_TOKEN', '报告有效期不正确');
  const mode = value.mode === undefined || value.mode === 'classic' ? value.mode : value.mode === 'self' ? 'self' : null;
  if (mode === null) throw new ContractError('INVALID_REPORT_TOKEN', '挑战模式不正确');
  const resultRef = value.resultRef === undefined ? undefined : text(value.resultRef, '结果引用', 80);
  const elapsedSeconds = Number(value.elapsedSeconds);
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new ContractError('INVALID_REPORT_TOKEN', '坚持时间不正确');
  return { v: 1, kind: 'report', video: decodeVideoMetadata(value.video), outcome: decodeOutcome(value.outcome), elapsedSeconds, issuedAt, expiresAt, nonce: text(value.nonce, '随机标识', 80), ...(resultRef ? { resultRef } : {}), ...(mode ? { mode } : {}) };
}
