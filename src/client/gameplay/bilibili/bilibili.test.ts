import { describe, expect, it } from 'vitest';
import {
  buildParseUrl,
  extractBvid,
  formatCount,
  formatDuration,
  getBilibiliCoverCandidates,
  getBilibiliMediaCandidates,
  normalizeBilibiliAssetUrl,
  parseBilibiliInput,
  parseVideoByBvid,
} from './bilibili';

describe('Bilibili source helpers', () => {
  it('accepts supported video links and rejects unsupported share links', () => {
    expect(parseBilibiliInput('https://www.bilibili.com/video/BV1B7411m7LV').bvid)
      .toBe('BV1B7411m7LV');
    expect(extractBvid('bv1b7411m7lv')).toBe('BV1b7411m7lv');
    expect(() => parseBilibiliInput('https://b23.tv/7WpblY1'))
      .toThrow('暂不解析 b23.tv');
  });

  it('builds the configurable parse request', async () => {
    let request: { url: string; options: RequestInit } | undefined;
    const data = await parseVideoByBvid({
      bvid: 'BV1B7411m7LV',
      apiBaseUrl: 'https://bilidirect.example/',
      apiKey: 'secret',
      fetchImpl: async (url, options) => {
        request = { url: String(url), options: options ?? {} };
        return new Response(JSON.stringify({
          ok: true,
          data: { bvid: 'BV1B7411m7LV', directUrl: 'https://cdn.example/video.mp4' },
        }), { status: 200 });
      },
    });
    expect(data.directUrl).toBe('https://cdn.example/video.mp4');
    expect(request?.url).toBe('https://bilidirect.example/api/parse');
    expect(JSON.parse(String(request?.options.body))).toMatchObject({
      bvid: 'BV1B7411m7LV',
      key: 'secret',
    });
  });

  it('formats metadata for the UI', () => {
    expect(buildParseUrl('https://bilidirect.example/')).toBe('https://bilidirect.example/api/parse');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatCount(123456)).toBe('12万');
  });

  it('normalizes B站 assets and keeps a portrait dimension plus media fallbacks', async () => {
    expect(normalizeBilibiliAssetUrl('//i0.hdslb.com/cover.jpg'))
      .toBe('https://i0.hdslb.com/cover.jpg');
    expect(normalizeBilibiliAssetUrl('http://i0.hdslb.com/cover.jpg'))
      .toBe('https://i0.hdslb.com/cover.jpg');

    const data = await parseVideoByBvid({
      bvid: 'BV1B7411m7LV',
      apiBaseUrl: 'http://localhost:5173',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        data: {
      bvid: 'BV1B7411m7LV',
      cover: '//i0.hdslb.com/cover.jpg',
      pic: 'http://i0.hdslb.com/cover.jpg',
      directUrl: 'http://cdn.example/video.mp4',
          danmakuUrl: 'https://parser.example.com/api/danmaku?bvid=BV1B7411m7LV&cid=1',
      video: { pages: [{ page: 1, dimension: { width: 1080, height: 1920 } }] },
          playback: {
            durl: [{ url: 'https://cdn.example/backup.mp4', backup_url: ['https://cdn.example/backup-2.mp4'] }],
          },
        },
      }), { status: 200 }),
    });

    expect(data.cover).toBe('https://i0.hdslb.com/cover.jpg');
    expect(data.dimension).toEqual({ width: 1080, height: 1920 });
    expect(data.danmakuUrl).toBe(
      'http://localhost:5173/api/danmaku?bvid=BV1B7411m7LV&cid=1',
    );
    expect(getBilibiliCoverCandidates(data)).toEqual(['https://i0.hdslb.com/cover.jpg']);
    expect(getBilibiliMediaCandidates(data)).toEqual([
      'https://cdn.example/video.mp4',
      'https://cdn.example/backup.mp4',
      'https://cdn.example/backup-2.mp4',
    ]);
  });
});
