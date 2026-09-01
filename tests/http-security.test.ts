import { createHash } from 'node:crypto';
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
    expect(policy).toContain("'sha256-93xNr/MlEvYlP8zOTmO8OBWTETRYkVg3e0itq85nxGQ='");
    expect(policy).toContain('https://www.clarity.ms');
    expect(policy).toContain('https://scripts.clarity.ms');
    expect(policy).toContain('https://static.cloudflareinsights.com');
    const scriptSource = policy.match(/script-src [^;]+/)?.[0] || '';
    expect(scriptSource).not.toContain("'unsafe-inline'");
    expect(response.headers.get('Permissions-Policy')).toContain('camera=(self)');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(await response.text()).toBe('<!doctype html>');
  });

  it('prevents API responses from being cached', () => {
    expect(json({ ok: true }).headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps the Clarity CSP hash synchronized with the HTML bootstrap', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const bootstrap = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)?.[1];
    expect(bootstrap).toBeTruthy();
    const hash = createHash('sha256').update(bootstrap || '', 'utf8').digest('base64');
    const response = secureAsset(new Response('<!doctype html>'));
    expect(response.headers.get('Content-Security-Policy')).toContain(`'sha256-${hash}'`);

    const pagesHeaders = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');
    expect(pagesHeaders).toContain(`'sha256-${hash}'`);
    expect(pagesHeaders).toContain('https://www.clarity.ms');
    expect(pagesHeaders).toContain('https://scripts.clarity.ms');
    expect(pagesHeaders).toContain('https://static.cloudflareinsights.com');
  });
});
