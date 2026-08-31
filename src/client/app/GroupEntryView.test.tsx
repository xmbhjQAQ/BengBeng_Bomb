import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupEntryView } from './GroupEntryView';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api/client', () => ({ post: mocks.post }));

const video = {
  source: 'bilibili' as const,
  bvid: 'BV1B7411m7LV',
  cid: 1,
  page: 1,
  title: '入口视频',
  description: '',
  cover: '',
  duration: 60,
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    entry: { state: 'active', video, createdAt: 1, expiresAt: 200, resultExpiresAt: 300, canParticipate: true, initiator: '发起者', message: '来玩' },
    invitationUrl: 'https://bomb.example/g/bg1.invitation',
    resultUrl: 'https://bomb.example/g/results/bgr1.result',
    resultPage: { state: 'active', video, summary: { total: 2, held: 1, failed: 1 }, results: [] },
    ...overrides,
  };
}

describe('GroupEntryView', () => {
  beforeEach(() => {
    cleanup();
    mocks.post.mockReset();
    history.replaceState({}, '', '/g/entry/bge1.entry-token');
  });

  afterEach(() => {
    cleanup();
    history.replaceState({}, '', '/');
  });

  it('resolves once and offers participate/result actions from one landing page', async () => {
    mocks.post.mockResolvedValueOnce(response());
    const navigate = vi.fn();
    render(<GroupEntryView token="bge1.entry-token" navigate={navigate} />);

    expect(await screen.findByRole('heading', { name: '入口视频' })).toBeVisible();
    expect(screen.getByText((_content, element) => element?.textContent === '发起者 发起了这组挑战')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '参加挑战' }));
    expect(navigate).toHaveBeenCalledWith('/g/bg1.invitation');
    fireEvent.click(screen.getByRole('button', { name: '查看目前结果' }));
    expect(navigate).toHaveBeenCalledWith('/g/results/bgr1.result');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/api/groups/entry', { entryToken: 'bge1.entry-token' });
  });

  it('keeps the result action after participation expires and never offers a stale join action', async () => {
    mocks.post.mockResolvedValueOnce(response({
      entry: { state: 'expired', video, createdAt: 1, expiresAt: 2, resultExpiresAt: 300, canParticipate: false },
      invitationUrl: undefined,
      resultPage: { state: 'expired', video, summary: { total: 1, held: 0, failed: 1 }, results: [] },
    }));
    const navigate = vi.fn();
    render(<GroupEntryView token="bge1.entry-token" navigate={navigate} />);

    expect(await screen.findByText('参与时间已结束，以下结果还在保存期内。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '参加挑战' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看目前结果' })).toBeVisible();
  });

  it('describes an unopened or destroyed group without implying it is merely empty', async () => {
    mocks.post.mockResolvedValueOnce(response({
      entry: { state: 'unopened', video, createdAt: 1, expiresAt: 2, resultExpiresAt: 300, canParticipate: false },
      invitationUrl: undefined,
      resultPage: { state: 'unopened', video, summary: { total: 0, held: 0, failed: 0 }, results: [] },
    }));
    render(<GroupEntryView token="bge1.entry-token" navigate={vi.fn()} />);
    expect(await screen.findByText('这组挑战尚未打开，或结果已经销毁。')).toBeVisible();
  });
});
