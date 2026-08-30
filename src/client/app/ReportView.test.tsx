import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportView } from './ReportView';

const mocks=vi.hoisted(()=>({post:vi.fn()}));
vi.mock('../api/client',()=>({post:mocks.post}));

const report={v:1 as const,kind:'report' as const,video:{source:'bilibili' as const,bvid:'BV1B7411m7LV',cid:1,page:1,title:'测试视频',description:'',cover:'',duration:60},outcome:'failed' as const,elapsedSeconds:12,issuedAt:1,expiresAt:2,nonce:'n',resultRef:'result-id',mode:'self' as const};
const stats={total:1,held:0,failed:1,failureRate:1,averageElapsedSeconds:12,buckets:[{startSeconds:10,count:1}]};

describe('ReportView',()=>{
  afterEach(()=>{cleanup();mocks.post.mockReset();});
  it('restores the saved curve and labels self mode without inventing an identity',async()=>{
    mocks.post.mockResolvedValue({report,stats,scoreTrace:[{timeSeconds:5,score:30},{timeSeconds:12,score:76}]});
    render(<ReportView token="report-token"/>);
    expect(await screen.findByText('单人挑战')).toBeVisible();
    expect(screen.getByRole('img',{name:/挑战过程中的难绷程度折线图/})).toBeVisible();
    expect(screen.getByRole('button',{name:/12.0 秒，难绷程度 76，爆炸点/})).toBeVisible();
    expect(screen.queryByText(/发起者|挑战你/)).not.toBeInTheDocument();
  });
});
