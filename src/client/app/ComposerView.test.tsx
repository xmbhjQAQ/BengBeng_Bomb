import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerView } from './ComposerView';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api/client', () => ({ post: mocks.post }));

const parsed = {
  video: {
    source: 'bilibili' as const,
    bvid: 'BV1B7411m7LV',
    cid: 1,
    page: 1,
    title: '测试视频',
    description: '',
    cover: '',
    duration: 60,
    media: ['https://cdn.example/video.mp4'],
  },
  videoTicket: 'ticket',
};

describe('ComposerView links', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.post.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('shows compact capability previews while copying the complete values', async () => {
    const created = {
      challengeUrl: 'https://example.com/c/bc1-this-is-a-long-token-1234',
      manageUrl: 'https://example.com/manage#bm1-this-is-a-long-private-token-5678',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    mocks.post.mockResolvedValueOnce(parsed).mockResolvedValueOnce(created);

    render(<ComposerView />);
    fireEvent.change(screen.getByLabelText('B站视频链接'), { target: { value: 'BV1B7411m7LV' } });
    fireEvent.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByText('测试视频');
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: '发起者' } });
    fireEvent.click(screen.getByRole('button', { name: '生成挑战' }));

    expect(await screen.findByText('https://example.com/c/…1234')).toBeVisible();
    expect(screen.getByText('https://example.com/manage#••••')).toBeVisible();
    expect(screen.queryByText(created.challengeUrl)).not.toBeInTheDocument();
    expect(screen.queryByText(created.manageUrl)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '复制链接' })[0]!);
    expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(created.challengeUrl);
  });
});
