import { describe,expect,it,vi } from 'vitest';
import worker from '../src/worker';
import { issueVideoTicket,readChallenge } from '../src/worker/capabilities/tokens';
import type { Env } from '../src/worker/config';

const secret='test-secret-that-is-longer-than-thirty-two-characters';
const video={source:'bilibili' as const,bvid:'BV1B7411m7LV',cid:12,page:1,title:'标题',description:'',cover:'',duration:60};
const env:Env={DB:{} as D1Database,ASSETS:{} as Fetcher,APP_SIGNING_SECRET:secret,BILIDIRECT_API_KEY:'test-api-key',BILIDIRECT_BASE_URL:'https://api.example.com'};
const context={waitUntil(){},passThroughOnException(){},props:{}} as unknown as ExecutionContext;
async function create(body:Record<string,unknown>){return worker.fetch(new Request('https://bomb.example/api/challenges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,context);}

describe('challenge creation modes',()=>{
  it('creates a nickname-free self challenge without storing classic private copy',async()=>{
    const now=Math.floor(Date.now()/1000);const videoTicket=await issueVideoTicket(video,now+60,secret);const response=await create({videoTicket,mode:'self',initiator:'should-not-be-signed',recipient:'friend',message:'private'});const envelope=await response.json() as {ok:true;data:{challengeToken:string}};
    expect(response.status).toBe(200);const payload=await readChallenge(envelope.data.challengeToken,secret,now);expect(payload.mode).toBe('self');expect(payload).not.toHaveProperty('initiator');expect(payload).not.toHaveProperty('recipient');expect(payload).not.toHaveProperty('message');
  });
  it('keeps classic nickname validation backward compatible',async()=>{const now=Math.floor(Date.now()/1000);const videoTicket=await issueVideoTicket(video,now+60,secret);expect((await create({videoTicket})).status).toBe(400);expect((await create({videoTicket,initiator:'小明'})).status).toBe(200);expect((await create({videoTicket,mode:'unknown'})).status).toBe(400);});
  it('uses the configured public origin instead of the request Host',async()=>{const now=Math.floor(Date.now()/1000);const videoTicket=await issueVideoTicket(video,now+60,secret);const response=await worker.fetch(new Request('https://attacker.example/api/challenges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoTicket,mode:'self'})}),{...env,PUBLIC_ORIGIN:'https://trusted.example'} as Env,context);const envelope=await response.json() as {ok:true;data:{challengeUrl:string;manageUrl:string}};expect(envelope.data.challengeUrl).toMatch(/^https:\/\/trusted\.example\/c\//);expect(envelope.data.manageUrl).toMatch(/^https:\/\/trusted\.example\/manage#/);});
  it('routes an allowlisted b23.tv short link through bilidirect and strips source diagnostics',async()=>{
    const fetchImpl=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(_input)).toBe('https://api.example.com/api/parse');
      expect(JSON.parse(String(init?.body))).toMatchObject({url:'https://b23.tv/7WpblY1',page:1});
      return new Response(JSON.stringify({ok:true,data:{bvid:'BV1B7411m7LV',cid:12,page:1,title:'短链视频',description:'',cover:'',duration:60,directUrl:'https://cdn.example/video.mp4',source:{resolvedUrl:'https://www.bilibili.com/video/BV1B7411m7LV'}}}),{status:200,headers:{'Content-Type':'application/json'}});
    });
    vi.stubGlobal('fetch',fetchImpl);
    try {
      const response=await worker.fetch(new Request('https://bomb.example/api/bilibili/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:'https://b23.tv/7WpblY1'})}),env,context);
      const envelope=await response.json() as {ok:true;data:{video:Record<string,unknown>;videoTicket:string}};
      expect(response.status).toBe(200);
      expect(envelope.data.video).toMatchObject({bvid:'BV1B7411m7LV',media:['https://cdn.example/video.mp4']});
      expect(envelope.data.video.source).toBe('bilibili');
      expect(JSON.stringify(envelope.data.video)).not.toContain('resolvedUrl');
      expect(envelope.data.videoTicket).toMatch(/^bv1\./);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
