import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { json, secureAsset } from '../src/worker/security/http';

describe('HTTP security headers', () => {
  it('adds a restrictive browser policy without discarding asset cache metadata', async () => {
    const response = secureAsset(new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' },
    }));

    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    const policy = response.headers.get('Content-Security-Policy') || '';
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).not.toContain('clarity.ms');
    expect(policy).not.toContain('static.cloudflareinsights.com');
    const scriptSource = policy.match(/script-src [^;]+/)?.[0] || '';
    expect(scriptSource).not.toContain("'unsafe-inline'");
    expect(response.headers.get('Permissions-Policy')).toContain('camera=(self)');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(await response.text()).toBe('<!doctype html>');
  });

  it('prevents API responses from being cached', () => {
    expect(json({ ok: true }).headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps analytics scripts out of capability-bearing pages', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).not.toContain('clarity.ms');
    expect(html).not.toContain('cloudflareinsights.com');
    const response = secureAsset(new Response('<!doctype html>'));
    expect(response.headers.get('Content-Security-Policy')).not.toContain('https://');

    const pagesHeaders = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');
    expect(pagesHeaders).not.toContain('clarity.ms');
    expect(pagesHeaders).not.toContain('static.cloudflareinsights.com');
  });
});
