import { decodeChallengePayload, decodeReportPayload, decodeVideoMetadata, isRecord, type ChallengePayload, type ReportPayload, type VideoMetadata } from '../../shared/contracts';
import { base64UrlEncode, canonicalJson, decodeText, randomToken, sha256, sign, verify } from './crypto';

export class CapabilityError extends Error { constructor(public readonly code: string, message: string) { super(message); } }
async function encode(prefix: string, domain: string, payload: unknown, secret: string) { const body = base64UrlEncode(canonicalJson(payload)); return `${prefix}.${body}.${await sign(secret, domain, body)}`; }
async function decode(token: string, prefix: string, domain: string, secret: string): Promise<unknown> {
  const parts = token.split('.'); if (parts.length !== 3 || parts[0] !== prefix) throw new CapabilityError('INVALID_TOKEN', '凭证格式不正确');
  if (!await verify(secret, domain, parts[1]!, parts[2]!)) throw new CapabilityError('INVALID_TOKEN', '凭证无效或已被修改');
  try { return JSON.parse(decodeText(parts[1]!)); } catch { throw new CapabilityError('INVALID_TOKEN', '凭证内容无法读取'); }
}
const ensureFresh = (expiresAt: number, now: number) => { if (expiresAt <= now) throw new CapabilityError('TOKEN_EXPIRED', '凭证已过期'); };
export const issueChallenge = (payload: ChallengePayload, secret: string) => encode('bc1', 'challenge:v1', decodeChallengePayload(payload), secret);
export async function readChallenge(token: string, secret: string, now = Math.floor(Date.now() / 1000)) { const payload = decodeChallengePayload(await decode(token, 'bc1', 'challenge:v1', secret)); ensureFresh(payload.expiresAt, now); return payload; }
export async function challengeId(token: string) { return (await sha256(token)).slice(0, 32); }
export async function issueManage(id: string, secret: string) { return `bm1.${id}.${await sign(secret, 'manage:v1', id)}`; }
export async function readManage(token: string, secret: string) { const [prefix, id, signature] = token.split('.'); if (prefix !== 'bm1' || !id || !signature || !await verify(secret, 'manage:v1', id, signature)) throw new CapabilityError('INVALID_MANAGE_TOKEN', '管理凭证无效'); return id; }
export interface VideoTicket { v: 1; kind: 'video'; video: VideoMetadata; expiresAt: number; nonce: string }
export const issueVideoTicket = (video: VideoMetadata, expiresAt: number, secret: string) => encode('bv1', 'video:v1', { v: 1, kind: 'video', video: decodeVideoMetadata(video), expiresAt, nonce: randomToken(12) }, secret);
export async function readVideoTicket(token: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<VideoTicket> { const value = await decode(token, 'bv1', 'video:v1', secret); if (!isRecord(value) || value.v !== 1 || value.kind !== 'video' || !isRecord(value.video) || typeof value.expiresAt !== 'number' || typeof value.nonce !== 'string') throw new CapabilityError('INVALID_TOKEN', '视频凭证格式不正确'); ensureFresh(value.expiresAt, now); return { v:1,kind:'video',video:decodeVideoMetadata(value.video),expiresAt:value.expiresAt,nonce:value.nonce }; }
export const issueReport = (payload: ReportPayload, secret: string) => encode('br1', 'report:v1', decodeReportPayload(payload), secret);
export async function readReport(token: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<ReportPayload> { const value = decodeReportPayload(await decode(token, 'br1', 'report:v1', secret)); ensureFresh(value.expiresAt, now); return value; }
