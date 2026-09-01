import { describe,expect,it,vi } from 'vitest';
import { fetchDanmaku, parseBilibiliInput, parseDirectBvid, resolveBilibili } from '../src/worker/bilibili/adapter';
import type { WorkerConfig } from '../src/worker/config';

const config:WorkerConfig={challengeTtlSeconds:172800,resultTtlSeconds:172800,ticketTtlSeconds:900,baseUrl:'https://parser.example.com',qn:80,leaderboardMinAttempts:5,leaderboardCacheSeconds:600,leaderboardLimit:20};
describe('bilidirect Worker adapter',()=>{it('keeps the API key server-side and returns sanitized CDN candidates',async()=>{const fetchImpl=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{expect(new Headers(init?.headers).get('X-API-Key')).toBe('server-only-key');return new Response(JSON.stringify({ok:true,data:{bvid:'BV1B7411m7LV',cid:123,page:1,title:'测试',description:'简介',cover:'http://i.example/cover.jpg',duration:60,directUrl:'http://cdn.example/video.mp4',playback:{durl:[{url:'https://cdn.example/fallback.mp4'}]}}}),{status:200,headers:{'Content-Type':'application/json'}});});const result=await resolveBilibili('BV1B7411m7LV',1,config,'server-only-key',fetchImpl as typeof fetch);expect(result.media).toEqual(['https://cdn.example/video.mp4','https://cdn.example/fallback.mp4']);expect(result.cover).toBe('https://i.example/cover.jpg');expect(JSON.stringify(result)).not.toContain('server-only-key');expect(fetchImpl).toHaveBeenCalledTimes(1);});});
describe('upstream boundaries',()=>{
  const parseSuccess = () => new Response(JSON.stringify({ok:true,data:{bvid:'BV1B7411m7LV',cid:123,page:1,title:'测试',description:'简介',duration:60,directUrl:'https://cdn.example/video.mp4'}}),{status:200,headers:{'Content-Type':'application/json'}});
  it.each([502,503,504])('retries a transient upstream %s response',async(status)=>{
    let calls=0;
    const fetchImpl=vi.fn(async()=>{calls+=1;return calls===1?new Response('origin unavailable',{status,headers:{'Retry-After':'60'}}):parseSuccess();});
    const sleepImpl=vi.fn(async()=>{});
    await expect(resolveBilibili('BV1B7411m7LV',1,config,'key',fetchImpl as typeof fetch,sleepImpl)).resolves.toMatchObject({bvid:'BV1B7411m7LV'});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).toHaveBeenCalledWith(150);
  });
  it('retries a transient transport failure without using the upstream retry-after delay',async()=>{
    let calls=0;
    const fetchImpl=vi.fn(async()=>{calls+=1;if(calls===1)throw new TypeError('fetch failed');return parseSuccess();});
    const sleepImpl=vi.fn(async()=>{});
    await expect(resolveBilibili('BV1B7411m7LV',1,config,'key',fetchImpl as typeof fetch,sleepImpl)).resolves.toMatchObject({bvid:'BV1B7411m7LV'});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(150);
  });
  it('does not retry client or authentication errors',async()=>{
    const fetchImpl=vi.fn(async()=>new Response('unauthorized',{status:401}));
    const sleepImpl=vi.fn(async()=>{});
    await expect(resolveBilibili('BV1B7411m7LV',1,config,'key',fetchImpl as typeof fetch,sleepImpl)).rejects.toMatchObject({status:401});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
  it('uses the default retry count when the legacy config shape omits it',async()=>{
    let calls=0;
    const fetchImpl=vi.fn(async()=>{calls+=1;return calls<=3?new Response('origin unavailable',{status:503}):parseSuccess();});
    const sleepImpl=vi.fn(async()=>{});
    await expect(resolveBilibili('BV1B7411m7LV',1,config,'key',fetchImpl as typeof fetch,sleepImpl)).resolves.toMatchObject({bvid:'BV1B7411m7LV'});
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleepImpl).toHaveBeenCalledTimes(3);
  });
  it('uses a configured retry count and allows retries to be disabled',async()=>{
    let calls=0;
    const fetchImpl=vi.fn(async()=>{calls+=1;return calls<=3?new Response('origin unavailable',{status:502}):parseSuccess();});
    const sleepImpl=vi.fn(async()=>{});
    await expect(resolveBilibili('BV1B7411m7LV',1,{...config,upstreamMaxRetries:3},'key',fetchImpl as typeof fetch,sleepImpl)).resolves.toMatchObject({bvid:'BV1B7411m7LV'});
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleepImpl).toHaveBeenCalledTimes(3);

    calls=0;
    fetchImpl.mockClear();
    sleepImpl.mockClear();
    await expect(resolveBilibili('BV1B7411m7LV',1,{...config,upstreamMaxRetries:0},'key',fetchImpl as typeof fetch,sleepImpl)).rejects.toMatchObject({status:502});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
  it('clamps direct adapter retry values to the Free-account safety cap',async()=>{
    let calls=0;
    const fetchImpl=vi.fn(async()=>{calls+=1;return calls<=5?new Response('origin unavailable',{status:504}):parseSuccess();});
    const sleepImpl=vi.fn(async()=>{});
    await expect(resolveBilibili('BV1B7411m7LV',1,{...config,upstreamMaxRetries:99},'key',fetchImpl as typeof fetch,sleepImpl)).resolves.toMatchObject({bvid:'BV1B7411m7LV'});
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(sleepImpl).toHaveBeenCalledTimes(5);
  });
  it('releases the final failed response body',async()=>{
    let canceled=0;
    const fetchImpl=vi.fn(async()=>new Response(new ReadableStream({cancel(){canceled+=1;}}),{status:401}));
    await expect(resolveBilibili('BV1B7411m7LV',1,config,'key',fetchImpl as typeof fetch)).rejects.toMatchObject({status:401});
    expect(canceled).toBe(1);
  });
  it('releases a discarded retry response body',async()=>{
    let calls=0;
    let canceled=0;
    const fetchImpl=vi.fn(async()=>{
      calls+=1;
      if(calls===1)return new Response(new ReadableStream({cancel(){canceled+=1;}}),{status:502});
      return parseSuccess();
    });
    await expect(resolveBilibili('BV1B7411m7LV',1,config,'key',fetchImpl as typeof fetch,async()=>{})).resolves.toMatchObject({bvid:'BV1B7411m7LV'});
    expect(canceled).toBe(1);
  });
  it('keeps the configured total timeout bounded across retries',async()=>{
    let calls=0;
    const fetchImpl=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>{
      calls+=1;
      if(calls===1)return Promise.reject(new TypeError('fetch failed'));
      return new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
    });
    const startedAt=Date.now();
    await expect(resolveBilibili('BV1B7411m7LV',1,{...config,upstreamTimeoutMs:320},'key',fetchImpl as typeof fetch,async()=>{})).rejects.toMatchObject({status:504});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(Date.now()-startedAt).toBeLessThan(550);
  });
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
describe('legacy creator input parsing',()=>{it('keeps exact BV extraction while short links use the new URL parser',()=>{expect(parseDirectBvid('https://www.bilibili.com/video/BV1B7411m7LV?p=1')).toBe('BV1B7411m7LV');expect(parseDirectBvid('BV1B7411m7LV')).toBe('BV1B7411m7LV');expect(()=>parseDirectBvid('https://evil.example/BV1B7411m7LV')).toThrow(/链接暂时不支持/);expect(()=>parseDirectBvid('https://b23.tv/demo')).toThrow(/短链接可以直接粘贴/);});});

describe('creator input parsing',()=>{
  it('sends exact BV ids and standard pages as bvid, while short links use url',async()=>{
    expect(parseBilibiliInput('BV1B7411m7LV')).toMatchObject({kind:'bvid',bvid:'BV1B7411m7LV'});
    expect(parseBilibiliInput('http://www.bilibili.com/video/BV1B7411m7LV?p=1#share')).toMatchObject({kind:'url',url:'https://www.bilibili.com/video/BV1B7411m7LV?p=1',bvid:'BV1B7411m7LV'});
    expect(parseBilibiliInput('https://b23.tv/7WpblY1?share_source=copy')).toMatchObject({kind:'url',url:'https://b23.tv/7WpblY1?share_source=copy'});
  });

  it('forwards a standard page or b23.tv short link without exposing upstream source diagnostics',async()=>{
    const fetchImpl=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{void _input;void _init;return new Response(JSON.stringify({ok:true,data:{bvid:'BV1B7411m7LV',cid:123,page:1,title:'测试',description:'简介',duration:60,directUrl:'https://cdn.example/video.mp4',source:{input:'https://b23.tv/7WpblY1',resolvedUrl:'https://www.bilibili.com/video/BV1B7411m7LV',type:'short'}}}),{status:200,headers:{'Content-Type':'application/json'}});});
    const result=await resolveBilibili('https://b23.tv/7WpblY1',1,config,'key',fetchImpl as typeof fetch);
    const request=fetchImpl.mock.calls[0];
    const body=JSON.parse(String(request?.[1]?.body));
    expect(body).toMatchObject({url:'https://b23.tv/7WpblY1',page:1,qn:80,fnval:0,fourk:1,probe:1});
    expect(body).not.toHaveProperty('bvid');
    expect(result).toMatchObject({bvid:'BV1B7411m7LV'});
    expect(result.source).toBe('bilibili');
    expect(JSON.stringify(result)).not.toContain('resolvedUrl');

    fetchImpl.mockClear();
    await resolveBilibili(parseBilibiliInput('https://www.bilibili.com/video/BV1B7411m7LV?p=2'),2,config,'key',fetchImpl as typeof fetch);
    const directBody=JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(directBody).toMatchObject({bvid:'BV1B7411m7LV',page:2});
    expect(directBody).not.toHaveProperty('url');
  });

  it('rejects unsupported hosts and short-link schemes before upstream fetch',()=>{
    const cases=['https://evil.example/BV1B7411m7LV','https://m.q.qq.com/a/s/abc','https://bili23.cn/abc','ftp://www.bilibili.com/video/BV1B7411m7LV'];
    cases.forEach((input)=>expect(()=>parseBilibiliInput(input)).toThrow());
  });

  it('rejects a short-link response without a canonical BV id',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,data:{cid:123,page:1,title:'测试',description:'简介',duration:60,directUrl:'https://cdn.example/video.mp4'}}),{status:200,headers:{'Content-Type':'application/json'}}));
    await expect(resolveBilibili('https://b23.tv/7WpblY1',1,config,'key',fetchImpl as typeof fetch)).rejects.toMatchObject({status:502});
  });
});
