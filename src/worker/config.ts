export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_SIGNING_SECRET: string;
  BILIDIRECT_API_KEY: string;
  BILIDIRECT_BASE_URL: string;
  CHALLENGE_TTL_HOURS?: string;
  RESULT_TTL_HOURS?: string;
  VIDEO_TICKET_TTL_MINUTES?: string;
  BILIBILI_QN?: string;
  LEADERBOARD_MIN_ATTEMPTS?: string;
  LEADERBOARD_CACHE_SECONDS?: string;
  LEADERBOARD_LIMIT?: string;
  ALLOWED_ORIGIN?: string;
}
export interface WorkerConfig { challengeTtlSeconds: number; resultTtlSeconds: number; ticketTtlSeconds: number; baseUrl: string; qn: number; leaderboardMinAttempts: number; leaderboardCacheSeconds: number; leaderboardLimit: number }
const bounded = (value: string | undefined, fallback: number, min: number, max: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; };
export function readConfig(env: Env): WorkerConfig {
  if (!env.APP_SIGNING_SECRET || env.APP_SIGNING_SECRET.length < 32) throw new Error('APP_SIGNING_SECRET must contain at least 32 characters');
  const baseUrl = new URL(env.BILIDIRECT_BASE_URL);
  if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== '127.0.0.1' && baseUrl.hostname !== 'localhost') throw new Error('BILIDIRECT_BASE_URL must use HTTPS');
  return {
    challengeTtlSeconds: bounded(env.CHALLENGE_TTL_HOURS, 48, 1, 168) * 3600,
    resultTtlSeconds: bounded(env.RESULT_TTL_HOURS, 48, 1, 168) * 3600,
    ticketTtlSeconds: bounded(env.VIDEO_TICKET_TTL_MINUTES, 15, 1, 60) * 60,
    baseUrl: baseUrl.href.replace(/\/$/, ''),
    qn: Math.round(bounded(env.BILIBILI_QN, 80, 16, 208)),
    leaderboardMinAttempts: Math.round(bounded(env.LEADERBOARD_MIN_ATTEMPTS, 5, 1, 1000)),
    leaderboardCacheSeconds: Math.round(bounded(env.LEADERBOARD_CACHE_SECONDS, 600, 30, 86_400)),
    leaderboardLimit: Math.round(bounded(env.LEADERBOARD_LIMIT, 20, 1, 100)),
  };
}
