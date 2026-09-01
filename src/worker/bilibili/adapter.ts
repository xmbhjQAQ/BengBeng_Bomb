import { decodeVideoMetadata, isRecord, type PlaybackData, type VideoMetadata } from '../../shared/contracts';
import type { WorkerConfig } from '../config';

export class UpstreamError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_JSON_MAX_BYTES = 512 * 1024;
const DEFAULT_TEXT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_UPSTREAM_MAX_RETRIES = 3;
const MAX_CONFIGURED_UPSTREAM_RETRIES = 5;
const supportedHosts=new Set(['bilibili.com','www.bilibili.com','m.bilibili.com']);
export function parseDirectBvid(input:string){const raw=input.trim();const exact=raw.match(/^BV[0-9A-Za-z]{10,}$/i);if(exact)return exact[0];let url:URL;try{url=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);}catch{throw new UpstreamError(400,'请粘贴有效的 B 站视频链接。');}if(url.hostname==='b23.tv'||url.hostname==='m.q.qq.com')throw new UpstreamError(400,'请先打开分享短链，再复制 B 站视频页面地址。');if(!supportedHosts.has(url.hostname.toLowerCase()))throw new UpstreamError(400,'这个链接暂时不支持，请粘贴 B 站视频页面地址。');const match=url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10,})(?:\/|$)/i);if(!match)throw new UpstreamError(400,'链接里没有找到视频，请检查后重试。');return match[1]!;}
const secureUrl = (value: unknown) => { const raw = String(value ?? '').trim().replace(/^http:\/\//i, 'https://'); if (!raw) return ''; try { const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } };
const collectUrls = (value: unknown, output: string[]) => {
  if (typeof value === 'string') { const normalized = secureUrl(value); if (normalized) output.push(normalized); return; }
  if (Array.isArray(value)) { value.forEach((item) => collectUrls(item, output)); return; }
  if (!isRecord(value)) return;
  ['directUrl', 'url', 'baseUrl', 'base_url', 'backupUrl', 'backup_url', 'candidates', 'durl'].forEach((key) => collectUrls(value[key], output));
};
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) throw new UpstreamError(504, '视频服务响应超时，请稍后重试。');
    throw new UpstreamError(502, '视频服务暂时无法连接，请稍后重试。');
  } finally {
    clearTimeout(timeout);
  }
}
type Sleep = (milliseconds: number) => Promise<void>;
const RETRYABLE_UPSTREAM_STATUSES = new Set([502, 503, 504]);
const UPSTREAM_RETRY_DELAY_MS = 150;
const sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isRetryableTransportError = (error: unknown): error is UpstreamError => error instanceof UpstreamError && RETRYABLE_UPSTREAM_STATUSES.has(error.status);

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Releasing a failed upstream response is best effort and must not mask its status.
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  maxRetries: number,
  fetchImpl: typeof fetch,
  sleepImpl: Sleep,
) {
  const deadline = Date.now() + timeoutMs;
  let lastRetryableError: UpstreamError | undefined;
  let lastRetryableResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      if (lastRetryableError) throw lastRetryableError;
      if (lastRetryableResponse) return lastRetryableResponse;
      throw new UpstreamError(504, '视频服务响应超时，请稍后重试。');
    }

    try {
      const response = await fetchWithTimeout(input, init, remainingMs, fetchImpl);
      if (!RETRYABLE_UPSTREAM_STATUSES.has(response.status) || attempt === maxRetries) return response;
      lastRetryableResponse = response;
      await cancelResponseBody(response);
      const waitMs = deadline - Date.now();
      if (waitMs <= UPSTREAM_RETRY_DELAY_MS) return response;
      await sleepImpl(UPSTREAM_RETRY_DELAY_MS);
    } catch (error) {
      if (!isRetryableTransportError(error) || attempt === maxRetries) throw error;
      lastRetryableError = error;
      const waitMs = deadline - Date.now();
      if (waitMs <= UPSTREAM_RETRY_DELAY_MS) throw error;
      await sleepImpl(UPSTREAM_RETRY_DELAY_MS);
    }
  }

  if (lastRetryableError) throw lastRetryableError;
  if (lastRetryableResponse) return lastRetryableResponse;
  throw new UpstreamError(504, '视频服务响应超时，请稍后重试。');
}
async function readLimitedText(response: Response, maximumBytes: number) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maximumBytes) throw new UpstreamError(502, '视频服务返回内容过大，请稍后重试。');
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new UpstreamError(502, '视频服务返回内容过大，请稍后重试。');
    return new TextDecoder().decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new UpstreamError(502, '视频服务返回内容过大，请稍后重试。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
const timeoutFor = (config: WorkerConfig) => config.upstreamTimeoutMs ?? DEFAULT_TIMEOUT_MS;
const retriesFor = (config: WorkerConfig) => {
  const configured = config.upstreamMaxRetries ?? DEFAULT_UPSTREAM_MAX_RETRIES;
  return Number.isFinite(configured) ? Math.min(MAX_CONFIGURED_UPSTREAM_RETRIES, Math.max(0, Math.round(configured))) : DEFAULT_UPSTREAM_MAX_RETRIES;
};
const jsonLimitFor = (config: WorkerConfig) => config.upstreamJsonMaxBytes ?? DEFAULT_JSON_MAX_BYTES;
const textLimitFor = (config: WorkerConfig) => config.upstreamTextMaxBytes ?? DEFAULT_TEXT_MAX_BYTES;
export async function resolveBilibili(bvid: string, page: number, config: WorkerConfig, apiKey: string, fetchImpl: typeof fetch = fetch, sleepImpl: Sleep = sleep): Promise<PlaybackData> {
  if (!/^BV[0-9A-Za-z]{10,}$/i.test(bvid)) throw new UpstreamError(400, '视频编号格式不正确，请检查链接后重试。');
  const response = await fetchWithRetry(`${config.baseUrl}/api/parse`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(apiKey ? { 'X-API-Key': apiKey } : {}) }, body: JSON.stringify({ bvid, page, qn: config.qn, fnval: 0, fourk: 1, probe: 1 }) }, timeoutFor(config), retriesFor(config), fetchImpl, sleepImpl);
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new UpstreamError(response.status, '视频解析失败，请稍后重试。');
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('json')) {
    await cancelResponseBody(response);
    throw new UpstreamError(502, '视频服务返回格式异常，请稍后重试。');
  }
  let body: unknown; try { body = JSON.parse(await readLimitedText(response, jsonLimitFor(config))); } catch (error) { await cancelResponseBody(response); if (error instanceof UpstreamError) throw error; throw new UpstreamError(502, '视频服务暂时没有响应，请稍后重试。'); }
  if (!response.ok || !isRecord(body) || body.ok === false || !isRecord(body.data)) throw new UpstreamError(response.status >= 400 ? response.status : 502, '视频解析失败，请稍后重试。');
  const data = body.data;
  const videoObject = isRecord(data.video) ? data.video : {};
  const media: string[] = []; collectUrls(data.directUrl, media); collectUrls(data.playback, media); collectUrls(data.durl, media);
  if (!media.length) throw new UpstreamError(502, '视频暂时无法播放，请稍后重试。');
  const metadata: VideoMetadata = decodeVideoMetadata({ bvid: data.bvid ?? bvid, cid: data.cid, page: data.page ?? page, title: data.title ?? videoObject.title, description: data.description ?? videoObject.desc ?? '', cover: secureUrl(data.cover ?? data.pic ?? videoObject.pic), duration: data.duration ?? videoObject.duration });
  return { ...metadata, media: [...new Set(media)].slice(0, 8) };
}
export async function fetchDanmaku(cid: number, bvid: string, config: WorkerConfig, apiKey: string, fetchImpl: typeof fetch = fetch, sleepImpl: Sleep = sleep) {
  const url = new URL(`${config.baseUrl}/api/danmaku`); url.searchParams.set('cid', String(cid)); url.searchParams.set('bvid', bvid);
  const response = await fetchWithRetry(url, { headers: { Accept: 'text/xml', ...(apiKey ? { 'X-API-Key': apiKey } : {}) } }, timeoutFor(config), retriesFor(config), fetchImpl, sleepImpl);
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new UpstreamError(response.status, '弹幕加载失败');
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('text/') && !contentType.includes('xml')) {
    await cancelResponseBody(response);
    throw new UpstreamError(502, '弹幕服务返回格式异常，请稍后重试。');
  }
  try { return await readLimitedText(response, textLimitFor(config)); } catch (error) { await cancelResponseBody(response); if (error instanceof UpstreamError) throw error; throw new UpstreamError(502, '弹幕加载失败'); }
}
