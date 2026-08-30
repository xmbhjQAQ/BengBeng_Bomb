import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManageResult } from '../../shared/contracts';
import { ManageView } from './ManageView';

const mocks = vi.hoisted(() => ({ post: vi.fn(), apiRequest: vi.fn() }));
vi.mock('../api/client', () => ({ post: mocks.post, apiRequest: mocks.apiRequest }));

const video = {
  source: 'bilibili' as const,
  bvid: 'BV1B7411m7LV',
  cid: 1,
  page: 1,
  title: '测试视频',
  description: '',
  cover: '',
  duration: 60,
};
const stats = { total: 3, held: 1, failed: 2, failureRate: 2 / 3, averageElapsedSeconds: 22, buckets: [{ startSeconds: 0, count: 1 }, { startSeconds: 10, count: 1 }] };

describe('ManageView private result details', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/manage#m=manage-token');
    mocks.post.mockReset();
    mocks.apiRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
    history.replaceState({}, '', '/');
  });

  it('renders the completed score trace and anonymous heatmap through the private entry', async () => {
    const result: ManageResult = {
      status: 'completed',
      outcome: 'failed',
      elapsedSeconds: 12,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      video,
      scoreTrace: [{ timeSeconds: 5, score: 30 }, { timeSeconds: 12, score: 76 }],
      stats,
    };
    mocks.post.mockResolvedValue(result);

    render(<ManageView />);
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));

    expect(await screen.findByRole('img', { name: /挑战过程中的难绷程度折线图/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /12.0 秒，难绷程度 76，爆炸点/ })).toBeVisible();
    expect(screen.getByText('测试视频')).toBeVisible();
    expect(screen.getByRole('heading', { name: '匿名战况' })).toBeVisible();
    expect(screen.getByRole('listitem', { name: '0–10 秒，1 人失败' })).toBeVisible();
    expect(screen.getByRole('listitem', { name: '10–20 秒，1 人失败' })).toBeVisible();
  });

  it('degrades an old completed row without video details to a truthful unavailable state', async () => {
    mocks.post.mockResolvedValue({ status: 'completed', outcome: 'failed', elapsedSeconds: 12 } satisfies ManageResult);

    render(<ManageView />);
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));

    expect(await screen.findByRole('heading', { name: '炸了！' })).toBeVisible();
    expect(screen.getByText(/缺少可用的视频或曲线数据/)).toBeVisible();
    expect(screen.queryByRole('img', { name: /挑战过程中的难绷程度折线图/ })).not.toBeInTheDocument();
    expect(screen.getByText('匿名统计暂不可用。')).toBeVisible();
  });

  it('does not render private details for an expired or deleted result', async () => {
    mocks.post.mockResolvedValueOnce({ status: 'expired' } satisfies ManageResult);
    const { unmount } = render(<ManageView />);
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    expect(await screen.findByRole('heading', { name: '已过期' })).toBeVisible();
    expect(screen.queryByText('本次表情变化')).not.toBeInTheDocument();

    unmount();
    mocks.post.mockResolvedValueOnce({ status: 'deleted' } satisfies ManageResult);
    render(<ManageView />);
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    expect(await screen.findByRole('heading', { name: '已销毁' })).toBeVisible();
    expect(screen.queryByText('本次表情变化')).not.toBeInTheDocument();
  });
});
