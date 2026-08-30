import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { HomeView } from './HomeView';

const mocks=vi.hoisted(()=>({apiRequest:vi.fn(),post:vi.fn()}));
vi.mock('../api/client',()=>({apiRequest:mocks.apiRequest,post:mocks.post}));

const entry={rank:1,video:{source:'bilibili' as const,bvid:'BV1B7411m7LV',cid:1,page:1,title:'全站最难绷',description:'',cover:'',duration:60},total:12,held:2,failed:10,failureRate:10/12,averageElapsedRatio:.2,difficultyScore:82.3};
const parsed={video:{...entry.video,media:['https://cdn/video.mp4']},videoTicket:'bv1.ticket'};

describe('HomeView',()=>{
  afterEach(cleanup);
  beforeEach(()=>{mocks.apiRequest.mockReset();mocks.post.mockReset();sessionStorage.clear();});
  it('loads the leaderboard lazily and preserves composer fields across accessible tab switches',async()=>{
    mocks.apiRequest.mockResolvedValue({entries:[entry]});
    render(<HomeView navigate={vi.fn()}/>);
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('B站视频链接'),{target:{value:'BV-user-draft'}});
    fireEvent.click(screen.getByRole('tab',{name:'难绷排行'}));
    expect(await screen.findByText('全站最难绷')).toBeVisible();
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/leaderboard');
    expect(screen.getByRole('tabpanel',{name:'难绷排行'})).toBeVisible();
    fireEvent.click(screen.getByRole('tab',{name:'制作挑战'}));
    expect(screen.getByLabelText('B站视频链接')).toHaveValue('BV-user-draft');
  });

  it('offers retry and both actions without document navigation',async()=>{
    mocks.apiRequest.mockRejectedValueOnce(new Error('暂时不可用')).mockResolvedValueOnce({entries:[entry]});
    const navigate=vi.fn();render(<HomeView navigate={navigate}/>);
    fireEvent.click(screen.getByRole('tab',{name:'难绷排行'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时不可用');
    fireEvent.click(screen.getByRole('button',{name:'重新加载'}));
    expect(await screen.findByText('全站最难绷')).toBeVisible();
    expect(screen.getByRole('button',{name:'我来挑战'})).toBeVisible();
    expect(screen.getByRole('button',{name:'分享给朋友'})).toBeVisible();
    mocks.post.mockResolvedValueOnce(parsed);
    fireEvent.click(screen.getByRole('button',{name:'分享给朋友'}));
    await waitFor(()=>expect(screen.getByLabelText('B站视频链接')).toHaveValue(`https://www.bilibili.com/video/${entry.video.bvid}`));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab',{name:'难绷排行'}));
    mocks.post.mockResolvedValueOnce(parsed).mockResolvedValueOnce({challengeUrl:'https://example.com/c/self-token'});
    fireEvent.click(screen.getByRole('button',{name:'我来挑战'}));
    await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/c/self-token'));
    expect(mocks.post).toHaveBeenLastCalledWith('/api/challenges',{videoTicket:'bv1.ticket',mode:'self'});
  });

  it('automatically parses a video forwarded from settlement', async () => {
    const forwarded = `https://www.bilibili.com/video/${entry.video.bvid}`;
    sessionStorage.setItem('forward-video', forwarded);
    mocks.post.mockResolvedValue(parsed);

    render(<StrictMode><HomeView navigate={vi.fn()} /></StrictMode>);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/bilibili/parse', { input: forwarded }));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(entry.video.title)).toBeVisible();
    expect(sessionStorage.getItem('forward-video')).toBeNull();
  });

  it('keeps a failed forwarded parse available for retry and clears it after success', async () => {
    const forwarded = `https://www.bilibili.com/video/${entry.video.bvid}`;
    sessionStorage.setItem('forward-video', forwarded);
    mocks.post.mockRejectedValueOnce(new Error('暂时不可用')).mockResolvedValueOnce(parsed);

    render(<HomeView navigate={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时不可用');
    expect(sessionStorage.getItem('forward-video')).toBe(forwarded);
    fireEvent.click(screen.getByRole('button', { name: '解析视频' }));

    await waitFor(() => expect(screen.getByText(entry.video.title)).toBeVisible());
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('forward-video')).toBeNull();
  });
});
