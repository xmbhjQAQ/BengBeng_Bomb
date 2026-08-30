import { describe,expect,it } from 'vitest';
import { readConfig, type Env } from '../src/worker/config';
const env=(extra:Partial<Env>={}):Env=>({APP_SIGNING_SECRET:'a'.repeat(32),BILIDIRECT_API_KEY:'',BILIDIRECT_BASE_URL:'https://api.example.com',DB:{} as D1Database,ASSETS:{} as Fetcher,...extra});
describe('worker config',()=>{it('uses editable 48-hour defaults',()=>{expect(readConfig(env())).toMatchObject({challengeTtlSeconds:172800,resultTtlSeconds:172800});});it('accepts deployment overrides without a rebuild',()=>{expect(readConfig(env({CHALLENGE_TTL_HOURS:'24',RESULT_TTL_HOURS:'72'}))).toMatchObject({challengeTtlSeconds:86400,resultTtlSeconds:259200});});it('rejects weak signing secrets',()=>{expect(()=>readConfig(env({APP_SIGNING_SECRET:'short'}))).toThrow(/32/);});});
