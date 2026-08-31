import { describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from '../src/worker/security/rateLimit';
import { rateLimited } from '../src/worker/security/http';
import worker from '../src/worker/index';
import type { Env } from '../src/worker/config';

describe('rate limit guard', () => {
  it('uses a one-way request key and returns the binding decision', async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => {
      expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(key).not.toContain('203.0.113.8');
      return { success: false };
    });
    const allowed = await checkRateLimit({ limit }, new Request('https://bomb.example/api/challenges', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.8' } }), 'mutation');
    expect(allowed).toBe(false);
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it('fails open when the optional binding is unavailable or errors', async () => {
    const request = new Request('https://bomb.example/api/leaderboard');
    await expect(checkRateLimit(undefined, request, 'public-read')).resolves.toBe(true);
    await expect(checkRateLimit({ limit: async () => { throw new Error('binding unavailable'); } }, request, 'public-read')).resolves.toBe(true);
  });

  it('returns a retry hint with the standard error envelope', async () => {
    const response = rateLimited('请稍后再试', 10);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('10');
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', message: '请稍后再试' } });
  });

  it('short-circuits a mutation route with a 429 envelope', async () => {
    const env: Env = {
      APP_SIGNING_SECRET: 'a'.repeat(32),
      BILIDIRECT_API_KEY: 'key',
      BILIDIRECT_BASE_URL: 'https://parser.example.com',
      DB: {} as D1Database,
      ASSETS: {} as Fetcher,
      RATE_LIMITER_MUTATION: { limit: async () => ({ success: false }) },
    };
    const response = await worker.fetch(new Request('https://bomb.example/api/challenges', { method: 'POST' }), env, {} as ExecutionContext);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });
});
