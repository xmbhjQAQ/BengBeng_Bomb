import { sha256 } from '../capabilities/crypto';

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RateLimitKind = 'expensive' | 'mutation' | 'public-read';

const FALLBACK_WINDOW_MS = 60_000;
const FALLBACK_LIMITS: Record<RateLimitKind, number> = { expensive: 20, mutation: 60, 'public-read': 120 };
const fallbackBuckets = new Map<string, { count: number; resetAt: number }>();
let missingBindingLogged = false;

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
  const url = new URL(request.url);
  const key = await sha256(`${kind}:${request.method}:${url.pathname}:${clientAddress(request)}`);
  const fallback = () => {
    const now = Date.now();
    const current = fallbackBuckets.get(key);
    if (!current || current.resetAt <= now) {
      fallbackBuckets.set(key, { count: 1, resetAt: now + FALLBACK_WINDOW_MS });
    } else {
      current.count += 1;
      if (current.count > FALLBACK_LIMITS[kind]) return false;
    }
    if (fallbackBuckets.size > 5_000) {
      for (const [bucketKey, bucket] of fallbackBuckets) {
        if (bucket.resetAt <= now || fallbackBuckets.size > 4_500) fallbackBuckets.delete(bucketKey);
        if (fallbackBuckets.size <= 4_500) break;
      }
    }
    return true;
  };
  if (!binding) {
    if (!missingBindingLogged) {
      missingBindingLogged = true;
      console.warn('rate_limit_binding_missing_using_isolate_fallback');
    }
    return fallback();
  }
  try {
    const outcome = await binding.limit({ key });
    return outcome.success;
  } catch (error) {
    // Preserve some burst protection without spending D1 writes. This map is
    // isolate-local and deliberately is not presented as a global limit.
    console.error('rate_limit_check_failed', { kind, name: error instanceof Error ? error.name : 'unknown' });
    return fallback();
  }
}
