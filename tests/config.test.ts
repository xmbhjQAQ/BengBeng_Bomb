import { describe,expect,it } from 'vitest';
import { readConfig, type Env } from '../src/worker/config';
const env=(extra:Partial<Env>={}):Env=>({APP_SIGNING_SECRET:'a'.repeat(32),BILIDIRECT_API_KEY:'',BILIDIRECT_BASE_URL:'https://api.example.com',DB:{} as D1Database,ASSETS:{} as Fetcher,...extra});
describe('worker config',()=>{
  it('uses editable 48-hour and leaderboard defaults',()=>{expect(readConfig(env())).toMatchObject({challengeTtlSeconds:172800,resultTtlSeconds:172800,leaderboardMinAttempts:5,leaderboardCacheSeconds:600,leaderboardLimit:20});});
  it('accepts deployment overrides without a rebuild',()=>{expect(readConfig(env({CHALLENGE_TTL_HOURS:'24',RESULT_TTL_HOURS:'72',LEADERBOARD_MIN_ATTEMPTS:'9',LEADERBOARD_CACHE_SECONDS:'120',LEADERBOARD_LIMIT:'30'}))).toMatchObject({challengeTtlSeconds:86400,resultTtlSeconds:259200,leaderboardMinAttempts:9,leaderboardCacheSeconds:120,leaderboardLimit:30});});
  it('bounds unsafe leaderboard overrides',()=>{expect(readConfig(env({LEADERBOARD_MIN_ATTEMPTS:'0',LEADERBOARD_CACHE_SECONDS:'999999',LEADERBOARD_LIMIT:'1000'}))).toMatchObject({leaderboardMinAttempts:1,leaderboardCacheSeconds:86400,leaderboardLimit:100});});
  it('rejects weak signing secrets',()=>{expect(()=>readConfig(env({APP_SIGNING_SECRET:'short'}))).toThrow(/32/);});
});
