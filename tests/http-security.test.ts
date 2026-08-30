import { describe, expect, it } from 'vitest';
import { json, secureAsset } from '../src/worker/security/http';

describe('HTTP security headers', () => {
  it('adds a restrictive browser policy without discarding asset cache metadata', async () => {
    const response = secureAsset(new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' },
    }));

    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(response.headers.get('Permissions-Policy')).toContain('camera=(self)');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(await response.text()).toBe('<!doctype html>');
  });

  it('prevents API responses from being cached', () => {
    expect(json({ ok: true }).headers.get('Cache-Control')).toBe('no-store');
  });
});
