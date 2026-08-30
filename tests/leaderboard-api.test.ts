import { afterEach,describe,expect,it,vi } from 'vitest';
import worker from '../src/worker';
import type { Env } from '../src/worker/config';

class LeaderboardStatement {
  args:unknown[]=[];
  constructor(private readonly db:LeaderboardD1,readonly query:string){}
  bind(...args:unknown[]){this.args=args;return this;}
  async all<T>(){this.db.calls+=1;this.db.lastArgs=this.args;return {results:this.db.rows as T[]};}
}
class LeaderboardD1 {
  calls=0;lastArgs:unknown[]=[];lastQuery='';
  rows=[{video_key:'BV1B7411m7LV:12',bvid:'BV1B7411m7LV',cid:12,page:1,title:'难绷视频',cover:'https://i.example/cover.jpg',duration_seconds:100,total:10,held:2,failed:8,cumulative_elapsed_seconds:250,last_completed_at:99,difficulty_score:78.5}];
  prepare(query:string){this.lastQuery=query;return new LeaderboardStatement(this,query);}
}
class MemoryCache {
  value:Response|null=null;
  async match(){return this.value?.clone();}
  async put(_request:Request,response:Response){this.value=response.clone();}
}
const env=(db:LeaderboardD1):Env=>({DB:db as unknown as D1Database,ASSETS:{} as Fetcher,APP_SIGNING_SECRET:'a'.repeat(32),BILIDIRECT_API_KEY:'',BILIDIRECT_BASE_URL:'https://api.example.com'});
const context=()=>({waitUntil(promise:Promise<unknown>){void promise;},passThroughOnException(){},props:{}} as unknown as ExecutionContext);

describe('GET /api/leaderboard',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('uses the configured threshold/limit and serves a public cache hit without another D1 query',async()=>{
    const db=new LeaderboardD1();const cache=new MemoryCache();vi.stubGlobal('caches',{default:cache});
    const request=new Request('https://bomb.example/api/leaderboard');
    const first=await worker.fetch(request,env(db),context());const firstBody=await first.json() as {ok:boolean;data:{entries:Array<{difficultyScore:number;averageElapsedRatio:number}>}};
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=600');expect(firstBody.data.entries[0]).toMatchObject({difficultyScore:78.5,averageElapsedRatio:0.25});expect(db.lastArgs).toEqual([5,20]);
    expect(db.lastQuery).toMatch(/ROUND\(100\.0\*\(0\.7/);expect(db.lastQuery).toContain('ORDER BY difficulty_score DESC,s.total DESC,s.last_completed_at DESC,s.video_key ASC');
    const second=await worker.fetch(request,env(db),context());expect(second.status).toBe(200);expect(db.calls).toBe(1);
  });
  it('falls back to D1 when Cache API is unavailable',async()=>{vi.stubGlobal('caches',undefined);const db=new LeaderboardD1();const response=await worker.fetch(new Request('https://bomb.example/api/leaderboard'),env(db),context());expect(response.status).toBe(200);expect(db.calls).toBe(1);});
});
