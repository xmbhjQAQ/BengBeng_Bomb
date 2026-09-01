export const DEFAULT_API_BASE_URL = '';
export const DEFAULT_API_KEY = '';
export const BVID_PATTERN = /BV[0-9A-Za-z]{10,}/i;
const VIDEO_REQUEST_TIMEOUT_MS = 15_000;

const QQ_SHARE_HOST = 'm.q.qq.com';
const BILIBILI_VIDEO_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com']);
const isB23Host = (hostname: string) => hostname === 'b23.tv' || hostname.endsWith('.b23.tv');

export class BilibiliInputError extends Error {
  readonly code: string;

  constructor(message: string, code = 'INVALID_INPUT') {
    super(message);
    this.name = 'BilibiliInputError';
    this.code = code;
  }
}

export class BilibiliApiError extends Error {
  readonly status: number;
  readonly code: number | string;
  readonly details: unknown;

  constructor(
    message: string,
    options: { status?: number; code?: number | string; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'BilibiliApiError';
    this.status = options.status ?? 0;
    this.code = options.code ?? 0;
    this.details = options.details;
  }
}

export interface BilibiliVideoData {
  bvid: string;
  aid?: number;
  cid?: number;
  page?: number;
  title: string;
  description?: string;
  cover?: string;
  pic?: string;
  view?: number;
  playCount?: number;
  duration?: number;
  dimension?: BilibiliVideoDimension;
  directUrl: string;
  streamType?: string;
  format?: string | null;
  quality?: number | null;
  danmakuUrl?: string;
  danmukuUrl?: string;
  danmakuSourceUrl?: string;
  danmaku?: { url?: string; sourceUrl?: string; format?: string; cid?: number };
  [key: string]: unknown;
}

export interface BilibiliVideoDimension {
  width: number;
  height: number;
  rotate?: number;
}

const addProtocol = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

const normalizeBvid = (value: string) => `BV${value.slice(2)}`;

/**
 * B站 occasionally returns protocol-relative or http asset URLs.  The demo is
 * normally served over HTTPS, so keeping those URLs unchanged would result in
 * mixed-content blocks on both desktop and mobile browsers.
 */
export function normalizeBilibiliAssetUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^http:\/\//i.test(raw)) return `https://${raw.slice('http://'.length)}`;
  return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readDimension(value: unknown): BilibiliVideoDimension | undefined {
  if (!isRecord(value)) return undefined;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  const rotate = Number(value.rotate);
  return Number.isFinite(rotate) ? { width, height, rotate } : { width, height };
}

function dimensionFromResponse(value: unknown, page: number): BilibiliVideoDimension | undefined {
  if (!isRecord(value)) return undefined;
  const direct = readDimension(value.dimension);
  if (direct) return direct;

  const video = isRecord(value.video) ? value.video : undefined;
  const nested = readDimension(video?.dimension);
  if (nested) return nested;
  const pages = Array.isArray(video?.pages) ? video.pages : [];
  const selectedPage = pages.find((item) => isRecord(item) && Number(item.page) === page);
  return readDimension(isRecord(selectedPage) ? selectedPage.dimension : undefined);
}

function collectUrl(value: unknown, output: string[]) {
  if (typeof value === 'string' && value.trim()) output.push(normalizeBilibiliAssetUrl(value));
}

function collectMediaEntry(value: unknown, output: string[]) {
  if (!isRecord(value)) return;
  collectUrl(value.url, output);
  collectUrl(value.baseUrl, output);
  collectUrl(value.base_url, output);
  for (const key of ['backup_url', 'backupUrl', 'backup_url_list']) {
    const backup = value[key];
    if (Array.isArray(backup)) backup.forEach((item) => collectUrl(item, output));
    else collectUrl(backup, output);
  }
}

export function getBilibiliCoverCandidates(data: Pick<BilibiliVideoData, 'cover' | 'pic'>): string[] {
  return [...new Set([data.cover, data.pic].map(normalizeBilibiliAssetUrl).filter(Boolean))];
}

/**
 * Keep the fallback URLs returned by the parser available to the browser. A
 * signed CDN URL can expire or fail at one edge even when another durl works.
 */
export function getBilibiliMediaCandidates(data: BilibiliVideoData): string[] {
  const output: string[] = [];
  collectUrl(data.directUrl, output);
  const playback = isRecord(data.playback) ? data.playback : undefined;
  collectUrl(playback?.directUrl, output);
  const entries = [
    ...(Array.isArray(data.durl) ? data.durl : []),
    ...(Array.isArray(playback?.durl) ? playback.durl : []),
  ];
  entries.forEach((entry) => collectMediaEntry(entry, output));
  if (Array.isArray(playback?.candidates)) {
    playback.candidates.forEach((entry) => collectMediaEntry(entry, output));
  }
  return [...new Set(output.filter(Boolean))];
}

export function extractBvid(value: unknown): string | null {
  const match = String(value ?? '').match(BVID_PATTERN);
  return match ? normalizeBvid(match[0]) : null;
}

function parseUrl(value: string): URL {
  try {
    return new URL(addProtocol(value));
  } catch {
    throw new BilibiliInputError('这不是有效的链接，请检查后再试。');
  }
}

function isQqShareUrl(url: URL) {
  return url.hostname.toLowerCase() === QQ_SHARE_HOST && /^\/a\/s\//i.test(url.pathname);
}

export type ParsedBilibiliInput =
  | { kind: 'bvid'; bvid: string; raw: string }
  | { kind: 'url'; url: string; raw: string; bvid?: string };

function normalizeInputUrl(url: URL) {
  const normalized = new URL(url.href);
  normalized.protocol = 'https:';
  normalized.hash = '';
  return normalized.href;
}

export function parseBilibiliInput(input: unknown): ParsedBilibiliInput {
  const raw = String(input ?? '').trim();
  if (!raw) throw new BilibiliInputError('请先粘贴一个 B 站视频链接。');
  const exact = raw.match(/^BV[0-9A-Za-z]{10,}$/i);
  if (exact) return { kind: 'bvid', bvid: exact[0], raw };

  const url = parseUrl(raw);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BilibiliInputError('这个链接暂时不支持，请粘贴 B 站视频页面或 b23.tv 短链接。');
  }
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new BilibiliInputError('这个链接暂时不支持，请粘贴 B 站视频页面或 b23.tv 短链接。');
  }
  if (BILIBILI_VIDEO_HOSTS.has(hostname) && /^\/video\//i.test(url.pathname)) {
    const directBvid = extractBvid(url.pathname);
    if (directBvid) return { kind: 'url', url: normalizeInputUrl(url), bvid: directBvid, raw };
  }
  if (isB23Host(hostname)) {
    if (url.pathname === '/' || !url.pathname) {
      throw new BilibiliInputError('链接里没有找到视频，请检查后重试。');
    }
    return { kind: 'url', url: normalizeInputUrl(url), raw };
  }
  if (isQqShareUrl(url)) {
    throw new BilibiliInputError(
      '请先打开分享内容，再复制对应的 B 站视频页面地址。',
      'UNSUPPORTED_QQ_SHARE',
    );
  }
  throw new BilibiliInputError('这个地址暂时无法使用，请粘贴 B 站视频页面或 b23.tv 短链接。');
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  try {
    const value = apiBaseUrl || DEFAULT_API_BASE_URL;
    const url = /^https?:\/\//i.test(value)
      ? new URL(value)
      : typeof window !== 'undefined'
        ? new URL(value, window.location.origin)
        : null;
    if (!url) throw new Error('relative URL needs a browser origin');
    return url.href.replace(/\/$/, '');
  } catch {
    throw new BilibiliApiError('视频服务暂时不可用，请稍后重试。');
  }
}

function normalizeDanmakuApiUrl(value: unknown, apiBaseUrl: string): string {
  const raw = normalizeBilibiliAssetUrl(value);
  if (!raw) return '';
  try {
    const apiOrigin = new URL(normalizeApiBaseUrl(apiBaseUrl)).origin;
    const url = new URL(raw, apiOrigin);
    if (url.pathname !== '/api/danmaku') return raw;
    const sameOriginUrl = new URL('/api/danmaku', apiOrigin);
    sameOriginUrl.search = url.search;
    return sameOriginUrl.href;
  } catch {
    return raw;
  }
}

export function buildParseUrl(apiBaseUrl = DEFAULT_API_BASE_URL) {
  return `${normalizeApiBaseUrl(apiBaseUrl)}/api/parse`;
}

const toPositiveInteger = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

interface ParseVideoOptions {
  page?: number;
  qn?: number;
  apiBaseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

type ParseVideoInput = string | ParsedBilibiliInput;

async function parseVideo(options: ParseVideoOptions & { input: ParseVideoInput }): Promise<BilibiliVideoData> {
  const {
    input,
    page = 1,
    qn = 80,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    apiKey = '',
    fetchImpl = globalThis.fetch,
    signal,
  } = options;
  let parsed: ParsedBilibiliInput;
  try {
    parsed = typeof input === 'string'
      ? parseBilibiliInput(input)
      : input.kind === 'bvid'
        ? parseBilibiliInput(input.bvid)
        : parseBilibiliInput(input.url);
  } catch (error) {
    if (error instanceof BilibiliInputError) throw error;
    throw new BilibiliInputError('这段视频链接无法识别，请重新选择。');
  }
  if (typeof fetchImpl !== 'function') throw new BilibiliApiError('当前浏览器无法连接视频服务，请稍后重试。');

  const requestedPage = toPositiveInteger(page, 1);
  const payload: Record<string, unknown> = {
    ...(parsed.kind === 'bvid' || parsed.bvid ? { bvid: parsed.bvid } : { url: parsed.url }),
    page: requestedPage,
    qn: toPositiveInteger(qn, 80),
    fnval: 0,
    fourk: 1,
    probe: 1,
  };
  if (String(apiKey).trim()) payload.key = String(apiKey).trim();

  const requestController = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, VIDEO_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => requestController.abort();
  if (signal) {
    if (signal.aborted) requestController.abort();
    else signal.addEventListener('abort', abortFromCaller, { once: true });
  }
  let response: Response;
  try {
    response = await fetchImpl(buildParseUrl(apiBaseUrl), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      signal: requestController.signal,
    });
    if (timedOut) throw new BilibiliApiError('视频服务响应有点慢，请稍后重试。');
    if (requestController.signal.aborted) throw new BilibiliApiError('请求已取消。');
  } catch (error) {
    if (error instanceof BilibiliApiError) throw error;
    if (timedOut) throw new BilibiliApiError('视频服务响应有点慢，请稍后重试。');
    if (signal?.aborted) throw new BilibiliApiError('请求已取消。');
    throw new BilibiliApiError('暂时无法连接视频服务，请检查网络后重试。');
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  let body: { ok?: boolean; message?: string; code?: number; data?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new BilibiliApiError('视频服务暂时没有响应，请稍后重试。', {
      status: response.status,
    });
  }

  if (!response.ok || body?.ok === false) {
    throw new BilibiliApiError('视频解析失败，请稍后重试。', {
      status: response.status,
      code: body?.code,
    });
  }
  const envelopeData = body?.data;
  const candidateVideo = isRecord(envelopeData) && isRecord(envelopeData.video)
    ? envelopeData.video
    : null;
  const workerMedia = candidateVideo && Array.isArray(candidateVideo.media)
    ? candidateVideo.media
    : null;
  const workerVideo = candidateVideo?.source === 'bilibili' && workerMedia ? candidateVideo : null;
  const data = workerVideo
    ? { ...workerVideo, directUrl: workerMedia![0], playback: { candidates: workerMedia } }
    : envelopeData;
  if (!data || typeof data !== 'object') {
    throw new BilibiliApiError('没有找到可用的视频信息，请稍后重试。', { status: response.status });
  }
  const typedData = data as Partial<BilibiliVideoData>;
  if (typeof typedData.directUrl !== 'string' || !typedData.directUrl) {
    throw new BilibiliApiError('视频暂时无法播放，请稍后重试。', {
      status: response.status,
    });
  }
  // bilidirect exposes `source` as diagnostics for URL resolution. Keep the
  // direct-player result on the stable video contract too; the resolved URL is
  // not user-facing state and must not be carried into later projections.
  const safeData = { ...typedData };
  delete safeData.source;
  const responseBvid = typeof typedData.bvid === 'string' && /^BV[0-9A-Za-z]{10,}$/i.test(typedData.bvid.trim())
    ? extractBvid(typedData.bvid.trim())
    : null;
  const stableBvid = responseBvid || parsed.bvid || null;
  if (!stableBvid) {
    throw new BilibiliApiError('视频服务返回内容异常，请稍后重试。', {
      status: response.status,
    });
  }
  const normalizedCover = normalizeBilibiliAssetUrl(typedData.cover);
  const normalizedPic = normalizeBilibiliAssetUrl(typedData.pic);
  const danmakuRecord = isRecord(typedData.danmaku) ? typedData.danmaku : undefined;
  const rawDanmakuUrl = typedData.danmakuUrl || typedData.danmukuUrl || danmakuRecord?.url;
  const normalizedDanmakuUrl = normalizeDanmakuApiUrl(rawDanmakuUrl, apiBaseUrl);
  return {
    ...safeData,
    bvid: stableBvid,
    title: typedData.title || '',
    cover: normalizedCover || normalizedPic || undefined,
    pic: normalizedPic || normalizedCover || undefined,
    dimension: dimensionFromResponse(typedData, requestedPage),
    danmakuUrl: normalizedDanmakuUrl || undefined,
    danmukuUrl: normalizedDanmakuUrl || undefined,
    danmaku: danmakuRecord
      ? { ...danmakuRecord, url: normalizedDanmakuUrl || danmakuRecord.url }
      : typedData.danmaku,
    directUrl: normalizeBilibiliAssetUrl(typedData.directUrl),
  } as BilibiliVideoData;
}

/**
 * Parse a Bilibili page or an allowlisted b23.tv short link for the legacy
 * direct-player path. The browser never follows the short-link redirect; the
 * bilidirect service resolves it server-side.
 */
export async function parseVideoByInput(options: ParseVideoOptions & { input: ParseVideoInput }): Promise<BilibiliVideoData> {
  return parseVideo(options);
}

/** Keep the old BV-only API for callers that already have a canonical id. */
export async function parseVideoByBvid(options: ParseVideoOptions & { bvid: string }): Promise<BilibiliVideoData> {
  const normalizedBvid = extractBvid(options.bvid);
  if (!normalizedBvid) throw new BilibiliInputError('这段视频链接无法识别，请重新选择。');
  return parseVideo({ ...options, input: normalizedBvid });
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatCount(value: number) {
  const count = Number(value) || 0;
  if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
  return new Intl.NumberFormat('zh-CN').format(count);
}
