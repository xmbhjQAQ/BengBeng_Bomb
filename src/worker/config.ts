export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_SIGNING_SECRET: string;
  BILIDIRECT_API_KEY: string;
  BILIDIRECT_BASE_URL: string;
  APP_ENV?: string;
  PUBLIC_ORIGIN?: string;
  CHALLENGE_TTL_HOURS?: string;
  RESULT_TTL_HOURS?: string;
  VIDEO_TICKET_TTL_MINUTES?: string;
  BILIBILI_QN?: string;
  LEADERBOARD_MIN_ATTEMPTS?: string;
  LEADERBOARD_CACHE_SECONDS?: string;
  LEADERBOARD_LIMIT?: string;
  BILIDIRECT_TIMEOUT_MS?: string;
  BILIDIRECT_MAX_RETRIES?: string;
  BILIDIRECT_JSON_MAX_BYTES?: string;
  BILIDIRECT_TEXT_MAX_BYTES?: string;
  RATE_LIMITER_EXPENSIVE?: RateLimit;
  RATE_LIMITER_MUTATION?: RateLimit;
  RATE_LIMITER_PUBLIC?: RateLimit;
}
export interface WorkerConfig { challengeTtlSeconds: number; resultTtlSeconds: number; ticketTtlSeconds: number; baseUrl: string; publicOrigin?: string; qn: number; leaderboardMinAttempts: number; leaderboardCacheSeconds: number; leaderboardLimit: number; upstreamTimeoutMs?: number; upstreamMaxRetries?: number; upstreamJsonMaxBytes?: number; upstreamTextMaxBytes?: number }
const bounded = (value: string | undefined, fallback: number, min: number, max: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; };
export function readConfig(env: Env): WorkerConfig {
  if (!env.APP_SIGNING_SECRET || env.APP_SIGNING_SECRET.length < 32) throw new Error('APP_SIGNING_SECRET must contain at least 32 characters');
  if (!env.BILIDIRECT_API_KEY || !env.BILIDIRECT_API_KEY.trim()) throw new Error('BILIDIRECT_API_KEY must be configured');
  let baseUrl: URL;
  try { baseUrl = new URL(env.BILIDIRECT_BASE_URL); } catch { throw new Error('BILIDIRECT_BASE_URL must be a valid URL'); }
  if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== '127.0.0.1' && baseUrl.hostname !== 'localhost') throw new Error('BILIDIRECT_BASE_URL must use HTTPS');
  let publicOrigin: string | undefined;
  if (env.PUBLIC_ORIGIN?.trim()) {
    let origin: URL;
    try { origin = new URL(env.PUBLIC_ORIGIN.trim()); } catch { throw new Error('PUBLIC_ORIGIN must be a valid URL'); }
    if ((origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost') || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path');
    publicOrigin = origin.origin;
  }
  const environment = env.APP_ENV?.trim().toLowerCase();
  if ((environment === 'staging' || environment === 'production') && !publicOrigin) throw new Error('PUBLIC_ORIGIN is required outside local development');
  return {
    challengeTtlSeconds: bounded(env.CHALLENGE_TTL_HOURS, 48, 1, 168) * 3600,
    resultTtlSeconds: bounded(env.RESULT_TTL_HOURS, 48, 1, 168) * 3600,
    ticketTtlSeconds: bounded(env.VIDEO_TICKET_TTL_MINUTES, 15, 1, 60) * 60,
    baseUrl: baseUrl.href.replace(/\/$/, ''),
    ...(publicOrigin ? { publicOrigin } : {}),
    qn: Math.round(bounded(env.BILIBILI_QN, 80, 16, 208)),
    leaderboardMinAttempts: Math.round(bounded(env.LEADERBOARD_MIN_ATTEMPTS, 5, 1, 1000)),
    leaderboardCacheSeconds: Math.round(bounded(env.LEADERBOARD_CACHE_SECONDS, 600, 30, 86_400)),
    leaderboardLimit: Math.round(bounded(env.LEADERBOARD_LIMIT, 20, 1, 100)),
    upstreamTimeoutMs: Math.round(bounded(env.BILIDIRECT_TIMEOUT_MS, 8_000, 1_000, 20_000)),
    // Keep retries bounded so a transient tunnel failure cannot fan out into unbounded subrequests.
    upstreamMaxRetries: Math.round(bounded(env.BILIDIRECT_MAX_RETRIES, 3, 0, 5)),
    upstreamJsonMaxBytes: Math.round(bounded(env.BILIDIRECT_JSON_MAX_BYTES, 512 * 1024, 16 * 1024, 2 * 1024 * 1024)),
    upstreamTextMaxBytes: Math.round(bounded(env.BILIDIRECT_TEXT_MAX_BYTES, 4 * 1024 * 1024, 64 * 1024, 8 * 1024 * 1024)),
  };
}
