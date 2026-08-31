import { describe,expect,it,vi } from 'vitest';
import { fetchDanmaku, parseDirectBvid, resolveBilibili } from '../src/worker/bilibili/adapter';
import type { WorkerConfig } from '../src/worker/config';

const config:WorkerConfig={challengeTtlSeconds:172800,resultTtlSeconds:172800,ticketTtlSeconds:900,baseUrl:'https://parser.example.com',qn:80,leaderboardMinAttempts:5,leaderboardCacheSeconds:600,leaderboardLimit:20};
describe('bilidirect Worker adapter',()=>{it('keeps the API key server-side and returns sanitized CDN candidates',async()=>{const fetchImpl=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{expect(new Headers(init?.headers).get('X-API-Key')).toBe('server-only-key');return new Response(JSON.stringify({ok:true,data:{bvid:'BV1B7411m7LV',cid:123,page:1,title:'测试',description:'简介',cover:'http://i.example/cover.jpg',duration:60,directUrl:'http://cdn.example/video.mp4',playback:{durl:[{url:'https://cdn.example/fallback.mp4'}]}}}),{status:200,headers:{'Content-Type':'application/json'}});});const result=await resolveBilibili('BV1B7411m7LV',1,config,'server-only-key',fetchImpl as typeof fetch);expect(result.media).toEqual(['https://cdn.example/video.mp4','https://cdn.example/fallback.mp4']);expect(result.cover).toBe('https://i.example/cover.jpg');expect(JSON.stringify(result)).not.toContain('server-only-key');expect(fetchImpl).toHaveBeenCalledTimes(1);});});
describe('upstream boundaries',()=>{
  it('maps an aborted upstream request to a timeout',async()=>{
    const fetchImpl=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
    }));
    await expect(resolveBilibili('BV1B7411m7LV',1,{...config,upstreamTimeoutMs:5},'key',fetchImpl as typeof fetch)).rejects.toMatchObject({status:504});
  });
  it('rejects non-json and oversized parse responses before decoding',async()=>{
    const html=vi.fn(async()=>new Response('<!doctype html>',{status:200,headers:{'Content-Type':'text/html'}}));
    await expect(resolveBilibili('BV1B7411m7LV',1,config,'key',html as typeof fetch)).rejects.toMatchObject({status:502});
    const oversized=vi.fn(async()=>new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json','Content-Length':'100'}}));
    await expect(resolveBilibili('BV1B7411m7LV',1,{...config,upstreamJsonMaxBytes:10},'key',oversized as typeof fetch)).rejects.toMatchObject({status:502});
  });
  it('accepts bounded danmaku XML and rejects oversized text',async()=>{
    const xml=vi.fn(async()=>new Response('<i><d p="1,1,25,16777215">hello</d></i>',{status:200,headers:{'Content-Type':'text/xml'}}));
    await expect(fetchDanmaku(123,'BV1B7411m7LV',config,'key',xml as typeof fetch)).resolves.toContain('<d');
    const oversized=vi.fn(async()=>new Response('0123456789',{status:200,headers:{'Content-Type':'text/plain','Content-Length':'10'}}));
    await expect(fetchDanmaku(123,'BV1B7411m7LV',{...config,upstreamTextMaxBytes:5},'key',oversized as typeof fetch)).rejects.toMatchObject({status:502});
  });
});
describe('creator input parsing',()=>{it('accepts only direct Bilibili video pages or an exact BV id',()=>{expect(parseDirectBvid('https://www.bilibili.com/video/BV1B7411m7LV?p=1')).toBe('BV1B7411m7LV');expect(parseDirectBvid('BV1B7411m7LV')).toBe('BV1B7411m7LV');expect(()=>parseDirectBvid('https://evil.example/BV1B7411m7LV')).toThrow(/链接暂时不支持/);expect(()=>parseDirectBvid('https://b23.tv/demo')).toThrow(/打开分享短链/);});});
