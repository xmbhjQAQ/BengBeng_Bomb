import { sha256 } from '../capabilities/crypto';

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RateLimitKind = 'expensive' | 'mutation' | 'public-read';

function clientAddress(request: Request): string {
  const cloudflare = request.headers.get('CF-Connecting-IP')?.trim();
  if (cloudflare) return cloudflare.slice(0, 128);
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  return forwarded ? forwarded.slice(0, 128) : 'anonymous';
}

export async function checkRateLimit(
  binding: RateLimitBinding | undefined,
  request: Request,
  kind: RateLimitKind,
): Promise<boolean> {
  if (!binding) return true;
  const url = new URL(request.url);
  const key = await sha256(`${kind}:${request.method}:${url.pathname}:${clientAddress(request)}`);
  try {
    const outcome = await binding.limit({ key });
    return outcome.success;
  } catch (error) {
    // A limiter outage must not turn a normal challenge into a blank page. The
    // binding itself remains the first line of defence; the request is allowed
    // through while the failure is observable without logging the IP or token.
    console.error('rate_limit_check_failed', { kind, name: error instanceof Error ? error.name : 'unknown' });
    return true;
  }
}
