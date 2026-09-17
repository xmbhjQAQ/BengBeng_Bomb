import type { ApiEnvelope } from '../../shared/contracts';

const baseSecurityHeaders: Record<string, string> = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()' };
const securityHeaders: Record<string, string> = { ...baseSecurityHeaders, 'Cache-Control': 'no-store' };
// Capability tokens live in route paths and the management URL fragment.
// Keep third-party scripts out of every page so they cannot read those URLs.
const contentSecurityPolicy = ["default-src 'self'","base-uri 'self'","object-src 'none'","frame-ancestors 'none'","form-action 'self'","script-src 'self' 'wasm-unsafe-eval'","style-src 'self' 'unsafe-inline'","img-src 'self' https: data: blob:","media-src https: blob:","connect-src 'self' https:"].join('; ');
export function json<T>(data: T, status = 200) { return new Response(JSON.stringify({ ok: true, data } satisfies ApiEnvelope<T>), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' } }); }
export function publicJson<T>(data: T, maximumAgeSeconds: number) { return new Response(JSON.stringify({ ok: true, data } satisfies ApiEnvelope<T>), { headers: { ...baseSecurityHeaders, 'Cache-Control': `public, max-age=${maximumAgeSeconds}`, 'Content-Type': 'application/json; charset=utf-8' } }); }
export function failure(code: string, message: string, status = 400) { return new Response(JSON.stringify({ ok: false, error: { code, message } } satisfies ApiEnvelope<never>), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' } }); }
export function rateLimited(message = '请求太频繁，请稍后再试。', retryAfterSeconds = 60) { return new Response(JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message } } satisfies ApiEnvelope<never>), { status: 429, headers: { ...securityHeaders, 'Retry-After': String(Math.max(1, Math.round(retryAfterSeconds))), 'Content-Type': 'application/json; charset=utf-8' } }); }
export async function readJson(request: Request, maximumBytes = 20_000): Promise<unknown> {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > maximumBytes) throw new Error('REQUEST_TOO_LARGE');
  if (!request.body) return JSON.parse('');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('REQUEST_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function bearer(request: Request) { const value = request.headers.get('Authorization') || ''; if (!value.startsWith('Bearer ')) throw new Error('MISSING_AUTHORIZATION'); return value.slice(7); }
export function secureAsset(response:Response){const headers=new Headers(response.headers);for(const [name,value] of Object.entries(baseSecurityHeaders))headers.set(name,value);headers.set('Content-Security-Policy',contentSecurityPolicy);return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}
