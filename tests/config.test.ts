import { describe,expect,it } from 'vitest';
import { readConfig, type Env } from '../src/worker/config';
const env=(extra:Partial<Env>={}):Env=>({APP_SIGNING_SECRET:'a'.repeat(32),BILIDIRECT_API_KEY:'test-api-key',BILIDIRECT_BASE_URL:'https://api.example.com',DB:{} as D1Database,ASSETS:{} as Fetcher,...extra});
describe('worker config',()=>{
  it('uses editable 48-hour and leaderboard defaults',()=>{expect(readConfig(env())).toMatchObject({challengeTtlSeconds:172800,resultTtlSeconds:172800,leaderboardMinAttempts:5,leaderboardCacheSeconds:600,leaderboardLimit:20,upstreamMaxRetries:3});});
  it('accepts deployment overrides without a rebuild',()=>{expect(readConfig(env({CHALLENGE_TTL_HOURS:'24',RESULT_TTL_HOURS:'72',LEADERBOARD_MIN_ATTEMPTS:'9',LEADERBOARD_CACHE_SECONDS:'120',LEADERBOARD_LIMIT:'30',BILIDIRECT_MAX_RETRIES:'4'}))).toMatchObject({challengeTtlSeconds:86400,resultTtlSeconds:259200,leaderboardMinAttempts:9,leaderboardCacheSeconds:120,leaderboardLimit:30,upstreamMaxRetries:4});});
  it('bounds upstream timeout and response limits',()=>{expect(readConfig(env())).toMatchObject({upstreamTimeoutMs:8000,upstreamJsonMaxBytes:524288,upstreamTextMaxBytes:4194304});expect(readConfig(env({BILIDIRECT_TIMEOUT_MS:'1',BILIDIRECT_JSON_MAX_BYTES:'1',BILIDIRECT_TEXT_MAX_BYTES:'999999999'}))).toMatchObject({upstreamTimeoutMs:1000,upstreamJsonMaxBytes:16384,upstreamTextMaxBytes:8388608});});
  it('bounds upstream retry overrides and allows disabling retries',()=>{expect(readConfig(env({BILIDIRECT_MAX_RETRIES:'0'})).upstreamMaxRetries).toBe(0);expect(readConfig(env({BILIDIRECT_MAX_RETRIES:'99'})).upstreamMaxRetries).toBe(5);expect(readConfig(env({BILIDIRECT_MAX_RETRIES:'not-a-number'})).upstreamMaxRetries).toBe(3);});
  it('bounds unsafe leaderboard overrides',()=>{expect(readConfig(env({LEADERBOARD_MIN_ATTEMPTS:'0',LEADERBOARD_CACHE_SECONDS:'999999',LEADERBOARD_LIMIT:'1000'}))).toMatchObject({leaderboardMinAttempts:1,leaderboardCacheSeconds:86400,leaderboardLimit:100});});
  it('rejects an empty upstream API key and malformed public origin',()=>{
    expect(() => readConfig(env({ BILIDIRECT_API_KEY: '' }))).toThrow(/BILIDIRECT_API_KEY/);
    expect(() => readConfig(env({ BILIDIRECT_BASE_URL: 'not a url' }))).toThrow(/BILIDIRECT_BASE_URL/);
    expect(() => readConfig(env({ APP_ENV: 'production' }))).toThrow(/PUBLIC_ORIGIN/);
    expect(() => readConfig(env({ PUBLIC_ORIGIN: 'https://example.com/path' }))).toThrow(/PUBLIC_ORIGIN/);
    expect(readConfig(env({ PUBLIC_ORIGIN: 'https://bomb.example' })).publicOrigin).toBe('https://bomb.example');
  });
  it('rejects weak signing secrets',()=>{expect(()=>readConfig(env({APP_SIGNING_SECRET:'short'}))).toThrow(/32/);});
});
