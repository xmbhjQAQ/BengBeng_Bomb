import { decodeVideoMetadata, isRecord, type PlaybackData, type VideoMetadata } from '../../shared/contracts';
import type { WorkerConfig } from '../config';

export class UpstreamError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
const supportedHosts=new Set(['bilibili.com','www.bilibili.com','m.bilibili.com']);
export function parseDirectBvid(input:string){const raw=input.trim();const exact=raw.match(/^BV[0-9A-Za-z]{10,}$/i);if(exact)return exact[0];let url:URL;try{url=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);}catch{throw new UpstreamError(400,'请粘贴有效的 B站视频链接');}if(url.hostname==='b23.tv'||url.hostname==='m.q.qq.com')throw new UpstreamError(400,'请打开短链后复制 bilibili.com/video/BV... 地址');if(!supportedHosts.has(url.hostname.toLowerCase()))throw new UpstreamError(400,'暂只支持 bilibili.com/video/BV... 直链');const match=url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10,})(?:\/|$)/i);if(!match)throw new UpstreamError(400,'链接中没有有效的 BV 号');return match[1]!;}
const secureUrl = (value: unknown) => { const raw = String(value ?? '').trim().replace(/^http:\/\//i, 'https://'); if (!raw) return ''; try { const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } };
const collectUrls = (value: unknown, output: string[]) => {
  if (typeof value === 'string') { const normalized = secureUrl(value); if (normalized) output.push(normalized); return; }
  if (Array.isArray(value)) { value.forEach((item) => collectUrls(item, output)); return; }
  if (!isRecord(value)) return;
  ['directUrl', 'url', 'baseUrl', 'base_url', 'backupUrl', 'backup_url', 'candidates', 'durl'].forEach((key) => collectUrls(value[key], output));
};
export async function resolveBilibili(bvid: string, page: number, config: WorkerConfig, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<PlaybackData> {
  if (!/^BV[0-9A-Za-z]{10,}$/i.test(bvid)) throw new UpstreamError(400, 'BV号格式不正确');
  const response = await fetchImpl(`${config.baseUrl}/api/parse`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(apiKey ? { 'X-API-Key': apiKey } : {}) }, body: JSON.stringify({ bvid, page, qn: config.qn, fnval: 0, fourk: 1, probe: 1 }) });
  let body: unknown; try { body = await response.json(); } catch { throw new UpstreamError(502, '解析服务返回了无法读取的数据'); }
  if (!response.ok || !isRecord(body) || body.ok === false || !isRecord(body.data)) throw new UpstreamError(response.status >= 400 ? response.status : 502, isRecord(body) && typeof body.message === 'string' ? body.message : '视频解析失败');
  const data = body.data;
  const videoObject = isRecord(data.video) ? data.video : {};
  const media: string[] = []; collectUrls(data.directUrl, media); collectUrls(data.playback, media); collectUrls(data.durl, media);
  if (!media.length) throw new UpstreamError(502, '暂时没有可播放的视频直链');
  const metadata: VideoMetadata = decodeVideoMetadata({ bvid: data.bvid ?? bvid, cid: data.cid, page: data.page ?? page, title: data.title ?? videoObject.title, description: data.description ?? videoObject.desc ?? '', cover: secureUrl(data.cover ?? data.pic ?? videoObject.pic), duration: data.duration ?? videoObject.duration });
  return { ...metadata, media: [...new Set(media)].slice(0, 8) };
}
export async function fetchDanmaku(cid: number, bvid: string, config: WorkerConfig, apiKey: string, fetchImpl: typeof fetch = fetch) {
  const url = new URL(`${config.baseUrl}/api/danmaku`); url.searchParams.set('cid', String(cid)); url.searchParams.set('bvid', bvid);
  const response = await fetchImpl(url, { headers: { Accept: 'text/xml', ...(apiKey ? { 'X-API-Key': apiKey } : {}) } });
  if (!response.ok) throw new UpstreamError(response.status, '弹幕加载失败');
  return response.text();
}
