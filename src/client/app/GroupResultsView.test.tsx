import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupResultsView } from './GroupResultsView';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api/client', () => ({ post: mocks.post }));
vi.mock('./PublicQrCode', () => ({ PublicQrCode: ({ label }: { label: string }) => <div data-testid="result-qr">{label}</div> }));
vi.mock('./Settlement', () => ({ Stats: ({ stats }: { stats: { total: number } }) => <div data-testid="stats">总计 {stats.total}</div> }));

const stats = { total: 2, held: 1, failed: 1, failureRate: 0.5, averageElapsedSeconds: 32, buckets: [] };
const video = {
  source: 'bilibili' as const,
  bvid: 'BV1B7411m7LV',
  cid: 1,
  page: 1,
  title: '测试群组视频',
  description: '',
  cover: '',
  duration: 60,
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    state: 'active',
    video,
    createdAt: 1,
    expiresAt: 200,
    resultExpiresAt: 300,
    summary: stats,
    results: [
      { nickname: '小明', outcome: 'failed', elapsedSeconds: 12, failedAtSeconds: 12, completedAt: 100 },
      { nickname: '小红', outcome: 'held', elapsedSeconds: 60, completedAt: 101 },
    ],
    ...overrides,
  };
}

describe('GroupResultsView', () => {
  beforeEach(() => {
    cleanup();
    mocks.post.mockReset();
    history.replaceState({}, '', '/g/results/bgr1.public-token');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'clipboard');
    history.replaceState({}, '', '/');
  });

  it('loads completed rows once and exposes only the public result link/QR', async () => {
    mocks.post.mockResolvedValueOnce(page({ nextCursor: 'next-page' }));
    render(<GroupResultsView token="bgr1.public-token" />);

    expect(await screen.findByRole('heading', { name: '测试群组视频' })).toBeVisible();
    expect(screen.getByText('小明')).toBeVisible();
    expect(screen.getByText('小红')).toBeVisible();
    expect(screen.getByText('12.0 秒')).toBeVisible();
    expect(screen.getByText('60.0 秒')).toBeVisible();
    expect(screen.getByTestId('result-qr')).toHaveTextContent('扫码查看结果');
    expect(screen.getByText('总计 2')).toBeVisible();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/api/groups/results', { resultToken: 'bgr1.public-token' });
    expect(screen.getByRole('button', { name: '复制结果链接' })).toBeVisible();
    expect(screen.queryByText(/attemptToken|scoreTrace|cameraFrame/)).not.toBeInTheDocument();
  });

  it('loads the next page only on demand and appends it without polling', async () => {
    mocks.post.mockResolvedValueOnce(page({
      results: [{ nickname: '第一位', outcome: 'failed', elapsedSeconds: 3, completedAt: 100 }],
      summary: { ...stats, total: 3, failed: 2 },
      nextCursor: 'cursor-2',
    })).mockResolvedValueOnce(page({
      results: [{ nickname: '第二位', outcome: 'held', elapsedSeconds: 60, completedAt: 99 }],
      nextCursor: undefined,
    }));
    render(<GroupResultsView token="result-token" />);

    await screen.findByText('第一位');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }));
    await screen.findByText('第二位');
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenLastCalledWith('/api/groups/results', { resultToken: 'result-token', cursor: 'cursor-2' });
    expect(screen.getByText('第一位')).toBeVisible();
    expect(screen.getByText('第二位')).toBeVisible();
  });

  it('renders an explicit empty state and does not manufacture participant rows', async () => {
    mocks.post.mockResolvedValueOnce(page({ summary: { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0, buckets: [] }, results: [] }));
    render(<GroupResultsView token="result-token" />);

    expect(await screen.findByText('还没有完成记录，等第一位挑战者来报到。')).toBeVisible();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows ended and expired states while keeping retained pages available', async () => {
    mocks.post.mockResolvedValueOnce(page({ state: 'ended', nextCursor: 'cursor', results: [] }));
    render(<GroupResultsView token="result-token" />);
    expect(await screen.findByText('这组挑战已经结束，以下是已完成的结果。')).toBeVisible();
    expect(screen.getByRole('button', { name: '加载更多结果' })).toBeVisible();

    cleanup();
    mocks.post.mockReset();
    mocks.post.mockResolvedValueOnce(page({ state: 'expired', nextCursor: 'cursor', results: [] }));
    render(<GroupResultsView token="result-token" />);
    expect(await screen.findByText('这组挑战的参与时间已结束，以下是仍在保存期内的结果。')).toBeVisible();
    expect(screen.getByRole('button', { name: '加载更多结果' })).toBeVisible();
  });

  it('labels a destroyed or never-opened group instead of implying no one has joined yet', async () => {
    mocks.post.mockResolvedValueOnce(page({ state: 'unopened', nextCursor: undefined, results: [] }));
    render(<GroupResultsView token="result-token" />);
    expect(await screen.findByText('这组挑战尚未打开，或结果已经销毁。')).toBeVisible();
  });

  it('keeps result-link copy feedback in the existing single-page view', async () => {
    mocks.post.mockResolvedValueOnce(page());
    render(<GroupResultsView token="result-token" />);
    await screen.findByText('小明');

    fireEvent.click(screen.getByRole('button', { name: '复制结果链接' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeVisible());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
  });
});
