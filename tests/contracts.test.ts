import { describe,expect,it } from 'vitest';
import { decodeChallengePayload,decodeScoreTrace,decodeVideoMetadata,SCORE_TRACE_MAX_POINTS } from '../src/shared/contracts';
const video={source:'bilibili',bvid:'BV1B7411m7LV',cid:12,page:1,title:'标题',description:'简介',cover:'https://i.example/a.jpg',duration:90};
describe('boundary decoders',()=>{
  it('round-trips bounded video metadata',()=>{expect(decodeVideoMetadata(video)).toEqual(video);});
  it('keeps old challenges classic and accepts nickname-free self challenges',()=>{
    expect(decodeChallengePayload({v:1,kind:'challenge',video,initiator:'小明',createdAt:1,expiresAt:2,nonce:'n'})).toMatchObject({mode:'classic',initiator:'小明'});
    const self=decodeChallengePayload({v:1,kind:'challenge',video,mode:'self',createdAt:1,expiresAt:2,nonce:'n'});expect(self.mode).toBe('self');expect(self).not.toHaveProperty('initiator');
    expect(()=>decodeChallengePayload({v:1,kind:'challenge',video,mode:'classic',createdAt:1,expiresAt:2,nonce:'n'})).toThrow(/昵称/);
  });
  it('rejects oversized private copy before signing',()=>{expect(()=>decodeChallengePayload({v:1,kind:'challenge',video:{bvid:'BV1B7411m7LV',cid:1,page:1,title:'标题',description:'',cover:'',duration:2},initiator:'x'.repeat(21),createdAt:1,expiresAt:2,nonce:'n'})).toThrow(/20/);});
  it('accepts only bounded, increasing, finite integer score traces',()=>{
    expect(decodeScoreTrace([{timeSeconds:0,score:0},{timeSeconds:1.5,score:68}],90)).toEqual([{timeSeconds:0,score:0},{timeSeconds:1.5,score:68}]);
    for(const trace of [[{timeSeconds:1,score:2},{timeSeconds:1,score:3}],[{timeSeconds:-1,score:2}],[{timeSeconds:91,score:2}],[{timeSeconds:1,score:2.2}],[{timeSeconds:1,score:101}],[{timeSeconds:'1',score:2}]]) expect(()=>decodeScoreTrace(trace,90)).toThrow();
    expect(()=>decodeScoreTrace(Array.from({length:SCORE_TRACE_MAX_POINTS+1},(_,timeSeconds)=>({timeSeconds,score:1})),1000)).toThrow(/600/);
  });
});
