import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';

describe('apiRequest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns an HTML or otherwise non-JSON response into a friendly message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 502 })));

    await expect(apiRequest('/api/bilibili/parse')).rejects.toThrow('服务暂时无法响应，请稍后重试。');
  });

  it('turns a network failure into a friendly message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await expect(apiRequest('/api/bilibili/parse')).rejects.toThrow('暂时无法连接服务，请检查网络后重试。');
  });

  it('hides capability terminology from ordinary pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { code: 'INVALID_TOKEN', message: '挑战凭证格式不正确' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })));

    await expect(apiRequest('/api/challenges/open')).rejects.toThrow('这个挑战链接无效，请重新打开或让发起者重新生成。');
  });

  it('keeps actionable parser copy while removing BV terminology', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { code: 'INVALID_INPUT', message: '请粘贴 B站 BV 视频链接' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })));

    await expect(apiRequest('/api/bilibili/parse')).rejects.toThrow('请粘贴有效的 B 站视频页面地址。');
  });
});
